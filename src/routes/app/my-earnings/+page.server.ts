import { error, redirect } from '@sveltejs/kit';
import { estimateEarnings, type PayRate, type WorkedDay } from '$lib/domain/earnings';
import {
	addDays,
	endOfLocalDay,
	localDateInTimeZone,
	startOfLocalDay,
	todayInTimeZone
} from '$lib/domain/time';
import type { PageServerLoad } from './$types';
import type { PayRate as PayRateRow, Shift } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');

	if (!org.settings.employee_earnings_visible && !org.isManager) {
		throw error(403, 'Your organization does not show earnings estimates to employees.');
	}

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);
	const from = url.searchParams.get('from') ?? addDays(today, -29);
	const to = url.searchParams.get('to') ?? today;

	const { data: shiftRows } = await locals.supabase
		.from('shifts')
		.select('id, started_at, ended_at, payable_minutes, status')
		.eq('employee_membership_id', org.membership.id)
		.eq('status', 'completed')
		.gte('started_at', startOfLocalDay(from, tz).toISOString())
		.lt('started_at', endOfLocalDay(to, tz).toISOString())
		.order('started_at', { ascending: false });

	const shifts = (shiftRows ?? []) as Pick<
		Shift,
		'id' | 'started_at' | 'ended_at' | 'payable_minutes' | 'status'
	>[];

	// An employee may read their own rate history and no one else's.
	const { data: rateRows } = await locals.supabase
		.from('pay_rates')
		.select('*')
		.eq('employee_membership_id', org.membership.id)
		.order('effective_from', { ascending: true });

	const rates: PayRate[] = ((rateRows ?? []) as PayRateRow[]).map((r) => ({
		// NUMERIC arrives as a string; parse to exact minor units.
		hourlyRateCents: Math.round(Number(r.hourly_rate) * 100),
		currencyCode: r.currency_code,
		effectiveFrom: r.effective_from,
		effectiveUntil: r.effective_until
	}));

	// A shift belongs to the local day it started on.
	const byDay = new Map<string, number>();
	for (const shift of shifts) {
		const day = localDateInTimeZone(new Date(shift.started_at), tz);
		byDay.set(day, (byDay.get(day) ?? 0) + (shift.payable_minutes ?? 0));
	}

	const days: WorkedDay[] = [...byDay.entries()].map(([date, payableMinutes]) => ({
		date,
		payableMinutes
	}));

	const estimate = estimateEarnings(days, rates, org.organization.currency_code);

	return {
		from,
		to,
		estimate,
		currentRate: rates.find((r) => r.effectiveUntil === null) ?? null,
		rateHistory: rates,
		hasRate: rates.length > 0,
		shifts: shifts.map((s) => ({
			id: s.id,
			startedAt: s.started_at,
			endedAt: s.ended_at,
			payableMinutes: s.payable_minutes ?? 0
		}))
	};
};
