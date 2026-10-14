/**
 * Database types.
 *
 * Normally produced by `supabase gen types typescript`. Written by hand here
 * because this project is developed without a running Supabase instance; the
 * shapes mirror supabase/migrations exactly.
 *
 * To regenerate once a project is linked:
 *   npx supabase gen types typescript --linked > src/lib/types/database.ts
 */

export type MembershipRole = 'owner' | 'manager' | 'employee' | 'station';
export type MembershipStatus = 'pending' | 'active' | 'inactive' | 'rejected';
export type BreakMode = 'automatic' | 'manual' | 'none';
export type ShiftStatus = 'active' | 'completed' | 'flagged';
export type AttendanceEventType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
export type TimesheetStatus = 'draft' | 'pending' | 'approved' | 'rejected';
export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'cancelled';
export type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type PayrollPeriodStatus = 'open' | 'reviewed' | 'exported';
export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

interface Table<Row, Insert = Partial<Row>, Update = Partial<Row>> {
	Row: Row;
	Insert: Insert;
	Update: Update;
	Relationships: [];
}

export type Profile = {
	id: string;
	full_name: string;
	email: string;
	phone: string | null;
	avatar_url: string | null;
	created_at: string;
	updated_at: string;
}

export type Organization = {
	id: string;
	name: string;
	industry: string | null;
	country_code: string;
	timezone: string;
	currency_code: string;
	logo_url: string | null;
	week_starts_on: number;
	workweek_days: number[];
	join_token_hash: string | null;
	join_token_version: number;
	join_enabled: boolean;
	created_by: string;
	created_at: string;
	updated_at: string;
}

export type OrganizationMembership = {
	id: string;
	organization_id: string;
	user_id: string;
	role: MembershipRole;
	status: MembershipStatus;
	employee_code: string | null;
	job_title: string | null;
	department: string | null;
	start_date: string | null;
	joined_at: string;
	deactivated_at: string | null;
	created_at: string;
	updated_at: string;
}

export type OrganizationSettings = {
	organization_id: string;
	qr_clocking_enabled: boolean;
	direct_clocking_enabled: boolean;
	break_mode: BreakMode;
	automatic_break_minutes: number;
	automatic_break_threshold_minutes: number;
	minimum_shift_minutes: number | null;
	timesheet_approval_required: boolean;
	allow_manager_corrections: boolean;
	employee_earnings_visible: boolean;
	notify_managers_on_time_off: boolean;
	notify_employee_on_decision: boolean;
	updated_at: string;
}

export type ClockingStation = {
	id: string;
	organization_id: string;
	name: string;
	description: string | null;
	is_active: boolean;
	/** The device account that claimed this station, once set up. */
	membership_id: string | null;
	claimed_at: string | null;
	claim_token_hash: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
}

/** One clocking code per organization per local day, shared by all stations. */
export type OrganizationDailyToken = {
	id: string;
	organization_id: string;
	local_date: string;
	token_hash: string;
	expires_at: string;
	created_at: string;
}

export type Shift = {
	id: string;
	organization_id: string;
	employee_membership_id: string;
	station_id: string | null;
	started_at: string;
	ended_at: string | null;
	status: ShiftStatus;
	clock_in_method: string;
	clock_out_method: string | null;
	gross_minutes: number | null;
	unpaid_break_minutes: number | null;
	payable_minutes: number | null;
	break_policy_snapshot: Json | null;
	note: string | null;
	created_at: string;
	updated_at: string;
}

export type AttendanceEvent = {
	id: string;
	organization_id: string;
	shift_id: string;
	employee_membership_id: string;
	event_type: AttendanceEventType;
	occurred_at: string;
	station_id: string | null;
	method: string | null;
	recorded_by: string | null;
	created_at: string;
}

export type BreakRecord = {
	id: string;
	organization_id: string;
	shift_id: string;
	started_at: string;
	ended_at: string | null;
	duration_minutes: number | null;
	is_paid: boolean;
	created_at: string;
}

export type Timesheet = {
	id: string;
	organization_id: string;
	employee_membership_id: string;
	period_start: string;
	period_end: string;
	gross_minutes: number;
	unpaid_break_minutes: number;
	payable_minutes: number;
	status: TimesheetStatus;
	submitted_at: string | null;
	reviewed_by: string | null;
	reviewed_at: string | null;
	review_note: string | null;
	created_at: string;
	updated_at: string;
}

export type AttendanceAdjustment = {
	id: string;
	organization_id: string;
	shift_id: string;
	requested_by: string;
	approved_by: string | null;
	previous_values: Json;
	proposed_values: Json;
	reason: string;
	status: AdjustmentStatus;
	resolved_at: string | null;
	created_at: string;
}

export type Task = {
	id: string;
	organization_id: string;
	title: string;
	description: string | null;
	priority: TaskPriority;
	status: TaskStatus;
	due_at: string | null;
	created_by: string;
	completed_at: string | null;
	created_at: string;
	updated_at: string;
}

export type TaskAssignment = {
	id: string;
	organization_id: string;
	task_id: string;
	employee_membership_id: string;
	assigned_at: string;
}

export type TimeOffRequest = {
	id: string;
	organization_id: string;
	employee_membership_id: string;
	leave_type: string;
	start_date: string;
	end_date: string;
	reason: string | null;
	status: TimeOffStatus;
	reviewed_by: string | null;
	reviewed_at: string | null;
	manager_comment: string | null;
	created_at: string;
	updated_at: string;
}

export type PayRate = {
	id: string;
	organization_id: string;
	employee_membership_id: string;
	hourly_rate: string;
	currency_code: string;
	effective_from: string;
	effective_until: string | null;
	created_by: string | null;
	created_at: string;
}

