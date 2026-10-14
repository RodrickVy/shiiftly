import { describe, expect, it } from 'vitest';
import {
	addDays,
	endOfLocalDay,
	inclusiveDayCount,
	isValidTimeZone,
	localDateInTimeZone,
	startOfLocalDay,
	timeZoneOffsetMs,
	weekRange,
	zonedWallTimeToUtc
} from '../../src/lib/domain/time';

describe('localDateInTimeZone', () => {
	it('resolves the local day for a zone ahead of UTC', () => {
		// 22:30 UTC is already the next day in Nairobi (UTC+3).
		const instant = new Date('2026-03-14T22:30:00Z');
		expect(localDateInTimeZone(instant, 'Africa/Nairobi')).toBe('2026-03-15');
		expect(localDateInTimeZone(instant, 'UTC')).toBe('2026-03-14');
	});

	it('resolves the local day for a zone behind UTC', () => {
		// 02:00 UTC is still the previous day in New York.
		const instant = new Date('2026-03-15T02:00:00Z');
		expect(localDateInTimeZone(instant, 'America/New_York')).toBe('2026-03-14');
	});

	it('handles midnight exactly', () => {
		const instant = new Date('2026-06-01T21:00:00Z'); // 00:00 on 2026-06-02 in Nairobi
		expect(localDateInTimeZone(instant, 'Africa/Nairobi')).toBe('2026-06-02');
	});
});

describe('timeZoneOffsetMs', () => {
	it('reports a fixed offset zone', () => {
		expect(timeZoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'Africa/Nairobi')).toBe(3 * 3600_000);
		expect(timeZoneOffsetMs(new Date('2026-07-15T12:00:00Z'), 'Africa/Nairobi')).toBe(3 * 3600_000);
	});

	it('reports both sides of a daylight-saving transition', () => {
		// US DST began 2026-03-08.
		expect(timeZoneOffsetMs(new Date('2026-02-01T12:00:00Z'), 'America/New_York')).toBe(-5 * 3600_000);
		expect(timeZoneOffsetMs(new Date('2026-06-01T12:00:00Z'), 'America/New_York')).toBe(-4 * 3600_000);
	});
});

describe('zonedWallTimeToUtc', () => {
	it('round-trips a wall time through its instant', () => {
		const instant = zonedWallTimeToUtc('2026-05-20', '08:30:00', 'Africa/Nairobi');
		expect(instant.toISOString()).toBe('2026-05-20T05:30:00.000Z');
		expect(localDateInTimeZone(instant, 'Africa/Nairobi')).toBe('2026-05-20');
	});

	it('resolves a wall time on the day DST starts', () => {
		// 2026-03-08: clocks jump 02:00 -> 03:00 in New York.
		// 01:30 still exists, at UTC-5.
		expect(zonedWallTimeToUtc('2026-03-08', '01:30:00', 'America/New_York').toISOString()).toBe(
			'2026-03-08T06:30:00.000Z'
		);
		// 04:00 is after the jump, at UTC-4.
		expect(zonedWallTimeToUtc('2026-03-08', '04:00:00', 'America/New_York').toISOString()).toBe(
			'2026-03-08T08:00:00.000Z'
		);
	});

	it('resolves midnight on the day DST ends', () => {
		// 2026-11-01: clocks fall back in New York. Midnight is unambiguous.
		expect(zonedWallTimeToUtc('2026-11-01', '00:00:00', 'America/New_York').toISOString()).toBe(
			'2026-11-01T04:00:00.000Z'
		);
	});
});

describe('local day boundaries', () => {
	it('spans exactly 24 hours on an ordinary day', () => {
		const start = startOfLocalDay('2026-05-20', 'Africa/Nairobi');
		const end = endOfLocalDay('2026-05-20', 'Africa/Nairobi');
		expect(end.getTime() - start.getTime()).toBe(24 * 3600_000);
	});

	it('spans 23 hours on a spring-forward day', () => {
		const start = startOfLocalDay('2026-03-08', 'America/New_York');
		const end = endOfLocalDay('2026-03-08', 'America/New_York');
		expect(end.getTime() - start.getTime()).toBe(23 * 3600_000);
	});

	it('spans 25 hours on a fall-back day', () => {
		const start = startOfLocalDay('2026-11-01', 'America/New_York');
		const end = endOfLocalDay('2026-11-01', 'America/New_York');
		expect(end.getTime() - start.getTime()).toBe(25 * 3600_000);
	});

	it("a day's end is the next day's start", () => {
		expect(endOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe(
			startOfLocalDay('2026-03-09', 'America/New_York').toISOString()
		);
	});

	/**
	 * This is the property the daily QR token depends on: an instant one
	 * millisecond before local midnight is still "today", and one millisecond
	 * after is not.
	 */
	it('classifies instants either side of local midnight correctly', () => {
		const tz = 'Africa/Nairobi';
		const end = endOfLocalDay('2026-05-20', tz);
		expect(localDateInTimeZone(new Date(end.getTime() - 1), tz)).toBe('2026-05-20');
		expect(localDateInTimeZone(end, tz)).toBe('2026-05-21');
	});
});

describe('date helpers', () => {
	it('adds and subtracts days across month and year ends', () => {
		expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});

	it('handles a leap year', () => {
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
	});

	it('counts days inclusively', () => {
		expect(inclusiveDayCount('2026-05-01', '2026-05-01')).toBe(1);
		expect(inclusiveDayCount('2026-05-01', '2026-05-07')).toBe(7);
	});

	it('computes a week range for a Monday-start organization', () => {
		// 2026-05-20 is a Wednesday.
		expect(weekRange('2026-05-20', 1)).toEqual({ start: '2026-05-18', end: '2026-05-24' });
	});

	it('computes a week range for a Sunday-start organization', () => {
		expect(weekRange('2026-05-20', 0)).toEqual({ start: '2026-05-17', end: '2026-05-23' });
	});
});

describe('timezone validation', () => {
	it('accepts real zones and rejects invented ones', () => {
		expect(isValidTimeZone('Africa/Lagos')).toBe(true);
		expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
		expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
		expect(isValidTimeZone('')).toBe(false);
	});
});
