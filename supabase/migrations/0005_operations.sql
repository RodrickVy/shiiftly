-- Shiftly :: 0005_operations
--
-- Triggers that keep derived columns truthful no matter who writes, plus the
-- manager-side operations that have to be atomic (a decision and the
-- notification it produces must land together) or auditable.

-- ---------------------------------------------------------------------------
-- Derived-column triggers
-- ---------------------------------------------------------------------------

-- completed_at is maintained by the database, so clients only ever send
-- `status`. This lets the UPDATE grant be narrowed to that single column.
create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_sync_completed
  before insert or update on public.tasks
  for each row execute function public.sync_task_completed_at();

create or replace function public.sync_membership_deactivated_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'inactive' then
    new.deactivated_at := coalesce(new.deactivated_at, now());
  else
    new.deactivated_at := null;
  end if;
  return new;
end;
$$;

create trigger memberships_sync_deactivated
  before insert or update on public.organization_memberships
  for each row execute function public.sync_membership_deactivated_at();

-- An organization must never be left without an owner.
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
as $$
declare
  v_owners integer;
begin
  if old.role = 'owner' and (new.role <> 'owner' or new.status = 'inactive') then
    select count(*) into v_owners
    from public.organization_memberships
    where organization_id = old.organization_id
      and role = 'owner'
      and status = 'active'
      and id <> old.id;
    if v_owners = 0 then
      raise exception 'cannot remove the last active owner of an organization'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger memberships_guard_last_owner
  before update on public.organization_memberships
  for each row execute function public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- Notification helper
-- ---------------------------------------------------------------------------

