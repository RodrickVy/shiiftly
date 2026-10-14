-- Shiftly :: 0006_grants
--
-- RLS filters rows, but only among the privileges a role already holds.
-- These grants are deliberately narrow: the `authenticated` role gets SELECT
-- where a read policy exists, and direct write access only where a policy can
-- express the rule safely. Everything else is reached through the SECURITY
-- DEFINER functions in 0003/0005, which re-check the caller.
--
-- `anon` gets nothing at all: there is no public data in Shiftly.

grant usage on schema public to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Reads
-- --------------------------------------------------------------------------

grant select on
  public.profiles,
  public.organizations,
  public.organization_memberships,
  public.organization_settings,
  public.invitations,
  public.clocking_stations,
  public.station_daily_tokens,
  public.shifts,
  public.attendance_events,
  public.break_records,
  public.timesheets,
  public.attendance_adjustments,
  public.tasks,
  public.task_assignments,
  public.time_off_requests,
  public.pay_rates,
  public.payroll_periods,
  public.payroll_entries,
  public.notifications,
  public.audit_logs,
  public.idempotency_keys
to authenticated;

-- --------------------------------------------------------------------------
-- Writes reachable directly (each is covered by a WITH CHECK policy)
-- --------------------------------------------------------------------------

grant insert, update on public.profiles to authenticated;
grant update on public.organizations to authenticated;
grant update on public.organization_memberships to authenticated;
grant update on public.organization_settings to authenticated;
grant insert, update on public.invitations to authenticated;
grant insert, update, delete on public.clocking_stations to authenticated;
grant insert, update on public.timesheets to authenticated;
grant insert, update on public.attendance_adjustments to authenticated;
grant insert, delete on public.tasks to authenticated;
grant insert, delete on public.task_assignments to authenticated;
grant insert, update on public.payroll_periods to authenticated;
grant insert, update, delete on public.payroll_entries to authenticated;
grant update on public.notifications to authenticated;

-- Managers correct attendance through adjustments; this grant backs the
-- manager-only UPDATE policy on shifts.
grant update on public.shifts to authenticated;

-- A task assignee may move a task along, and nothing more. completed_at is
-- maintained by a trigger, so `status` is the only column anyone needs.
grant update (status) on public.tasks to authenticated;

grant insert, update on public.time_off_requests to authenticated;

-- --------------------------------------------------------------------------
-- Never writable by users
-- --------------------------------------------------------------------------
--   attendance_events  : immutable audit trail, written by functions only
--   break_records      : written by start_break / end_break
--   station_daily_tokens: minted server-side
--   pay_rates          : written by set_pay_rate (owner only)
--   audit_logs         : append-only, written by functions
--   notification_deliveries : service role only

-- --------------------------------------------------------------------------
-- Callable operations
-- --------------------------------------------------------------------------

grant execute on function
  public.is_org_member(uuid),
  public.is_org_manager(uuid),
  public.is_org_owner(uuid),
  public.current_membership_id(uuid),
  public.is_own_membership(uuid),
  public.manages_membership(uuid),
  public.create_organization(text, text, text, text, text, smallint, smallint[]),
  public.accept_invitation(text, text, text),
  public.clock_in_with_token(text, text),
  public.clock_in_direct(uuid, text),
  public.clock_out_with_token(text, text),
  public.clock_out_direct(uuid, text),
  public.start_break(uuid),
  public.end_break(uuid),
  public.manager_update_task(uuid, text, text, task_priority, timestamptz),
  public.set_task_assignees(uuid, uuid[]),
  public.submit_time_off_request(uuid, text, date, date, text),
  public.review_time_off_request(uuid, time_off_status, text),
  public.set_member_role(uuid, membership_role),
  public.set_member_status(uuid, membership_status),
  public.set_pay_rate(uuid, numeric, date, text)
to authenticated;

-- Internal helpers: not part of the callable surface.
revoke execute on function
  public._open_shift(uuid, uuid, text, text),
  public._close_shift(uuid, uuid, text, text),
  public.queue_notification(uuid, uuid, text, text, text, text, boolean),
  public.resolve_station_token(text)
from public, anon, authenticated;
