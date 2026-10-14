-- Shiftly :: 0002_tables
-- Core multi-tenant schema. Every organization-owned table carries
-- organization_id so that tenant isolation can be enforced by a single,
-- uniform RLS rule rather than by per-table reasoning.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  email text not null,
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  industry text,
  country_code char(2) not null,
  timezone text not null,
  currency_code char(3) not null,
  logo_url text,
  -- 0 = Sunday .. 6 = Saturday
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  workweek_days smallint[] not null default '{1,2,3,4,5}',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_touch
  before update on public.organizations
  for each row execute function public.touch_updated_at();

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role membership_role not null default 'employee',
  status membership_status not null default 'active',
  employee_code text,
  job_title text,
  department text,
  start_date date,
  joined_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_unique_user unique (organization_id, user_id),
  constraint memberships_deactivated_consistent
    check ((status = 'inactive') = (deactivated_at is not null))
);

create unique index memberships_employee_code_unique
  on public.organization_memberships (organization_id, employee_code)
  where employee_code is not null;

create index memberships_by_org on public.organization_memberships (organization_id, status);
create index memberships_by_user on public.organization_memberships (user_id);

create trigger memberships_touch
  before update on public.organization_memberships
  for each row execute function public.touch_updated_at();

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  qr_clocking_enabled boolean not null default true,
  -- Clock in/out from inside the app without scanning a station code.
  direct_clocking_enabled boolean not null default true,
  break_mode break_mode not null default 'none',
  automatic_break_minutes integer not null default 30 check (automatic_break_minutes between 0 and 480),
  automatic_break_threshold_minutes integer not null default 360
    check (automatic_break_threshold_minutes between 0 and 1440),
  minimum_shift_minutes integer check (minimum_shift_minutes is null or minimum_shift_minutes between 0 and 1440),
  timesheet_approval_required boolean not null default true,
  allow_manager_corrections boolean not null default true,
  employee_earnings_visible boolean not null default true,
  notify_managers_on_time_off boolean not null default true,
  notify_employee_on_decision boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger organization_settings_touch
  before update on public.organization_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Only the hash is stored; the raw token lives in the invite link alone.
  token_hash text not null unique,
  -- Null means a reusable link invitation; set means the link is bound to
  -- this address and only that address may redeem it.
  invited_email text,
  role invitation_role not null default 'employee',
  max_uses integer not null default 1 check (max_uses between 1 and 500),
  use_count integer not null default 0 check (use_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint invitations_uses_within_max check (use_count <= max_uses)
);

create index invitations_by_org on public.invitations (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Clocking stations and their daily QR tokens
-- ---------------------------------------------------------------------------

create table public.clocking_stations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stations_by_org on public.clocking_stations (organization_id, is_active);

create trigger clocking_stations_touch
  before update on public.clocking_stations
  for each row execute function public.touch_updated_at();

create table public.station_daily_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  station_id uuid not null references public.clocking_stations (id) on delete cascade,
  -- The organization-local calendar day this token is valid for.
  local_date date not null,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint station_daily_tokens_unique_day unique (station_id, local_date)
);

-- Lookup path used on every scan.
create unique index station_daily_tokens_hash on public.station_daily_tokens (token_hash);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  station_id uuid references public.clocking_stations (id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status shift_status not null default 'active',
  clock_in_method text not null default 'qr',
  clock_out_method text,
  -- Populated at clock-out from the break policy in force at that moment, so
  -- later policy changes cannot silently rewrite historical payable time.
  gross_minutes integer,
  unpaid_break_minutes integer,
  payable_minutes integer,
  break_policy_snapshot jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_end_after_start check (ended_at is null or ended_at > started_at),
  constraint shifts_active_has_no_end check ((status = 'active') = (ended_at is null)),
  constraint shifts_payable_non_negative check (payable_minutes is null or payable_minutes >= 0)
);

-- Hard guarantee behind "an employee cannot have two open shifts", including
-- under concurrent requests.
create unique index shifts_one_active_per_membership
  on public.shifts (employee_membership_id)
  where status = 'active';

create index shifts_by_org_time on public.shifts (organization_id, started_at desc);
create index shifts_by_membership_time on public.shifts (employee_membership_id, started_at desc);

create trigger shifts_touch
  before update on public.shifts
  for each row execute function public.touch_updated_at();

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shift_id uuid not null references public.shifts (id) on delete cascade,
  employee_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  event_type attendance_event_type not null,
  occurred_at timestamptz not null,
  station_id uuid references public.clocking_stations (id) on delete set null,
  method text,
  recorded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index attendance_events_by_shift on public.attendance_events (shift_id, occurred_at);
