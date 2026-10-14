import { describe, expect, it } from 'vitest';
import {
	estimateEarnings,
	formatMoney,
	minutesToCents,
	minutesToHours,
	parseAmountToCents,
	rateOn,
	type PayRate
} from '../../src/lib/domain/earnings';

const rates: PayRate[] = [
	{
		hourlyRateCents: 20_000, // 200.00
		currencyCode: 'KES',
		effectiveFrom: '2026-01-01',
		effectiveUntil: '2026-05-31'
	},
	{
		hourlyRateCents: 25_000, // 250.00
		currencyCode: 'KES',
		effectiveFrom: '2026-06-01',
		effectiveUntil: null
	}
];

describe('rateOn', () => {
	it('selects the rate in force on a date', () => {
		expect(rateOn(rates, '2026-03-15')?.hourlyRateCents).toBe(20_000);
		expect(rateOn(rates, '2026-06-01')?.hourlyRateCents).toBe(25_000);
		expect(rateOn(rates, '2026-12-31')?.hourlyRateCents).toBe(25_000);
	});

	it('respects inclusive boundaries', () => {
		expect(rateOn(rates, '2026-05-31')?.hourlyRateCents).toBe(20_000);
	});

	it('returns null before any rate exists', () => {
		expect(rateOn(rates, '2025-12-31')).toBeNull();
	});
});

describe('minutesToCents', () => {
	it('converts whole hours exactly', () => {
		expect(minutesToCents(60, 25_000)).toBe(25_000);
		expect(minutesToCents(480, 25_000)).toBe(200_000);
	});

	it('converts part hours without float drift', () => {
		expect(minutesToCents(30, 25_000)).toBe(12_500);
		expect(minutesToCents(90, 25_000)).toBe(37_500);
		// 7h30m at 200.00/h = 1500.00
		expect(minutesToCents(450, 20_000)).toBe(150_000);
	});

	it('rounds a non-terminating result to the nearest cent', () => {
		// 1 minute at 100.00/hour is 1.6666.. -> 167 cents
		expect(minutesToCents(1, 10_000)).toBe(167);
	});

	it('does not accumulate float error over many conversions', () => {
		// 0.1 + 0.2 style drift would show here if floats were used.
		let total = 0;
		for (let i = 0; i < 1000; i++) total += minutesToCents(7, 1033);
		expect(total).toBe(1000 * Math.round((7 * 1033) / 60));
		expect(Number.isInteger(total)).toBe(true);
	});
});

describe('estimateEarnings', () => {
	it('totals a period at a single rate', () => {
		const result = estimateEarnings(
			[
				{ date: '2026-03-02', payableMinutes: 480 },
				{ date: '2026-03-03', payableMinutes: 450 }
			],
			rates,
			'KES'
		);

		expect(result.payableMinutes).toBe(930);
		// 930 minutes at 200.00/h = 3100.00
		expect(result.grossCents).toBe(310_000);
		expect(result.currencyCode).toBe('KES');
		expect(result.segments).toHaveLength(1);
	});

	/** The case the specification calls out: a rate change mid-period. */
	it('applies each rate to the days it actually covers', () => {
		const result = estimateEarnings(
			[
				{ date: '2026-05-30', payableMinutes: 480 }, // at 200.00
				{ date: '2026-05-31', payableMinutes: 480 }, // at 200.00
				{ date: '2026-06-01', payableMinutes: 480 }, // at 250.00
				{ date: '2026-06-02', payableMinutes: 480 } // at 250.00
			],
			rates,
			'KES'
		);

		expect(result.payableMinutes).toBe(1920);
		// (16h * 200) + (16h * 250) = 3200 + 4000 = 7200.00
		expect(result.grossCents).toBe(720_000);
		expect(result.segments).toEqual([
			{ hourlyRateCents: 20_000, payableMinutes: 960, grossCents: 320_000 },
			{ hourlyRateCents: 25_000, payableMinutes: 960, grossCents: 400_000 }
		]);
	});

	it('sets aside days no rate covers rather than guessing', () => {
		const result = estimateEarnings(
			[
				{ date: '2025-12-30', payableMinutes: 300 }, // before any rate
				{ date: '2026-03-02', payableMinutes: 480 }
			],
			rates,
			'KES'
		);

		expect(result.unratedMinutes).toBe(300);
		expect(result.payableMinutes).toBe(480);
		expect(result.grossCents).toBe(160_000);
	});

	it('returns a zero estimate when there is nothing to pay', () => {
		const result = estimateEarnings([], rates, 'KES');
		expect(result).toMatchObject({ grossCents: 0, payableMinutes: 0, unratedMinutes: 0 });
		expect(result.currencyCode).toBe('KES');
	});

	it('ignores days with no payable time', () => {
		const result = estimateEarnings([{ date: '2026-03-02', payableMinutes: 0 }], rates, 'KES');
		expect(result.grossCents).toBe(0);
	});
});

describe('parseAmountToCents', () => {
	it('parses plain and decimal amounts', () => {
		expect(parseAmountToCents('250')).toBe(25_000);
		expect(parseAmountToCents('250.50')).toBe(25_050);
		expect(parseAmountToCents('250.5')).toBe(25_050);
		expect(parseAmountToCents('0.05')).toBe(5);
		expect(parseAmountToCents(' 12.34 ')).toBe(1234);
	});

	it('accepts a comma decimal separator', () => {
		expect(parseAmountToCents('250,50')).toBe(25_050);
	});

	it('rejects malformed input rather than coercing it', () => {
		expect(parseAmountToCents('')).toBeNull();
		expect(parseAmountToCents('abc')).toBeNull();
		expect(parseAmountToCents('-5')).toBeNull();
		expect(parseAmountToCents('1.234')).toBeNull();
		expect(parseAmountToCents('1e3')).toBeNull();
	});
});

describe('formatting', () => {
	it('formats money with two decimals', () => {
		expect(formatMoney(310_000, 'KES')).toMatch(/3,100\.00/);
		expect(formatMoney(0, 'USD')).toMatch(/0\.00/);
	});

	it('falls back gracefully for an unknown currency code', () => {
		expect(formatMoney(12_345, 'XYZ')).toContain('123.45');
	});

	it('converts minutes to display hours', () => {
		expect(minutesToHours(450)).toBe(7.5);
		expect(minutesToHours(100)).toBe(1.67);
	});
});
