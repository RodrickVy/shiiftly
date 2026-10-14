/**
 * Shared report queries.
 *
 * These live in $lib/server rather than in a `+page.server.ts` because
 * SvelteKit only permits its own named exports from route modules, and both
 * the page and its CSV endpoint need to produce exactly the same figures.
 * Deriving the export from a second query would let the file disagree with
 * the screen it came from.
 */
import { endOfLocalDay, startOfLocalDay } from '$lib/domain/time';
import type { Shift } from '$lib/types/database';

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export interface AttendanceRow {
	id: string;
	membershipId: string;
	name: string;
	startedAt: string;
	endedAt: string | null;
	status: string;
	grossMinutes: number | null;
	unpaidBreakMinutes: number | null;
	payableMinutes: number | null;
	clockInMethod: string;
	clockOutMethod: string | null;
	stationName: string | null;
	incomplete: boolean;
}

export interface AttendanceQuery {
	from: string;
	to: string;
	employee: string;
	status: string;
}

export async function loadAttendance(
	locals: App.Locals,
	params: AttendanceQuery
): Promise<{ rows: AttendanceRow[]; tz: string }> {
	const org = locals.org!;
	const tz = org.organization.timezone;

	let query = locals.supabase
		.from('shifts')
		.select('*, organization_memberships(id, profiles(full_name))')
		.eq('organization_id', org.organization.id)
		.gte('started_at', startOfLocalDay(params.from, tz).toISOString())
		.lt('started_at', endOfLocalDay(params.to, tz).toISOString())
		.order('started_at', { ascending: false });

	if (params.employee !== 'all') {
		query = query.eq('employee_membership_id', params.employee);
	}

	const { data } = await query;

	type Row = Shift & {
		organization_memberships: { id: string; profiles: { full_name: string } | null } | null;
	};

	const rows = ((data ?? []) as unknown as Row[]).map<AttendanceRow>((s) => ({
		id: s.id,
		membershipId: s.employee_membership_id,
		name: s.organization_memberships?.profiles?.full_name ?? 'Unnamed',
		startedAt: s.started_at,
		endedAt: s.ended_at,
		status: s.status,
		grossMinutes: s.gross_minutes,
		unpaidBreakMinutes: s.unpaid_break_minutes,
		payableMinutes: s.payable_minutes,
		clockInMethod: s.clock_in_method,
		clockOutMethod: s.clock_out_method,
		stationName: null,
		// Neither open nor properly closed: a human needs to decide.
		incomplete: s.status === 'flagged' || (s.status !== 'active' && s.ended_at === null)
	}));

	const filtered =
		params.status === 'all'
			? rows
			: params.status === 'incomplete'
				? rows.filter((r) => r.incomplete)
				: rows.filter((r) => r.status === params.status);

	return { rows: filtered, tz };
}