create index attendance_events_by_org on public.attendance_events (organization_id, occurred_at desc);

create table public.break_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shift_id uuid not null references public.shifts (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_minutes integer,
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  constraint break_end_after_start check (ended_at is null or ended_at >= started_at),
  constraint break_duration_present check ((ended_at is null) = (duration_minutes is null))
);

-- At most one open break per shift, enforced by the database.
create unique index break_one_open_per_shift
  on public.break_records (shift_id)
  where ended_at is null;

create index break_by_shift on public.break_records (shift_id, started_at);

-- ---------------------------------------------------------------------------
-- Timesheets and auditable corrections
-- ---------------------------------------------------------------------------

create table public.timesheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  gross_minutes integer not null default 0 check (gross_minutes >= 0),
  unpaid_break_minutes integer not null default 0 check (unpaid_break_minutes >= 0),
  payable_minutes integer not null default 0 check (payable_minutes >= 0),
  status timesheet_status not null default 'draft',
  submitted_at timestamptz,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheets_period_order check (period_end >= period_start),
  constraint timesheets_unique_period unique (employee_membership_id, period_start, period_end)
);

create index timesheets_by_org_status on public.timesheets (organization_id, status, period_start desc);

create trigger timesheets_touch
  before update on public.timesheets
  for each row execute function public.touch_updated_at();

create table public.attendance_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  shift_id uuid not null references public.shifts (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  approved_by uuid references auth.users (id),
  previous_values jsonb not null,
  proposed_values jsonb not null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status adjustment_status not null default 'pending',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index adjustments_by_org_status on public.attendance_adjustments (organization_id, status, created_at desc);
create index adjustments_by_shift on public.attendance_adjustments (shift_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text,
  priority task_priority not null default 'medium',
  status task_status not null default 'todo',
  due_at timestamptz,
  created_by uuid not null references auth.users (id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_completed_consistent check ((status = 'completed') = (completed_at is not null))
);

create index tasks_by_org_status on public.tasks (organization_id, status, created_at desc);

create trigger tasks_touch
  before update on public.tasks
  for each row execute function public.touch_updated_at();

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  employee_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  constraint task_assignments_unique unique (task_id, employee_membership_id)
);

create index task_assignments_by_membership on public.task_assignments (employee_membership_id);

-- ---------------------------------------------------------------------------
-- Time off
-- ---------------------------------------------------------------------------

create table public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status time_off_status not null default 'pending',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  manager_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_off_date_order check (end_date >= start_date)
);

create index time_off_by_org_status on public.time_off_requests (organization_id, status, start_date desc);
create index time_off_by_membership on public.time_off_requests (employee_membership_id, start_date desc);

create trigger time_off_touch
  before update on public.time_off_requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Pay and payroll
-- ---------------------------------------------------------------------------

create table public.pay_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  hourly_rate numeric(12, 2) not null check (hourly_rate >= 0),
  currency_code char(3) not null,
  effective_from date not null,
  effective_until date,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint pay_rate_range_order check (effective_until is null or effective_until >= effective_from)
);

-- One rate may start on a given day per employee; history is preserved by
-- closing the previous row rather than updating it.
create unique index pay_rates_unique_start
  on public.pay_rates (employee_membership_id, effective_from);

create index pay_rates_by_membership on public.pay_rates (employee_membership_id, effective_from desc);

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status payroll_period_status not null default 'open',
  created_at timestamptz not null default now(),
  constraint payroll_period_order check (end_date >= start_date),
  constraint payroll_period_unique unique (organization_id, start_date, end_date)
);

create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  employee_membership_id uuid not null references public.organization_memberships (id) on delete cascade,
  payable_minutes integer not null default 0 check (payable_minutes >= 0),
  estimated_gross numeric(12, 2) not null default 0 check (estimated_gross >= 0),
  currency_code char(3) not null,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payroll_entry_unique unique (payroll_period_id, employee_membership_id)
);

-- ---------------------------------------------------------------------------
-- Notifications and audit
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_by_recipient
  on public.notifications (recipient_user_id, created_at desc);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel notification_channel not null default 'email',
  status delivery_status not null default 'pending',
  provider_message_id text,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  -- One delivery row per channel per notification keeps retries idempotent.
  constraint notification_delivery_unique unique (notification_id, channel)
);

create index notification_deliveries_pending
  on public.notification_deliveries (status, created_at)
  where status <> 'sent';

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_by_org on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------

-- Lets a retried clock-in/clock-out return the original result instead of
-- creating a second record when a flaky network makes a client resend.
create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null,
  key text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  constraint idempotency_unique unique (user_id, scope, key)
);

create index idempotency_created on public.idempotency_keys (created_at);