-- Persists the notification and a pending delivery row in the same
-- transaction as the thing that caused it. Email sending happens afterwards
-- and may fail or be retried without affecting the decision itself.
create or replace function public.queue_notification(
  p_org uuid,
  p_recipient uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text default null,
  p_email boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
begin
  insert into public.notifications (organization_id, recipient_user_id, type, title, body, link)
  values (p_org, p_recipient, p_type, p_title, p_body, p_link)
  returning id into v_id;

  if p_email then
    insert into public.notification_deliveries (notification_id, channel, status)
    values (v_id, 'email', 'pending')
    on conflict (notification_id, channel) do nothing;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create or replace function public.manager_update_task(
  p_task uuid,
  p_title text,
  p_description text,
  p_priority task_priority,
  p_due_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.tasks where id = p_task;
  if v_org is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  update public.tasks
    set title = btrim(p_title),
        description = nullif(btrim(coalesce(p_description, '')), ''),
        priority = p_priority,
        due_at = p_due_at
    where id = p_task;

  return jsonb_build_object('ok', true);
end;
$$;

-- Replaces a task's assignee set in one transaction.
create or replace function public.set_task_assignees(
  p_task uuid,
  p_memberships uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org uuid;
  v_bad integer;
begin
  select organization_id into v_org from public.tasks where id = p_task;
  if v_org is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.is_org_manager(v_org) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  -- Refuse assignees from another organization.
  select count(*) into v_bad
  from unnest(coalesce(p_memberships, '{}'::uuid[])) as m(id)
  left join public.organization_memberships om
    on om.id = m.id and om.organization_id = v_org and om.status = 'active'
  where om.id is null;

  if v_bad > 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_assignee');
  end if;

  delete from public.task_assignments
  where task_id = p_task
    and employee_membership_id <> all (coalesce(p_memberships, '{}'::uuid[]));

  insert into public.task_assignments (organization_id, task_id, employee_membership_id)
  select v_org, p_task, m.id
  from unnest(coalesce(p_memberships, '{}'::uuid[])) as m(id)
  on conflict (task_id, employee_membership_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Time off
-- ---------------------------------------------------------------------------

-- Creates the request and queues a notification for every manager, atomically.
create or replace function public.submit_time_off_request(
  p_org uuid,
  p_leave_type text,
  p_start date,
  p_end date,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_membership uuid;
  v_request uuid;
  v_name text;
  v_notify boolean;
  v_manager record;
begin
  select id into v_membership
  from public.organization_memberships
  where organization_id = p_org and user_id = v_user and status = 'active';

  if v_membership is null then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;

  if p_end < p_start then
    return jsonb_build_object('ok', false, 'code', 'invalid_date_range');
  end if;

  insert into public.time_off_requests (
    organization_id, employee_membership_id, leave_type, start_date, end_date, reason, status
  )
  values (p_org, v_membership, p_leave_type, p_start, p_end,
          nullif(btrim(coalesce(p_reason, '')), ''), 'pending')
  returning id into v_request;

  select coalesce(full_name, 'An employee') into v_name from public.profiles where id = v_user;
  select notify_managers_on_time_off into v_notify
  from public.organization_settings where organization_id = p_org;

  if coalesce(v_notify, true) then
    for v_manager in
      select user_id from public.organization_memberships
      where organization_id = p_org and status = 'active' and role in ('owner', 'manager')
    loop
      perform public.queue_notification(
        p_org, v_manager.user_id, 'time_off.requested',
        'New time-off request',
        coalesce(v_name, 'An employee') || ' requested ' || p_leave_type ||
          ' from ' || to_char(p_start, 'YYYY-MM-DD') || ' to ' || to_char(p_end, 'YYYY-MM-DD') || '.',
        '/app/time-off'
      );
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'request_id', v_request);
end;
$$;

create or replace function public.review_time_off_request(
  p_request uuid,
  p_status time_off_status,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_req public.time_off_requests%rowtype;
  v_employee uuid;
  v_notify boolean;
begin
  if p_status not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;

  select * into v_req from public.time_off_requests where id = p_request for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not public.is_org_manager(v_req.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  -- Segregation of duties: a manager may not decide their own request.
  -- An owner may, because there is nobody above them to ask; that decision is
  -- recorded in the audit log like any other.
  if public.is_own_membership(v_req.employee_membership_id)
     and not public.is_org_owner(v_req.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'cannot_review_own_request');
  end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already_reviewed');
  end if;

  update public.time_off_requests
    set status = p_status,
        reviewed_by = v_user,
        reviewed_at = now(),
        manager_comment = nullif(btrim(coalesce(p_comment, '')), '')
    where id = p_request;

  select user_id into v_employee
  from public.organization_memberships where id = v_req.employee_membership_id;

  select notify_employee_on_decision into v_notify
  from public.organization_settings where organization_id = v_req.organization_id;

  if coalesce(v_notify, true) and v_employee is not null then
    perform public.queue_notification(
      v_req.organization_id, v_employee, 'time_off.reviewed',
      'Time-off request ' || p_status::text,
      'Your ' || v_req.leave_type || ' request for ' ||
        to_char(v_req.start_date, 'YYYY-MM-DD') || ' to ' ||
        to_char(v_req.end_date, 'YYYY-MM-DD') || ' was ' || p_status::text || '.',
      '/app/my-time-off'
    );
  end if;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_req.organization_id, v_user, 'time_off.' || p_status::text, 'time_off_request', p_request,
          jsonb_build_object('employee_membership_id', v_req.employee_membership_id));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Membership administration
-- ---------------------------------------------------------------------------

create or replace function public.set_member_role(
  p_membership uuid,
  p_role membership_role
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_row public.organization_memberships%rowtype;
begin
  select * into v_row from public.organization_memberships where id = p_membership;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Only an owner may change roles at all, and only an owner may mint owners.
  if not public.is_org_owner(v_row.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  begin
    update public.organization_memberships set role = p_role where id = p_membership;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_row.organization_id, v_user, 'membership.role_changed', 'membership', p_membership,
          jsonb_build_object('from', v_row.role, 'to', p_role));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_member_status(
  p_membership uuid,
  p_status membership_status
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_row public.organization_memberships%rowtype;
begin
  select * into v_row from public.organization_memberships where id = p_membership;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not public.is_org_manager(v_row.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  -- A manager may not deactivate an owner; that is an owner-level action.
  if v_row.role = 'owner' and not public.is_org_owner(v_row.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  begin
    update public.organization_memberships set status = p_status where id = p_membership;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_row.organization_id, v_user, 'membership.status_changed', 'membership', p_membership,
          jsonb_build_object('from', v_row.status, 'to', p_status));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pay rates
-- ---------------------------------------------------------------------------

-- Opens a new rate and closes the previous one the day before, so historical
-- periods keep resolving to the rate that actually applied then.
create or replace function public.set_pay_rate(
  p_membership uuid,
  p_hourly_rate numeric,
  p_effective_from date,
  p_currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_currency text;
begin
  select organization_id into v_org
  from public.organization_memberships where id = p_membership;

  if v_org is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Pay is owner-level information in this MVP.
  if not public.is_org_owner(v_org) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if p_hourly_rate < 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_rate');
  end if;

  select coalesce(p_currency, currency_code) into v_currency
  from public.organizations where id = v_org;

  update public.pay_rates
    set effective_until = p_effective_from - 1
    where employee_membership_id = p_membership
      and effective_from < p_effective_from
      and (effective_until is null or effective_until >= p_effective_from);

  insert into public.pay_rates (
    organization_id, employee_membership_id, hourly_rate, currency_code, effective_from, created_by
  )
  values (v_org, p_membership, p_hourly_rate, upper(v_currency), p_effective_from, v_user)
  on conflict (employee_membership_id, effective_from) do update
    set hourly_rate = excluded.hourly_rate,
        currency_code = excluded.currency_code,
        effective_until = null;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org, v_user, 'pay_rate.set', 'membership', p_membership,
          jsonb_build_object('hourly_rate', p_hourly_rate, 'effective_from', p_effective_from));

  return jsonb_build_object('ok', true);
end;
$$;
