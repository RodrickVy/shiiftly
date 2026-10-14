-- Shiftly :: 0003_functions
--
-- Two kinds of function live here:
--
--  1. Authorization helpers used by RLS policies. They are SECURITY DEFINER so
--     that a policy on organization_memberships can itself read that table
--     without re-entering its own policy (which would recurse).
--
--  2. Attendance / membership mutations. These run as a single statement from
--     the application, so Postgres gives each one its own transaction. Putting
--     the read-validate-write sequence here is what makes "no duplicate clock
--     in" true under concurrency rather than merely likely.
--
-- Every mutation re-derives the acting membership from auth.uid(). A caller
-- cannot pass in an organization_id or membership_id to act as someone else.

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      -- A station is a display device, not a person who works here.
      and m.role <> 'station'
  );
$$;

-- True when the caller is a station device account for this organization.
create or replace function public.is_org_station(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'station'
  );
$$;

create or replace function public.is_org_manager(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'manager')
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'owner'
  );
$$;

-- The caller's own membership id within an organization.
create or replace function public.current_membership_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select m.id from public.organization_memberships m
  where m.organization_id = p_org
    and m.user_id = auth.uid()
    and m.status = 'active'
    and m.role <> 'station'
  limit 1;
$$;

-- True when the given membership row is the caller's own.
create or replace function public.is_own_membership(p_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.id = p_membership
      and m.user_id = auth.uid()
  );
$$;

-- True when the caller manages the organization that owns this membership.
create or replace function public.manages_membership(p_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.organization_memberships target
    join public.organization_memberships me
      on me.organization_id = target.organization_id
    where target.id = p_membership
      and me.user_id = auth.uid()
      and me.status = 'active'
      and me.role in ('owner', 'manager')
  );
$$;

-- ---------------------------------------------------------------------------
-- Organization creation
-- ---------------------------------------------------------------------------

