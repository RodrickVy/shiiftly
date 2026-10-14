/**
 * Read-side helpers for attendance.
 *
 * Writes go through the SQL functions (clock_in_with_token and friends), which
 * own the transaction and the server clock. This module only reads, and
 * returns plain serialisable shapes for the pages to render.
 */
import type { Db } from './supabase';
import type { AttendanceState, BreakInterval, BreakPolicy } from '$lib/domain/attendance';
import type { BreakRecord, OrganizationSettings, Shift } from '$lib/types/database';

export interface ActiveShiftView {
	id: string;
	startedAt: string;
	stationName: string | null;
	breaks: Array<{ id: string; startedAt: string; endedAt: string | null; isPaid: boolean }>;
	onBreakSince: string | null;
}

export function breakPolicyFrom(settings: OrganizationSettings): BreakPolicy {
	return {
		mode: settings.break_mode,
		automaticBreakMinutes: settings.automatic_break_minutes,
		automaticBreakThresholdMinutes: settings.automatic_break_threshold_minutes
	};
}

export function toIntervals(
	breaks: Array<{ startedAt: string; endedAt: string | null; isPaid: boolean }>
): BreakInterval[] {
	return breaks.map((b) => ({
		startedAt: new Date(b.startedAt),
		endedAt: b.endedAt ? new Date(b.endedAt) : null,
		isPaid: b.isPaid
	}));
}

/** The employee's currently open shift, with its breaks, or null. */
export async function getActiveShift(
	supabase: Db,
	membershipId: string
): Promise<ActiveShiftView | null> {
	const { data, error } = await supabase
		.from('shifts')
		.select('id, started_at, station_id, clocking_stations(name)')
		.eq('employee_membership_id', membershipId)
		.eq('status', 'active')
		.maybeSingle();

	if (error || !data) return null;

	const { data: breaks } = await supabase
		.from('break_records')
		.select('id, started_at, ended_at, is_paid')
		.eq('shift_id', data.id)
		.order('started_at', { ascending: true });

	const rows = (breaks ?? []) as Pick<
		BreakRecord,
		'id' | 'started_at' | 'ended_at' | 'is_paid'
	>[];

	const station = data.clocking_stations as unknown as { name: string } | null;

	return {
		id: data.id,
		startedAt: data.started_at,
		stationName: station?.name ?? null,
		breaks: rows.map((b) => ({
			id: b.id,
			startedAt: b.started_at,
			endedAt: b.ended_at,
			isPaid: b.is_paid
		})),
		onBreakSince: rows.find((b) => b.ended_at === null)?.started_at ?? null
	};
}

export function attendanceStateFor(
	shift: ActiveShiftView | null,
	completedToday: boolean
): AttendanceState {
	if (!shift) return completedToday ? 'shift_completed' : 'not_clocked_in';
	return shift.onBreakSince ? 'on_break' : 'working';
}

/** Shifts that started within an organization-local day window. */
export async function getShiftsBetween(
	supabase: Db,
	opts: {
		organizationId?: string;
		membershipId?: string;
		fromIso: string;
		toIso: string;
	}
): Promise<Shift[]> {
	let query = supabase
		.from('shifts')
		.select('*')
		.gte('started_at', opts.fromIso)
		.lt('started_at', opts.toIso)
		.order('started_at', { ascending: false });

	if (opts.organizationId) query = query.eq('organization_id', opts.organizationId);
	if (opts.membershipId) query = query.eq('employee_membership_id', opts.membershipId);

	const { data, error } = await query;
	if (error || !data) return [];
	return data as Shift[];
}

/**
 * Whether the employee already completed a shift during the current local
 * day, which distinguishes "not clocked in yet" from "done for today".
 */
export async function hasCompletedShiftToday(
	supabase: Db,
	membershipId: string,
	dayStartIso: string,
	dayEndIso: string
): Promise<boolean> {
	const { count } = await supabase
		.from('shifts')
		.select('id', { count: 'exact', head: true })
		.eq('employee_membership_id', membershipId)
		.eq('status', 'completed')
		.gte('started_at', dayStartIso)
		.lt('started_at', dayEndIso);

	return (count ?? 0) > 0;
}

/** Maps an RPC failure code to something a person can act on. */
export function clockErrorMessage(code: string): string {
	switch (code) {
		case 'already_clocked_in':
			return 'You are already clocked in. Clock out to end your shift.';
		case 'no_active_shift':
			return 'You are not clocked in, so there is nothing to clock out of.';
		case 'break_in_progress':
			return 'End your break before clocking out.';
		case 'break_already_active':
			return 'You are already on a break.';
		case 'no_active_break':
			return 'You are not on a break.';
		case 'manual_breaks_disabled':
			return 'Your organization does not use manual breaks.';
		case 'invalid_or_expired_token':
			return 'That code is not valid today. Ask your manager to show the current one.';
		case 'qr_clocking_disabled':
			return 'QR clocking is switched off for your organization.';
		case 'direct_clocking_disabled':
			return 'Clocking in from the app is switched off. Scan the station code instead.';
		case 'not_a_member':
			return 'You are not an active member of that organization.';
		case 'not_authenticated':
			return 'Your session has expired. Sign in and try again.';
		default:
			return 'That did not work. Please try again.';
	}
}
