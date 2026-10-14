/**
 * Estimated earnings.
 *
 * Money is handled as integer minor units (cents) throughout. No float ever
 * touches a monetary total: `0.1 + 0.2` problems are not acceptable in a
 * figure someone is shown next to the word "earnings".
 *
 * Scope, deliberately: hourly pay only. No overtime multipliers, no taxes, no
 * statutory deductions, no employer contributions. Every number this module
 * produces is an *estimate* and must be labelled as one in the UI.
 */

import type { LocalDate } from './time';

export interface PayRate {
	/** Minor units per hour, e.g. 25050 for 250.50 KES/hour. */
	hourlyRateCents: number;
	currencyCode: string;
	effectiveFrom: LocalDate;
	/** Inclusive; null means "still in force". */
	effectiveUntil: LocalDate | null;
}

export interface WorkedDay {
	date: LocalDate;
	payableMinutes: number;
}

export interface EarningsEstimate {
	currencyCode: string;
	payableMinutes: number;
	grossCents: number;
	/** Per-rate breakdown, so a mid-period rate change is explainable. */
	segments: Array<{
		hourlyRateCents: number;
		payableMinutes: number;
		grossCents: number;
	}>;
	/** Days that fell outside every known rate; excluded from the total. */
	unratedMinutes: number;
}

/** The rate in force on a given date, or null if none covers it. */
export function rateOn(rates: PayRate[], date: LocalDate): PayRate | null {
	for (const rate of rates) {
		const startsOk = rate.effectiveFrom <= date;
		const endsOk = rate.effectiveUntil === null || date <= rate.effectiveUntil;
		if (startsOk && endsOk) return rate;
	}
	return null;
}

/**
 * Converts minutes at an hourly rate into minor units.
 *
 * Multiplies before dividing so the division happens once, on an exact
 * integer product, and rounds half away from zero at the very end.
 */
export function minutesToCents(minutes: number, hourlyRateCents: number): number {
	const product = minutes * hourlyRateCents;
	return Math.round(product / 60);
}

/**
 * Estimated gross for a set of worked days, respecting rate effective dates.
 *
 * Minutes are bucketed per rate and converted once per bucket, so a rate
 * change mid-period cannot accumulate rounding drift.
 */
export function estimateEarnings(
	days: WorkedDay[],
	rates: PayRate[],
	fallbackCurrency: string
): EarningsEstimate {
	const buckets = new Map<number, number>();
	let unratedMinutes = 0;
	let currencyCode = fallbackCurrency;

	for (const day of days) {
		if (day.payableMinutes <= 0) continue;
		const rate = rateOn(rates, day.date);
		if (!rate) {
			unratedMinutes += day.payableMinutes;
			continue;
		}
		currencyCode = rate.currencyCode;
		buckets.set(rate.hourlyRateCents, (buckets.get(rate.hourlyRateCents) ?? 0) + day.payableMinutes);
	}

	const segments = [...buckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([hourlyRateCents, payableMinutes]) => ({
			hourlyRateCents,
			payableMinutes,
			grossCents: minutesToCents(payableMinutes, hourlyRateCents)
		}));

	return {
		currencyCode,
		payableMinutes: segments.reduce((t, s) => t + s.payableMinutes, 0),
		grossCents: segments.reduce((t, s) => t + s.grossCents, 0),
		segments,
		unratedMinutes
	};
}

/** Parses a user-entered amount such as "250.5" into minor units. */
export function parseAmountToCents(input: string): number | null {
	const trimmed = input.trim();
	if (!/^\d{1,9}([.,]\d{1,2})?$/.test(trimmed)) return null;
	const [whole, fraction = ''] = trimmed.replace(',', '.').split('.');
	return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** Renders minor units using the organization's currency. */
export function formatMoney(cents: number, currencyCode: string, locale = 'en'): string {
	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: currencyCode,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		}).format(cents / 100);
	} catch {
		// Unknown currency code: show the amount with the code appended.
		return `${(cents / 100).toFixed(2)} ${currencyCode}`;
	}
}

/** Hours, to two decimals, for display and CSV export. */
export function minutesToHours(minutes: number): number {
	return Math.round((minutes / 60) * 100) / 100;
}
