import { describe, expect, it } from 'vitest';
import {
	availableAction,
	elapsedWorkingMinutes,
	formatDuration,
	formatTimer,
	grossMinutes,
	payableMinutes,
	unpaidBreakMinutes,
	type BreakPolicy
} from '../../src/lib/domain/attendance';

const at = (iso: string) => new Date(iso);

const noBreaks: BreakPolicy = {
	mode: 'none',
	automaticBreakMinutes: 0,
	automaticBreakThresholdMinutes: 0
};
const automatic: BreakPolicy = {
	mode: 'automatic',
	automaticBreakMinutes: 30,
	automaticBreakThresholdMinutes: 360
};
const manual: BreakPolicy = {
	mode: 'manual',
	automaticBreakMinutes: 0,
	automaticBreakThresholdMinutes: 0
};

describe('grossMinutes', () => {
	it('truncates partial minutes', () => {
		expect(grossMinutes(at('2026-05-20T08:00:00Z'), at('2026-05-20T08:59:59Z'))).toBe(59);
		expect(grossMinutes(at('2026-05-20T08:00:00Z'), at('2026-05-20T09:00:00Z'))).toBe(60);
	});

	it('returns zero rather than a negative for an inverted range', () => {
		expect(grossMinutes(at('2026-05-20T09:00:00Z'), at('2026-05-20T08:00:00Z'))).toBe(0);
	});

	it('spans midnight for an overnight shift', () => {
		// 22:00 to 06:00 the next morning.
		expect(grossMinutes(at('2026-05-20T22:00:00Z'), at('2026-05-21T06:00:00Z'))).toBe(480);
	});

	it('is unaffected by a daylight-saving change, because instants are absolute', () => {
		// A night shift across the US spring-forward: the wall clock skips an
		// hour, but only 7 real hours elapse.
		const start = at('2026-03-08T04:00:00Z'); // 23:00 local, 2026-03-07
		const end = at('2026-03-08T11:00:00Z'); // 07:00 local, after the jump
		expect(grossMinutes(start, end)).toBe(420);
	});
});

describe('automatic break deduction', () => {
	it('applies the deduction at and above the threshold', () => {
		expect(unpaidBreakMinutes(automatic, 360)).toBe(30);
		expect(unpaidBreakMinutes(automatic, 480)).toBe(30);
	});

	it('applies nothing below the threshold', () => {
		expect(unpaidBreakMinutes(automatic, 359)).toBe(0);
		expect(unpaidBreakMinutes(automatic, 0)).toBe(0);
	});

	it('produces the worked example from the specification', () => {
		// 8 hour shift, 30 minute automatic unpaid break -> 7h30m payable.
		const r = payableMinutes(automatic, at('2026-05-20T08:00:00Z'), at('2026-05-20T16:00:00Z'));
		expect(r).toEqual({ gross: 480, unpaidBreak: 30, payable: 450 });
		expect(formatDuration(r.payable)).toBe('7h 30m');
	});

	it('never drives payable time below zero', () => {
		const aggressive: BreakPolicy = {
			mode: 'automatic',
			automaticBreakMinutes: 120,
			automaticBreakThresholdMinutes: 1
		};
		const r = payableMinutes(aggressive, at('2026-05-20T08:00:00Z'), at('2026-05-20T08:30:00Z'));
		expect(r.payable).toBe(0);
	});
});

describe('manual break deduction', () => {
	it('sums completed unpaid breaks', () => {
		const breaks = [
			{ startedAt: at('2026-05-20T10:00:00Z'), endedAt: at('2026-05-20T10:15:00Z'), isPaid: false },
			{ startedAt: at('2026-05-20T13:00:00Z'), endedAt: at('2026-05-20T13:30:00Z'), isPaid: false }
		];
		expect(unpaidBreakMinutes(manual, 480, breaks)).toBe(45);
	});

	it('ignores paid breaks', () => {
		const breaks = [
			{ startedAt: at('2026-05-20T10:00:00Z'), endedAt: at('2026-05-20T10:15:00Z'), isPaid: true },
			{ startedAt: at('2026-05-20T13:00:00Z'), endedAt: at('2026-05-20T13:30:00Z'), isPaid: false }
		];
		expect(unpaidBreakMinutes(manual, 480, breaks)).toBe(30);
	});

	it('ignores a break that has not ended yet', () => {
		const breaks = [
			{ startedAt: at('2026-05-20T10:00:00Z'), endedAt: null, isPaid: false }
		];
		expect(unpaidBreakMinutes(manual, 480, breaks)).toBe(0);
	});

	it('subtracts recorded break time from the shift', () => {
		const breaks = [
			{ startedAt: at('2026-05-20T12:00:00Z'), endedAt: at('2026-05-20T12:20:00Z'), isPaid: false }
		];
		const r = payableMinutes(manual, at('2026-05-20T08:00:00Z'), at('2026-05-20T13:00:00Z'), breaks);
		expect(r).toEqual({ gross: 300, unpaidBreak: 20, payable: 280 });
	});

	it('does not apply an automatic deduction when the mode is manual', () => {
		const r = payableMinutes(manual, at('2026-05-20T08:00:00Z'), at('2026-05-20T16:00:00Z'), []);
		expect(r.payable).toBe(480);
	});
});

describe('no-break mode', () => {
	it('pays the full gross duration', () => {
		const r = payableMinutes(noBreaks, at('2026-05-20T08:00:00Z'), at('2026-05-20T16:00:00Z'));
		expect(r).toEqual({ gross: 480, unpaidBreak: 0, payable: 480 });
	});
});

describe('live timer', () => {
	it('excludes an in-progress break from working time', () => {
		const breaks = [{ startedAt: at('2026-05-20T10:00:00Z'), endedAt: null, isPaid: false }];
		const worked = elapsedWorkingMinutes(
			at('2026-05-20T08:00:00Z'),
			at('2026-05-20T10:30:00Z'),
			breaks
		);
		// 2h30m elapsed, 30m of it on break.
		expect(worked).toBe(120);
	});

	it('excludes completed breaks', () => {
		const breaks = [
			{ startedAt: at('2026-05-20T10:00:00Z'), endedAt: at('2026-05-20T10:15:00Z'), isPaid: false }
		];
		expect(
			elapsedWorkingMinutes(at('2026-05-20T08:00:00Z'), at('2026-05-20T11:00:00Z'), breaks)
		).toBe(165);
	});
});

describe('available action', () => {
	it('offers the action that matches the current state', () => {
		expect(availableAction('not_clocked_in')).toBe('clock_in');
		expect(availableAction('shift_completed')).toBe('clock_in');
		expect(availableAction('working')).toBe('clock_out');
		// On a break the employee must end it first.
		expect(availableAction('on_break')).toBeNull();
	});
});

describe('formatting', () => {
	it('formats durations', () => {
		expect(formatDuration(0)).toBe('0m');
		expect(formatDuration(45)).toBe('45m');
		expect(formatDuration(60)).toBe('1h');
		expect(formatDuration(450)).toBe('7h 30m');
		expect(formatDuration(-5)).toBe('0m');
	});

	it('formats a running timer', () => {
		expect(formatTimer(0)).toBe('0:00:00');
		expect(formatTimer(59)).toBe('0:00:59');
		expect(formatTimer(3661)).toBe('1:01:01');
		expect(formatTimer(36_000)).toBe('10:00:00');
	});
});