export type PayrollPeriod = {
	id: string;
	organization_id: string;
	start_date: string;
	end_date: string;
	status: PayrollPeriodStatus;
	created_at: string;
}

export type PayrollEntry = {
	id: string;
	organization_id: string;
	payroll_period_id: string;
	employee_membership_id: string;
	payable_minutes: number;
	estimated_gross: string;
	currency_code: string;
	calculation_snapshot: Json;
	created_at: string;
}

export type Notification = {
	id: string;
	organization_id: string;
	recipient_user_id: string;
	type: string;
	title: string;
	body: string;
	link: string | null;
	read_at: string | null;
	created_at: string;
}

export type NotificationDelivery = {
	id: string;
	notification_id: string;
	channel: 'email';
	status: DeliveryStatus;
	provider_message_id: string | null;
	attempts: number;
	last_attempt_at: string | null;
	last_error: string | null;
	created_at: string;
}

/** An internal note a manager keeps about someone. Managers only. */
export type EmployeeNote = {
	id: string;
	organization_id: string;
	employee_membership_id: string;
	author_user_id: string | null;
	body: string;
	created_at: string;
	updated_at: string;
}

export type AuditLog = {
	id: string;
	organization_id: string;
	actor_user_id: string | null;
	action: string;
	entity_type: string;
	entity_id: string | null;
	metadata: Json;
	created_at: string;
}

/** Common shape every attendance RPC returns. */
export type RpcResult<T = Record<string, never>> =
	| ({ ok: true } & T)
	| { ok: false; code: string };

export type Database = {
	public: {
		Tables: {
			profiles: Table<Profile>;
			organizations: Table<Organization>;
			organization_memberships: Table<OrganizationMembership>;
			organization_settings: Table<OrganizationSettings>;
			clocking_stations: Table<ClockingStation>;
			organization_daily_tokens: Table<OrganizationDailyToken>;
			shifts: Table<Shift>;
			attendance_events: Table<AttendanceEvent>;
			break_records: Table<BreakRecord>;
			timesheets: Table<Timesheet>;
			attendance_adjustments: Table<AttendanceAdjustment>;
			tasks: Table<Task>;
			task_assignments: Table<TaskAssignment>;
			time_off_requests: Table<TimeOffRequest>;
			pay_rates: Table<PayRate>;
			payroll_periods: Table<PayrollPeriod>;
			payroll_entries: Table<PayrollEntry>;
			notifications: Table<Notification>;
			notification_deliveries: Table<NotificationDelivery>;
			employee_notes: Table<EmployeeNote>;
			audit_logs: Table<AuditLog>;
		};
		Views: { [_ in never]: never };
		Functions: {
			create_organization: {
				Args: {
					p_name: string;
					p_industry: string | null;
					p_country_code: string;
					p_timezone: string;
					p_currency_code: string;
					p_week_starts_on?: number;
					p_workweek_days?: number[];
				};
				Returns: Json;
			};
			request_to_join: {
				Args: { p_token_hash: string; p_full_name: string; p_phone?: string | null };
				Returns: Json;
			};
			claim_station: {
				Args: {
					p_token_hash: string;
					p_user_id: string;
					p_display_name: string;
					p_description?: string | null;
				};
				Returns: Json;
			};
			review_join_request: {
				Args: { p_membership: string; p_decision: 'accept' | 'reject'; p_role?: MembershipRole };
				Returns: Json;
			};
			clock_in_with_token: {
				Args: { p_token_hash: string; p_idempotency_key?: string | null };
				Returns: Json;
			};
			clock_out_with_token: {
				Args: { p_token_hash: string; p_idempotency_key?: string | null };
				Returns: Json;
			};
			clock_in_direct: {
				Args: { p_org: string; p_idempotency_key?: string | null };
				Returns: Json;
			};
			clock_out_direct: {
				Args: { p_org: string; p_idempotency_key?: string | null };
				Returns: Json;
			};
			start_break: { Args: { p_org: string }; Returns: Json };
			end_break: { Args: { p_org: string }; Returns: Json };
			manager_update_task: {
				Args: {
					p_task: string;
					p_title: string;
					p_description: string | null;
					p_priority: TaskPriority;
					p_due_at: string | null;
				};
				Returns: Json;
			};
			set_task_assignees: { Args: { p_task: string; p_memberships: string[] }; Returns: Json };
			submit_time_off_request: {
				Args: {
					p_org: string;
					p_leave_type: string;
					p_start: string;
					p_end: string;
					p_reason?: string | null;
				};
				Returns: Json;
			};
			review_time_off_request: {
				Args: { p_request: string; p_status: TimeOffStatus; p_comment?: string | null };
				Returns: Json;
			};
			set_member_role: { Args: { p_membership: string; p_role: MembershipRole }; Returns: Json };
			set_member_status: {
				Args: { p_membership: string; p_status: MembershipStatus };
				Returns: Json;
			};
			set_pay_rate: {
				Args: {
					p_membership: string;
					p_hourly_rate: number;
					p_effective_from: string;
					p_currency?: string | null;
				};
				Returns: Json;
			};
		};
		Enums: {
			membership_role: MembershipRole;
			membership_status: MembershipStatus;
			break_mode: BreakMode;
			shift_status: ShiftStatus;
			attendance_event_type: AttendanceEventType;
			timesheet_status: TimesheetStatus;
			adjustment_status: AdjustmentStatus;
			task_priority: TaskPriority;
			task_status: TaskStatus;
			time_off_status: TimeOffStatus;
			payroll_period_status: PayrollPeriodStatus;
			delivery_status: DeliveryStatus;
		};
		CompositeTypes: { [_ in never]: never };
	};
}
