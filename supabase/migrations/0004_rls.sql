-- Shiftly :: 0004_rls
--
-- Row Level Security is the second line of defence. The application already
-- checks authorization in server code; these policies make sure a mistake
-- there (or a direct PostgREST call with a user's token) still cannot read
-- another organization's data or another employee's private records.
--
-- Reading convention used throughout:
--   * managers (owner|manager) see the whole organization
--   * employees see their own rows only
--   * writes that must stay auditable go through SECURITY DEFINER functions
--     rather than direct table grants

alter table public.profiles                enable row level security;
alter table public.organizations           enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_settings   enable row level security;
alter table public.invitations             enable row level security;
alter table public.clocking_stations       enable row level security;
alter table public.station_daily_tokens    enable row level security;
alter table public.shifts                  enable row level security;
alter table public.attendance_events       enable row level security;
alter table public.break_records           enable row level security;
alter table public.timesheets              enable row level security;
alter table public.attendance_adjustments  enable row level security;
alter table public.tasks                   enable row level security;
alter table public.task_assignments        enable row level security;
alter table public.time_off_requests       enable row level security;
alter table public.pay_rates               enable row level security;
alter table public.payroll_periods         enable row level security;
alter table public.payroll_entries         enable row level security;
alter table public.notifications           enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.idempotency_keys        enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

-- Colleagues need each other's names to render attendance lists.
create policy profiles_select_colleagues on public.profiles
  for select using (
    exists (
      select 1
      from public.organization_memberships them
      join public.organization_memberships me
        on me.organization_id = them.organization_id
      where them.user_id = public.profiles.id
        and me.user_id = auth.uid()
        and me.status = 'active'
    )
  );

create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create policy organizations_select_members on public.organizations
  for select using (public.is_org_member(id));

create policy organizations_update_owner on public.organizations
  for update using (public.is_org_owner(id)) with check (public.is_org_owner(id));

-- ---------------------------------------------------------------------------
-- organization_memberships
-- ---------------------------------------------------------------------------

create policy memberships_select_own on public.organization_memberships
  for select using (user_id = auth.uid());

create policy memberships_select_managers on public.organization_memberships
  for select using (public.is_org_manager(organization_id));

create policy memberships_update_managers on public.organization_memberships
  for update using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- organization_settings
-- ---------------------------------------------------------------------------

create policy settings_select_members on public.organization_settings
  for select using (public.is_org_member(organization_id));

create policy settings_update_managers on public.organization_settings
  for update using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- invitations  (managers only; redemption goes through accept_invitation)
-- ---------------------------------------------------------------------------

create policy invitations_select_managers on public.invitations
  for select using (public.is_org_manager(organization_id));

create policy invitations_insert_managers on public.invitations
  for insert with check (public.is_org_manager(organization_id));

create policy invitations_update_managers on public.invitations
  for update using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- stations and daily tokens
-- ---------------------------------------------------------------------------

create policy stations_select_members on public.clocking_stations
  for select using (public.is_org_member(organization_id));

create policy stations_write_managers on public.clocking_stations
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- Only managers may read token rows. Employees never need them: scanning goes
-- through resolve_station_token(), which is SECURITY DEFINER.
create policy station_tokens_managers on public.station_daily_tokens
  for select using (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- shifts / events / breaks
-- ---------------------------------------------------------------------------

create policy shifts_select_own on public.shifts
  for select using (public.is_own_membership(employee_membership_id));

create policy shifts_select_managers on public.shifts
  for select using (public.is_org_manager(organization_id));

-- Direct writes are reserved for managers making corrections; ordinary
-- clocking goes through the attendance functions.
create policy shifts_update_managers on public.shifts
  for update using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

create policy events_select_own on public.attendance_events
  for select using (public.is_own_membership(employee_membership_id));

create policy events_select_managers on public.attendance_events
  for select using (public.is_org_manager(organization_id));

-- Deliberately no insert/update/delete policy: attendance events are
-- immutable to ordinary users and are only written by SECURITY DEFINER
-- functions.

create policy breaks_select_own on public.break_records
  for select using (
    exists (
      select 1 from public.shifts s
      where s.id = public.break_records.shift_id
        and public.is_own_membership(s.employee_membership_id)
    )
  );

create policy breaks_select_managers on public.break_records
  for select using (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- timesheets and adjustments
-- ---------------------------------------------------------------------------

create policy timesheets_select_own on public.timesheets
  for select using (public.is_own_membership(employee_membership_id));

create policy timesheets_select_managers on public.timesheets
  for select using (public.is_org_manager(organization_id));

create policy timesheets_write_managers on public.timesheets
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

create policy adjustments_select_own on public.attendance_adjustments
  for select using (
    exists (
      select 1 from public.shifts s
      where s.id = public.attendance_adjustments.shift_id
        and public.is_own_membership(s.employee_membership_id)
    )
  );

create policy adjustments_managers on public.attendance_adjustments
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

create policy tasks_select_assigned on public.tasks
  for select using (
    exists (
      select 1 from public.task_assignments a
      where a.task_id = public.tasks.id
        and public.is_own_membership(a.employee_membership_id)
    )
  );

create policy tasks_select_managers on public.tasks
  for select using (public.is_org_manager(organization_id));

create policy tasks_write_managers on public.tasks
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- Assignees may move their own task along, but only through the status
-- column; the update policy below is paired with a column grant in 0005.
create policy tasks_update_assignee on public.tasks
  for update using (
    exists (
      select 1 from public.task_assignments a
      where a.task_id = public.tasks.id
        and public.is_own_membership(a.employee_membership_id)
    )
  )
  with check (
    exists (
      select 1 from public.task_assignments a
      where a.task_id = public.tasks.id
        and public.is_own_membership(a.employee_membership_id)
    )
  );

create policy task_assignments_select_own on public.task_assignments
  for select using (public.is_own_membership(employee_membership_id));

create policy task_assignments_managers on public.task_assignments
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- time off
-- ---------------------------------------------------------------------------

create policy time_off_select_own on public.time_off_requests
  for select using (public.is_own_membership(employee_membership_id));

create policy time_off_select_managers on public.time_off_requests
  for select using (public.is_org_manager(organization_id));

create policy time_off_insert_own on public.time_off_requests
  for insert with check (
    public.is_own_membership(employee_membership_id)
    and public.is_org_member(organization_id)
    and status = 'pending'
  );

-- An employee may cancel their own pending request. Approval is a manager
-- action and is additionally re-checked in server code.
create policy time_off_update_own on public.time_off_requests
  for update using (
    public.is_own_membership(employee_membership_id) and status = 'pending'
  )
  with check (public.is_own_membership(employee_membership_id));

create policy time_off_update_managers on public.time_off_requests
  for update using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- pay and payroll  (pay data is manager-only, plus the employee's own rate)
-- ---------------------------------------------------------------------------

create policy pay_rates_select_own on public.pay_rates
  for select using (public.is_own_membership(employee_membership_id));

create policy pay_rates_select_managers on public.pay_rates
  for select using (public.is_org_manager(organization_id));

create policy pay_rates_write_managers on public.pay_rates
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

create policy payroll_periods_managers on public.payroll_periods
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

create policy payroll_entries_select_own on public.payroll_entries
  for select using (public.is_own_membership(employee_membership_id));

create policy payroll_entries_managers on public.payroll_entries
  for all using (public.is_org_manager(organization_id))
  with check (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- notifications and audit
-- ---------------------------------------------------------------------------

create policy notifications_select_own on public.notifications
  for select using (recipient_user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- Delivery rows are infrastructure: only the service role touches them.
create policy deliveries_none on public.notification_deliveries
  for select using (false);

create policy audit_select_managers on public.audit_logs
  for select using (public.is_org_manager(organization_id));

create policy idempotency_select_own on public.idempotency_keys
  for select using (user_id = auth.uid());
