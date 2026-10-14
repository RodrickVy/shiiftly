#!/usr/bin/env node
/**
 * Concatenates the migrations in order so they can be applied without the
 * Supabase CLI -- paste the output into the SQL editor in the Supabase
 * dashboard, or pipe it into psql.
 *
 *   node scripts/db-apply.mjs > schema.sql
 *   node scripts/db-apply.mjs | psql "$DATABASE_URL"
 *
 * The files are plain SQL and idempotent only in the sense that they are
 * meant to run once, in order, against a fresh database.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../supabase/migrations', import.meta.url));
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

/**
 * --reset prepends statements that drop everything this schema owns, so the
 * file can be re-applied to a project that already has an older version of
 * it. DESTRUCTIVE: every Shiftly row goes with it.
 *
 * Accounts are NOT touched. auth.users belongs to Supabase, so people keep
 * their logins and simply re-create their organization.
 */
const reset = process.argv.includes('--reset');

const RESET_SQL = `-- ======================================================================
-- RESET (destructive)
--
-- Drops every object this schema owns. All Shiftly data is lost.
-- auth.users is deliberately untouched: sign-ins survive.
-- ======================================================================

drop table if exists
  public.idempotency_keys,
  public.audit_logs,
  public.notification_deliveries,
  public.notifications,
  public.payroll_entries,
  public.payroll_periods,
  public.pay_rates,
  public.time_off_requests,
  public.task_assignments,
  public.tasks,
  public.attendance_adjustments,
  public.timesheets,
  public.break_records,
  public.attendance_events,
  public.shifts,
  public.organization_daily_tokens,
  public.station_daily_tokens,
  public.clocking_stations,
  public.invitations,
  public.organization_settings,
  public.organization_memberships,
  public.organizations,
  public.profiles
cascade;

drop function if exists
  public.touch_updated_at,
  public.is_org_member,
  public.is_org_station,
  public.is_org_manager,
  public.is_org_owner,
  public.current_membership_id,
  public.is_own_membership,
  public.manages_membership,
  public.create_organization,
  public.accept_invitation,
  public.request_to_join,
  public.review_join_request,
  public.claim_station,
  public.resolve_station_token,
  public.resolve_org_token,
  public._open_shift,
  public._close_shift,
  public.clock_in_with_token,
  public.clock_out_with_token,
  public.clock_in_direct,
  public.clock_out_direct,
  public.start_break,
  public.end_break,
  public.sync_task_completed_at,
  public.sync_membership_deactivated_at,
  public.guard_last_owner,
  public.queue_notification,
  public.manager_update_task,
  public.set_task_assignees,
  public.submit_time_off_request,
  public.review_time_off_request,
  public.set_member_role,
  public.set_member_status,
  public.set_pay_rate
cascade;

drop type if exists
  membership_role, membership_status, invitation_role, break_mode,
  shift_status, attendance_event_type, timesheet_status, adjustment_status,
  task_priority, task_status, time_off_status, payroll_period_status,
  notification_channel, delivery_status
cascade;
`;

const parts = [
	'-- Shiftly schema',
	`-- Generated ${new Date().toISOString()} from supabase/migrations`,
	'-- Apply against a fresh Supabase project (the auth schema must exist).',
	''
];

if (reset) parts.push(RESET_SQL, '');

for (const file of files) {
	parts.push(`-- ${'='.repeat(70)}`);
	parts.push(`-- ${file}`);
	parts.push(`-- ${'='.repeat(70)}`);
	parts.push(await readFile(join(dir, file), 'utf8'));
	parts.push('');
}

// Piping into `head` closes stdout early; that is not an error worth a
// stack trace.
process.stdout.on('error', (err) => {
	if (err.code === 'EPIPE') process.exit(0);
	throw err;
});

process.stdout.write(parts.join('\n'));
