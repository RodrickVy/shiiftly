import { redirect } from '@sveltejs/kit';
import { addDays, endOfLocalDay, startOfLocalDay, todayInTimeZone, weekRange } from '$lib/domain/time';
import type { PageServerLoad } from './$types';
import type { Shift, Timesheet } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);

	// Default to the last 30 days, overridable by query parameters.
	const from = url.searchParams.get('from') ?? addDays(today, -29);
	const to = url.searchParams.get('to') ?? today;

	const { data: shiftRows } = await locals.supabase
		.from('shifts')
		.select('*')
		.eq('employee_membership_id', org.membership.id)
		.gte('started_at', startOfLocalDay(from, tz).toISOString())
		.lt('started_at', endOfLocalDay(to, tz).toISOString())
		.order('started_at', { ascending: false });

	const shifts = (shiftRows ?? []) as Shift[];

	const { data: timesheetRows } = await locals.supabase
		.from('timesheets')
		.select('*')
		.eq('employee_membership_id', org.membership.id)
		.gte('period_end', from)
		.lte('period_start', to)
		.order('period_start', { ascending: false });

	const completed = shifts.filter((s) => s.status === 'completed');

	return {
		from,
		to,
		thisWeek: weekRange(today, org.organization.week_starts_on),
		shifts: shifts.map((s) => ({
			id: s.id,
			startedAt: s.started_at,
			endedAt: s.ended_at,
			status: s.status,
			grossMinutes: s.gross_minutes,
			unpaidBreakMinutes: s.unpaid_break_minutes,
			payableMinutes: s.payable_minutes,
			clockInMethod: s.clock_in_method
		})),
		totals: {
			shifts: completed.length,
			grossMinutes: completed.reduce((t, s) => t + (s.gross_minutes ?? 0), 0),
			breakMinutes: completed.reduce((t, s) => t + (s.unpaid_break_minutes ?? 0), 0),
			payableMinutes: completed.reduce((t, s) => t + (s.payable_minutes ?? 0), 0),
			incomplete: shifts.filter((s) => s.status === 'flagged' || (s.status !== 'active' && !s.ended_at)).length
		},
		timesheets: (timesheetRows ?? []) as Timesheet[]
	};
};
