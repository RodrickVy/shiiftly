-- Shiftly :: 0008_profile_relationships
--
-- Points membership and note authorship at `profiles` rather than at
-- `auth.users`.
--
-- Why this matters beyond tidiness: PostgREST builds its embedding graph
-- from foreign keys. `organization_memberships.user_id` referenced
-- auth.users, and `profiles.id` referenced auth.users, but nothing joined
-- the two directly -- so `select('*, profiles(full_name)')` failed with
-- "Could not find a relationship", the whole query errored, and every screen
-- that lists people silently rendered empty. The data was always correct;
-- it simply could not be read that way.
--
-- One FK per column, deliberately. Adding a second reference alongside the
-- auth.users one would make the relationship ambiguous and PostgREST would
-- refuse the embed for a different reason.
--
-- This migration is written to run against a database that already holds
-- data, so it backfills any missing profile before adding the constraint.

-- ---------------------------------------------------------------------------
-- Backfill: every membership must have a profile to point at
-- ---------------------------------------------------------------------------

insert into public.profiles (id, full_name, email)
select distinct u.id,
       coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), 'Member'),
       coalesce(u.email, '')
from auth.users u
join public.organization_memberships m on m.user_id = u.id
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- organization_memberships.user_id -> profiles.id
-- ---------------------------------------------------------------------------

alter table public.organization_memberships
  drop constraint if exists organization_memberships_user_id_fkey;

alter table public.organization_memberships
  add constraint organization_memberships_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- employee_notes.author_user_id -> profiles.id
--
-- SET NULL, not CASCADE: a note is a record about the organization, not
-- about whoever typed it, so it outlives its author.
-- ---------------------------------------------------------------------------

alter table public.employee_notes
  drop constraint if exists employee_notes_author_user_id_fkey;

alter table public.employee_notes
  add constraint employee_notes_author_user_id_fkey
  foreign key (author_user_id) references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- A membership now requires a profile, so creating an organization must make
-- one rather than assuming the caller already did.
-- ---------------------------------------------------------------------------

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
  v_email text;
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

  select email into v_email from auth.users where id = v_user;

  -- The membership below references profiles, so make sure one exists.
  insert into public.profiles (id, full_name, email)
  values (v_user,
          coalesce(nullif(btrim(split_part(coalesce(v_email, ''), '@', 1)), ''), 'Owner'),
          coalesce(v_email, ''))
  on conflict (id) do nothing;

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

-- PostgREST caches the relationship graph; tell it to pick up the new keys.
notify pgrst, 'reload schema';