-- Organization + default settings + owner membership, or nothing at all.
create or replace function public.create_organization(
  p_name text,
  p_industry text,
  p_country_code text,
  p_timezone text,
  p_currency_code text,
  p_week_starts_on smallint default 1,
  p_workweek_days smallint[] default '{1,2,3,4,5}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_membership uuid;
  v_probe timestamp;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  -- Reject an unknown IANA zone here rather than at first clock-in.
  begin
    v_probe := now() at time zone p_timezone;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_timezone');
  end;

  insert into public.organizations (
    name, industry, country_code, timezone, currency_code,
    week_starts_on, workweek_days, created_by
  )
  values (
    btrim(p_name), nullif(btrim(coalesce(p_industry, '')), ''),
    upper(p_country_code), p_timezone, upper(p_currency_code),
    p_week_starts_on, p_workweek_days, v_user
  )
  returning id into v_org;

  insert into public.organization_settings (organization_id)
  values (v_org);

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_org, v_user, 'owner', 'active')
  returning id into v_membership;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org, v_user, 'organization.created', 'organization', v_org,
          jsonb_build_object('name', btrim(p_name)));

  return jsonb_build_object(
    'ok', true,
    'organization_id', v_org,
    'membership_id', v_membership
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Joining an organization
-- ---------------------------------------------------------------------------

-- Anyone holding the organization's join link can apply. They arrive as a
-- pending membership with no role of consequence and no visibility into the
-- organization; a manager decides what happens next. Nothing the applicant
-- submits influences their permissions.
create or replace function public.request_to_join(
  p_token_hash text,
  p_full_name text,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_org public.organizations%rowtype;
  v_existing public.organization_memberships%rowtype;
  v_membership uuid;
  v_manager record;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select * into v_org from public.organizations where join_token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;

  if not v_org.join_enabled then
    return jsonb_build_object('ok', false, 'code', 'joining_closed');
  end if;

  select email into v_email from auth.users where id = v_user;

  insert into public.profiles (id, full_name, email, phone)
  values (v_user, btrim(p_full_name), coalesce(v_email, ''), nullif(btrim(coalesce(p_phone, '')), ''))
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = coalesce(excluded.phone, public.profiles.phone);

  select * into v_existing
  from public.organization_memberships
  where organization_id = v_org.id and user_id = v_user;

  if found then
    if v_existing.status = 'active' then
      return jsonb_build_object('ok', true, 'already_member', true,
                                'organization_id', v_org.id, 'status', 'active');
    elsif v_existing.status = 'pending' then
      return jsonb_build_object('ok', true, 'already_pending', true,
                                'organization_id', v_org.id, 'status', 'pending');
    elsif v_existing.status = 'rejected' then
      -- Deliberately not reopened here: a rejected applicant re-applying
      -- through the same link should not silently return to the queue.
      return jsonb_build_object('ok', false, 'code', 'request_rejected');
    else
      -- Previously removed: let them ask again.
      update public.organization_memberships
        set status = 'pending', deactivated_at = null
        where id = v_existing.id;
      v_membership := v_existing.id;
    end if;
  else
    insert into public.organization_memberships (organization_id, user_id, role, status)
    values (v_org.id, v_user, 'employee', 'pending')
    returning id into v_membership;
  end if;

  for v_manager in
    select user_id from public.organization_memberships
    where organization_id = v_org.id and status = 'active' and role in ('owner', 'manager')
  loop
    perform public.queue_notification(
      v_org.id, v_manager.user_id, 'join.requested',
      'Someone asked to join',
      coalesce(btrim(p_full_name), 'Someone') || ' asked to join ' || v_org.name || '.',
      '/app/employees?tab=requests',
      false
    );
  end loop;

  return jsonb_build_object('ok', true, 'organization_id', v_org.id,
                            'membership_id', v_membership, 'status', 'pending');
end;
$$;

-- A manager accepts or rejects a pending applicant, choosing the role at the
-- moment of acceptance. The role never comes from the applicant.
create or replace function public.review_join_request(
  p_membership uuid,
  p_decision text,
  p_role membership_role default 'employee'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_row public.organization_memberships%rowtype;
  v_org_name text;
begin
  if p_decision not in ('accept', 'reject') then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;

  -- Only an owner may mint owners or managers.
  if p_decision = 'accept' and p_role not in ('employee', 'manager') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;

  select * into v_row from public.organization_memberships where id = p_membership for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not public.is_org_manager(v_row.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if p_role = 'manager' and not public.is_org_owner(v_row.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'owner_required_for_manager');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_reviewed');
  end if;

  if p_decision = 'accept' then
    update public.organization_memberships
      set status = 'active', role = p_role, deactivated_at = null, joined_at = now()
      where id = p_membership;
  else
    update public.organization_memberships
      set status = 'rejected', deactivated_at = now()
      where id = p_membership;
  end if;

  select name into v_org_name from public.organizations where id = v_row.organization_id;

  perform public.queue_notification(
    v_row.organization_id, v_row.user_id, 'join.' || p_decision,
    case when p_decision = 'accept' then 'You have been accepted' else 'Request not accepted' end,
    case when p_decision = 'accept'
      then 'You are now part of ' || coalesce(v_org_name, 'the team') || '.'
      else 'Your request to join ' || coalesce(v_org_name, 'the team') || ' was not accepted.'
    end,
    '/app',
    false
  );

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_row.organization_id, v_user, 'join.' || p_decision, 'membership', p_membership,
          jsonb_build_object('role', p_role));

  return jsonb_build_object('ok', true, 'status', case when p_decision = 'accept' then 'active' else 'rejected' end);
end;
$$;

-- Links a freshly created device account to a station.
--
-- The auth user is created by the server with the service role (SQL cannot
-- create one), so this takes the user id rather than reading auth.uid(). It is
-- never granted to `authenticated`: only server code can call it, and only
-- after it has validated the station's setup token.
create or replace function public.claim_station(
  p_token_hash text,
  p_user_id uuid,
  p_display_name text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_station public.clocking_stations%rowtype;
  v_membership uuid;
  v_email text;
begin
  select * into v_station
  from public.clocking_stations
  where claim_token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_link');
  end if;

  if v_station.membership_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_claimed');
  end if;

  if not v_station.is_active then
    return jsonb_build_object('ok', false, 'code', 'station_disabled');
  end if;

  select email into v_email from auth.users where id = p_user_id;

  insert into public.profiles (id, full_name, email)
  values (p_user_id, btrim(p_display_name), coalesce(v_email, ''))
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (v_station.organization_id, p_user_id, 'station', 'active')
  returning id into v_membership;

  update public.clocking_stations
    set membership_id = v_membership,
        claimed_at = now(),
        description = coalesce(nullif(btrim(coalesce(p_description, '')), ''), description)
    where id = v_station.id;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_station.organization_id, p_user_id, 'station.claimed', 'station', v_station.id,
          jsonb_build_object('name', v_station.name));

  return jsonb_build_object('ok', true, 'organization_id', v_station.organization_id,
                            'station_id', v_station.id, 'membership_id', v_membership);
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

-- Resolves a scanned QR token to an organization, enforcing organization-local
-- day validity. Every station displays the same code, so the token identifies
-- the organization and the day, never which screen it was read from.
create or replace function public.resolve_org_token(p_token_hash text)
returns table (organization_id uuid, local_date date)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select t.organization_id, t.local_date
  from public.organization_daily_tokens t
  join public.organizations o on o.id = t.organization_id
  where t.token_hash = p_token_hash
    and t.expires_at > now()
    and t.local_date = (now() at time zone o.timezone)::date;
$$;

-- Shared clock-in body. p_station may be null for non-QR clock-in.
create or replace function public._open_shift(
  p_org uuid,
  p_station uuid,
  p_method text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_membership uuid;
  v_shift uuid;
  v_started timestamptz;
  v_cached jsonb;
  v_result jsonb;
begin
  -- role <> 'station': a display device never records attendance of its own,
  -- and a pending applicant is not yet staff.
  select id into v_membership
  from public.organization_memberships
  where organization_id = p_org and user_id = v_user
    and status = 'active' and role <> 'station';

  if v_membership is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;

  if p_idempotency_key is not null then
    select result into v_cached
    from public.idempotency_keys
    where user_id = v_user and scope = 'clock_in' and key = p_idempotency_key;
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  begin
    insert into public.shifts (
      organization_id, employee_membership_id, station_id,
      started_at, status, clock_in_method
    )
    values (p_org, v_membership, p_station, now(), 'active', coalesce(p_method, 'qr'))
    returning id, started_at into v_shift, v_started;
  exception when unique_violation then
    -- The partial unique index on active shifts fired: a shift is already open.
    return jsonb_build_object('ok', false, 'code', 'already_clocked_in');
  end;

  insert into public.attendance_events (
    organization_id, shift_id, employee_membership_id,
    event_type, occurred_at, station_id, method, recorded_by
  )
  values (p_org, v_shift, v_membership, 'clock_in', v_started, p_station,
          coalesce(p_method, 'qr'), v_user);

  v_result := jsonb_build_object(
    'ok', true,
    'shift_id', v_shift,
    'started_at', v_started,
    'membership_id', v_membership
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (organization_id, user_id, scope, key, result)
    values (p_org, v_user, 'clock_in', p_idempotency_key, v_result)
    on conflict (user_id, scope, key) do nothing;
  end if;

  return v_result;
end;
$$;

-- Clock in by scanning a station QR code.
create or replace function public.clock_in_with_token(
  p_token_hash text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_enabled boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select organization_id into v_org from public.resolve_org_token(p_token_hash);

  if v_org is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_or_expired_token');
  end if;

  select qr_clocking_enabled into v_enabled
  from public.organization_settings where organization_id = v_org;

  if not coalesce(v_enabled, true) then
    return jsonb_build_object('ok', false, 'code', 'qr_clocking_disabled');
  end if;

  return public._open_shift(v_org, null, 'qr', p_idempotency_key);
end;
$$;

-- Clock in from inside the app, without scanning.
create or replace function public.clock_in_direct(
  p_org uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_enabled boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select direct_clocking_enabled into v_enabled
  from public.organization_settings where organization_id = p_org;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'direct_clocking_disabled');
  end if;

  return public._open_shift(p_org, null, 'app', p_idempotency_key);
end;
$$;

-- Shared clock-out body: closes the shift and freezes the payable calculation
-- using the break policy in force right now.
create or replace function public._close_shift(
  p_org uuid,
  p_station uuid,
  p_method text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_membership uuid;
  v_shift public.shifts%rowtype;
  v_now timestamptz := now();
  v_gross integer;
  v_unpaid integer := 0;
  v_payable integer;
  v_settings public.organization_settings%rowtype;
  v_open_breaks integer;
  v_cached jsonb;
  v_result jsonb;
  v_snapshot jsonb;
begin
  -- role <> 'station': a display device never records attendance of its own,
  -- and a pending applicant is not yet staff.
  select id into v_membership
  from public.organization_memberships
  where organization_id = p_org and user_id = v_user
    and status = 'active' and role <> 'station';

  if v_membership is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;

  if p_idempotency_key is not null then
    select result into v_cached
    from public.idempotency_keys
    where user_id = v_user and scope = 'clock_out' and key = p_idempotency_key;
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  -- Lock the open shift so a concurrent clock-out cannot close it twice.
  select * into v_shift
  from public.shifts
  where employee_membership_id = v_membership and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_active_shift');
  end if;

  select count(*) into v_open_breaks
  from public.break_records
  where shift_id = v_shift.id and ended_at is null;

  if v_open_breaks > 0 then
    -- MVP policy: the employee ends the break explicitly before clocking out.
    return jsonb_build_object('ok', false, 'code', 'break_in_progress');
  end if;

  select * into v_settings
  from public.organization_settings where organization_id = p_org;

  v_gross := floor(extract(epoch from (v_now - v_shift.started_at)) / 60.0)::integer;

  if v_settings.break_mode = 'manual' then
    select coalesce(sum(duration_minutes), 0) into v_unpaid
    from public.break_records
    where shift_id = v_shift.id and ended_at is not null and is_paid = false;
    v_snapshot := jsonb_build_object('mode', 'manual');
  elsif v_settings.break_mode = 'automatic' then
    if v_gross >= v_settings.automatic_break_threshold_minutes then
      v_unpaid := v_settings.automatic_break_minutes;
    else
      v_unpaid := 0;
    end if;
    v_snapshot := jsonb_build_object(
      'mode', 'automatic',
      'automatic_break_minutes', v_settings.automatic_break_minutes,
      'threshold_minutes', v_settings.automatic_break_threshold_minutes
    );
  else
    v_unpaid := 0;
    v_snapshot := jsonb_build_object('mode', 'none');
  end if;

  v_payable := greatest(v_gross - v_unpaid, 0);

  update public.shifts
    set ended_at = v_now,
        status = 'completed',
        clock_out_method = coalesce(p_method, 'qr'),
        gross_minutes = v_gross,
        unpaid_break_minutes = v_unpaid,
        payable_minutes = v_payable,
        break_policy_snapshot = v_snapshot
    where id = v_shift.id;

  insert into public.attendance_events (
    organization_id, shift_id, employee_membership_id,
    event_type, occurred_at, station_id, method, recorded_by
  )
  values (p_org, v_shift.id, v_membership, 'clock_out', v_now, p_station,
          coalesce(p_method, 'qr'), v_user);

  v_result := jsonb_build_object(
    'ok', true,
    'shift_id', v_shift.id,
    'started_at', v_shift.started_at,
    'ended_at', v_now,
    'gross_minutes', v_gross,
    'unpaid_break_minutes', v_unpaid,
    'payable_minutes', v_payable
  );

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (organization_id, user_id, scope, key, result)
    values (p_org, v_user, 'clock_out', p_idempotency_key, v_result)
    on conflict (user_id, scope, key) do nothing;
  end if;

  return v_result;
end;
$$;

create or replace function public.clock_out_with_token(
  p_token_hash text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select organization_id into v_org from public.resolve_org_token(p_token_hash);

  if v_org is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_or_expired_token');
  end if;

  return public._close_shift(v_org, null, 'qr', p_idempotency_key);
end;
$$;

create or replace function public.clock_out_direct(
  p_org uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_enabled boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;

  select direct_clocking_enabled into v_enabled
  from public.organization_settings where organization_id = p_org;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'code', 'direct_clocking_disabled');
  end if;

  return public._close_shift(p_org, null, 'app', p_idempotency_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- Breaks
-- ---------------------------------------------------------------------------

create or replace function public.start_break(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_membership uuid;
  v_shift public.shifts%rowtype;
  v_mode break_mode;
  v_break uuid;
  v_now timestamptz := now();
begin
  -- role <> 'station': a display device never records attendance of its own,
  -- and a pending applicant is not yet staff.
  select id into v_membership
  from public.organization_memberships
  where organization_id = p_org and user_id = v_user
    and status = 'active' and role <> 'station';

  if v_membership is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;

  select break_mode into v_mode
  from public.organization_settings where organization_id = p_org;

  if v_mode is distinct from 'manual' then
    return jsonb_build_object('ok', false, 'code', 'manual_breaks_disabled');
  end if;

  select * into v_shift
  from public.shifts
  where employee_membership_id = v_membership and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_active_shift');
  end if;

  begin
    insert into public.break_records (organization_id, shift_id, started_at, is_paid)
    values (p_org, v_shift.id, v_now, false)
    returning id into v_break;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'break_already_active');
  end;

  insert into public.attendance_events (
    organization_id, shift_id, employee_membership_id, event_type, occurred_at, recorded_by
  )
  values (p_org, v_shift.id, v_membership, 'break_start', v_now, v_user);

  return jsonb_build_object('ok', true, 'break_id', v_break, 'started_at', v_now);
end;
$$;

create or replace function public.end_break(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_membership uuid;
  v_shift public.shifts%rowtype;
  v_break public.break_records%rowtype;
  v_now timestamptz := now();
  v_minutes integer;
begin
  -- role <> 'station': a display device never records attendance of its own,
  -- and a pending applicant is not yet staff.
  select id into v_membership
  from public.organization_memberships
  where organization_id = p_org and user_id = v_user
    and status = 'active' and role <> 'station';

  if v_membership is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;

  select * into v_shift
  from public.shifts
  where employee_membership_id = v_membership and status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_active_shift');
  end if;

  select * into v_break
  from public.break_records
  where shift_id = v_shift.id and ended_at is null
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_active_break');
  end if;

  v_minutes := floor(extract(epoch from (v_now - v_break.started_at)) / 60.0)::integer;

  update public.break_records
    set ended_at = v_now, duration_minutes = v_minutes
    where id = v_break.id;

  insert into public.attendance_events (
    organization_id, shift_id, employee_membership_id, event_type, occurred_at, recorded_by
  )
  values (p_org, v_shift.id, v_membership, 'break_end', v_now, v_user);

  return jsonb_build_object(
    'ok', true, 'break_id', v_break.id,
    'ended_at', v_now, 'duration_minutes', v_minutes
  );
end;
$$;
