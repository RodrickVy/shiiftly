/**
 * Shift duration and break deduction.
 *
 * These functions mirror the arithmetic in `_close_shift` (migration 0003)
 * exactly, including the use of floor() for minutes. The database remains the
 * authority -- it is what writes the stored figures -- but the UI needs to
 * show a live, matching preview of an in-progress shift, and payroll needs to
 * re-derive totals for a period. Any divergence between the two would show up
 * as a number that changes when an employee clocks out, so the rule is:
 * if you change one, change the other, and the tests in
 * tests/domain/attendance.test.ts compare them.
 */

export type BreakMode = 'automatic' | 'manual' | 'none';

export interface BreakPolicy {
	mode: BreakMode;
	/** Minutes deducted once the threshold is met, in automatic mode. */
	automaticBreakMinutes: number;
	/** Gross minutes a shift must reach before the deduction applies. */
	automaticBreakThresholdMinutes: number;
}

export interface BreakInterval {
	startedAt: Date;
	endedAt: Date | null;
	isPaid: boolean;
}

/** Whole minutes between two instants, truncated -- never negative. */
export function grossMinutes(startedAt: Date, endedAt: Date): number {
	const ms = endedAt.getTime() - startedAt.getTime();
	if (ms <= 0) return 0;
	return Math.floor(ms / 60_000);
}

/** Duration of a single completed break, truncated to whole minutes. */
export function breakMinutes(interval: BreakInterval): number {
	if (!interval.endedAt) return 0;
	return grossMinutes(interval.startedAt, interval.endedAt);
}

/**
 * Unpaid minutes to subtract from a shift's gross time.
 *
 * Automatic mode never invents break events; it applies the configured
 * deduction when the shift is long enough, and nothing otherwise.
 */
export function unpaidBreakMinutes(
	policy: BreakPolicy,
	gross: number,
	breaks: BreakInterval[] = []
): number {
	switch (policy.mode) {
		case 'manual':
			return breaks
				.filter((b) => b.endedAt !== null && !b.isPaid)
				.reduce((total, b) => total + breakMinutes(b), 0);

		case 'automatic':
			return gross >= policy.automaticBreakThresholdMinutes ? policy.automaticBreakMinutes : 0;

		case 'none':
		default:
			return 0;
	}
}

/** Payable time after the break policy is applied. Never negative. */
export function payableMinutes(
	policy: BreakPolicy,
	startedAt: Date,
	endedAt: Date,
	breaks: BreakInterval[] = []
): { gross: number; unpaidBreak: number; payable: number } {
	const gross = grossMinutes(startedAt, endedAt);
	const unpaidBreak = unpaidBreakMinutes(policy, gross, breaks);
	return { gross, unpaidBreak, payable: Math.max(gross - unpaidBreak, 0) };
}

/**
 * Elapsed working time for a shift that is still open, excluding time spent
 * on an in-progress break. Used by the live timer.
 */
export function elapsedWorkingMinutes(
	startedAt: Date,
	now: Date,
	breaks: BreakInterval[] = []
): number {
	const gross = grossMinutes(startedAt, now);
	const onBreak = breaks.reduce((total, b) => {
		const end = b.endedAt ?? now;
		return total + grossMinutes(b.startedAt, end);
	}, 0);
	return Math.max(gross - onBreak, 0);
}

export type AttendanceState = 'not_clocked_in' | 'working' | 'on_break' | 'shift_completed';

/** Which attendance action the employee may take right now. */
export function availableAction(state: AttendanceState): 'clock_in' | 'clock_out' | null {
	switch (state) {
		case 'not_clocked_in':
		case 'shift_completed':
			return 'clock_in';
		case 'working':
			return 'clock_out';
		case 'on_break':
			// Policy for the MVP: end the break first.
			return null;
	}
}

/** A shift with no clock-out is incomplete and needs manager attention. */
export function isIncomplete(shift: { endedAt: Date | null; status: string }): boolean {
	return shift.status !== 'active' && shift.endedAt === null;
}

/** Formats a minute count as `7h 30m`, or `45m` under an hour. */
export function formatDuration(minutes: number): string {
	if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

/** Formats a running timer as `H:MM:SS`. */
export function formatTimer(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
