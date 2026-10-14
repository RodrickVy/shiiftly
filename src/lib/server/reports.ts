/**
 * Shared report queries.
 *
 * These live in $lib/server rather than in a `+page.server.ts` because
 * SvelteKit only permits its own named exports from route modules, and both
 * the page and its CSV endpoint need to produce exactly the same figures.
 * Deriving the export from a second query would let the file disagree with
 * the screen it came from.
 */
import { estimateEarnings, type PayRate, type WorkedDay } from '$lib/domain/earnings';
import { endOfLocalDay, localDateInTimeZone, startOfLocalDay } from '$lib/domain/time';
import type { PayRate as PayRateRow, Shift, Timesheet } from '$lib/types/database';

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
		.select('*, organization_memberships(id, profiles(full_name)), clocking_stations(name)')
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
		clocking_stations: { name: string } | null;
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
		stationName: s.clocking_stations?.name ?? null,
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

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export interface PayrollRow {
	membershipId: string;
	name: string;
	payableMinutes: number;
	unratedMinutes: number;
	grossCents: number;
	currencyCode: string;
	hasRate: boolean;
	approved: boolean;
}

export async function buildPayroll(
	locals: App.Locals,
	params: { from: string; to: string; approvedOnly: boolean }
): Promise<{ rows: PayrollRow[]; currency: string }> {
	const org = locals.org!;
	const tz = org.organization.timezone;

	const { data: shiftRows } = await locals.supabase
		.from('shifts')
		.select(
			'employee_membership_id, started_at, payable_minutes, organization_memberships(profiles(full_name))'
		)
		.eq('organization_id', org.organization.id)
		.eq('status', 'completed')
		.gte('started_at', startOfLocalDay(params.from, tz).toISOString())
		.lt('started_at', endOfLocalDay(params.to, tz).toISOString());

	const { data: rateRows } = await locals.supabase
		.from('pay_rates')
		.select('*')
		.eq('organization_id', org.organization.id);

	const { data: sheetRows } = await locals.supabase
		.from('timesheets')
		.select('employee_membership_id, status, period_start, period_end')
		.eq('organization_id', org.organization.id)
		.lte('period_start', params.to)
		.gte('period_end', params.from);

	const approvedMemberships = new Set(
		((sheetRows ?? []) as Pick<Timesheet, 'employee_membership_id' | 'status'>[])
			.filter((s) => s.status === 'approved')
			.map((s) => s.employee_membership_id)
	);

	const ratesByMembership = new Map<string, PayRate[]>();
	for (const row of (rateRows ?? []) as PayRateRow[]) {
		const list = ratesByMembership.get(row.employee_membership_id) ?? [];
		list.push({
			// NUMERIC arrives as a string; convert to exact minor units.
			hourlyRateCents: Math.round(Number(row.hourly_rate) * 100),
			currencyCode: row.currency_code,
			effectiveFrom: row.effective_from,
			effectiveUntil: row.effective_until
		});
		ratesByMembership.set(row.employee_membership_id, list);
	}

	type ShiftRow = Pick<Shift, 'employee_membership_id' | 'started_at' | 'payable_minutes'> & {
		organization_memberships: { profiles: { full_name: string } | null } | null;
	};

	// Group by employee and organization-local day, so a mid-period rate
	// change applies to exactly the days it should.
	const daysByMembership = new Map<string, Map<string, number>>();
	const names = new Map<string, string>();

	for (const shift of (shiftRows ?? []) as unknown as ShiftRow[]) {
		const key = shift.employee_membership_id;
		names.set(key, shift.organization_memberships?.profiles?.full_name ?? 'Unnamed');
		const day = localDateInTimeZone(new Date(shift.started_at), tz);
		const byDay = daysByMembership.get(key) ?? new Map<string, number>();
		byDay.set(day, (byDay.get(day) ?? 0) + (shift.payable_minutes ?? 0));
		daysByMembership.set(key, byDay);
	}

	const rows: PayrollRow[] = [];

	for (const [membershipId, byDay] of daysByMembership) {
		const approved = approvedMemberships.has(membershipId);
		if (params.approvedOnly && !approved) continue;

		const days: WorkedDay[] = [...byDay.entries()].map(([date, payableMinutes]) => ({
			date,
			payableMinutes
		}));
		const rates = ratesByMembership.get(membershipId) ?? [];
		const estimate = estimateEarnings(days, rates, org.organization.currency_code);

		rows.push({
			membershipId,
			name: names.get(membershipId) ?? 'Unnamed',
			payableMinutes: estimate.payableMinutes + estimate.unratedMinutes,
			unratedMinutes: estimate.unratedMinutes,
			grossCents: estimate.grossCents,
			currencyCode: estimate.currencyCode,
			hasRate: rates.length > 0,
			approved
		});
	}

	rows.sort((a, b) => a.name.localeCompare(b.name));
	return { rows, currency: org.organization.currency_code };
}
