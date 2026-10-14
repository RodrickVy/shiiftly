-- Shiftly :: 0001_init
-- Enum types and shared trigger helpers.
--
-- Note: this schema deliberately avoids the pgcrypto extension. Token hashing
-- happens in application code (Node WebCrypto) so the database never sees a raw
-- token, and so the schema stays portable across Postgres builds that do not
-- ship pgcrypto. gen_random_uuid() is Postgres core since v13.

create type membership_role as enum ('owner', 'manager', 'employee');
create type membership_status as enum ('active', 'inactive');
create type invitation_role as enum ('manager', 'employee');
create type break_mode as enum ('automatic', 'manual', 'none');
create type shift_status as enum ('active', 'completed', 'flagged');
create type attendance_event_type as enum ('clock_in', 'break_start', 'break_end', 'clock_out');
create type timesheet_status as enum ('draft', 'pending', 'approved', 'rejected');
create type adjustment_status as enum ('pending', 'approved', 'rejected');
create type task_priority as enum ('low', 'medium', 'high');
create type task_status as enum ('todo', 'in_progress', 'completed', 'cancelled');
create type time_off_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type payroll_period_status as enum ('open', 'reviewed', 'exported');
create type notification_channel as enum ('email');
create type delivery_status as enum ('pending', 'sent', 'failed');

-- Keeps updated_at honest without trusting the client.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
