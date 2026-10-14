/**
 * The TypeScript break/duration arithmetic in src/lib/domain/attendance.ts is
 * a second implementation of what `_close_shift` does in SQL: the UI uses it
 * to preview an open shift, the database uses its own to write the stored
 * figures. Two implementations of one rule drift unless something checks
 * them against each other. That is this file's whole job.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { addEmployee, createOrg, createStationWithToken, randomToken, sha256 } from './fixtures';
import { payableMinutes, type BreakPolicy } from '../../src/lib/domain/attendance';

let t: TestDb;
let org: Awaited<ReturnType<typeof createOrg>>;
let station: Awaited<ReturnType<typeof createStationWithToken>>;

beforeAll(async () => {
	t = await createTestDb();
	org = await createOrg(t, { email: 'parity@x.test', name: 'Parity Co' });
	station = await createStationWithToken(t, org);
});

afterAll(async () => {
	await t?.close();
});

interface Scenario {
	label: string;
	mode: 'none' | 'automatic' | 'manual';
	automaticMinutes: number;
	thresholdMinutes: number;
	shiftMinutes: number;
	/** Completed unpaid breaks, in minutes, for manual mode. */
	breaks: number[];
}

const scenarios: Scenario[] = [
	{ label: 'no policy, 8h', mode: 'none', automaticMinutes: 0, thresholdMinutes: 0, shiftMinutes: 480, breaks: [] },
	{ label: 'automatic, exactly at threshold', mode: 'automatic', automaticMinutes: 30, thresholdMinutes: 360, shiftMinutes: 360, breaks: [] },
	{ label: 'automatic, one minute under threshold', mode: 'automatic', automaticMinutes: 30, thresholdMinutes: 360, shiftMinutes: 359, breaks: [] },
	{ label: 'automatic, long shift', mode: 'automatic', automaticMinutes: 45, thresholdMinutes: 300, shiftMinutes: 611, breaks: [] },
	{ label: 'automatic, deduction exceeds shift', mode: 'automatic', automaticMinutes: 120, thresholdMinutes: 1, shiftMinutes: 30, breaks: [] },
	{ label: 'manual, single break', mode: 'manual', automaticMinutes: 0, thresholdMinutes: 0, shiftMinutes: 300, breaks: [20] },
	{ label: 'manual, several breaks', mode: 'manual', automaticMinutes: 0, thresholdMinutes: 0, shiftMinutes: 540, breaks: [15, 30, 7] },
	{ label: 'manual, no breaks taken', mode: 'manual', automaticMinutes: 0, thresholdMinutes: 0, shiftMinutes: 240, breaks: [] },
	{ label: 'overnight, 11h', mode: 'automatic', automaticMinutes: 30, thresholdMinutes: 360, shiftMinutes: 660, breaks: [] }
];

describe('SQL and TypeScript agree on payable time', () => {
	for (const s of scenarios) {
		it(s.label, async () => {
			const employee = await addEmployee(t, org, {
				email: `p-${randomToken().slice(0, 10)}@x.test`,
				fullName: 'Parity Employee'
			});

			await t.asUser(org.ownerUserId, () =>
				t.q(
					`update public.organization_settings
					   set break_mode = $2::break_mode,
					       automatic_break_minutes = $3,
					       automatic_break_threshold_minutes = $4
					 where organization_id = $1`,
					[org.orgId, s.mode, s.automaticMinutes, s.thresholdMinutes]
				)
			);

			const open = await t.asUser(employee.userId, () =>
				t.rpc<{ ok: boolean; shift_id: string }>('public.clock_in_with_token', [
					sha256(station.rawToken),
					null
				])
			);
			expect(open.ok).toBe(true);

			// Record the breaks, then position the shift start so that the
			// total elapsed time is exactly s.shiftMinutes.
			for (const minutes of s.breaks) {
				const started = await t.asUser(employee.userId, () =>
					t.rpc<{ ok: boolean; break_id: string }>('public.start_break', [org.orgId])
				);
				expect(started.ok).toBe(true);
				await t.q(
					`update public.break_records
					   set started_at = now() - ($2 || ' minutes')::interval where id = $1`,
					[started.break_id, String(minutes)]
				);
				const ended = await t.asUser(employee.userId, () =>
					t.rpc<{ duration_minutes: number }>('public.end_break', [org.orgId])
				);
				expect(ended.duration_minutes).toBe(minutes);
			}

			await t.q(
				`update public.shifts set started_at = now() - ($2 || ' minutes')::interval where id = $1`,
				[open.shift_id, String(s.shiftMinutes)]
			);

			const sql = await t.asUser(employee.userId, () =>
				t.rpc<{
					gross_minutes: number;
					unpaid_break_minutes: number;
					payable_minutes: number;
				}>('public.clock_out_with_token', [sha256(station.rawToken), null])
			);

			// The same inputs, through the TypeScript implementation.
			const policy: BreakPolicy = {
				mode: s.mode,
				automaticBreakMinutes: s.automaticMinutes,
				automaticBreakThresholdMinutes: s.thresholdMinutes
			};
			const end = new Date();
			const start = new Date(end.getTime() - s.shiftMinutes * 60_000);
			const ts = payableMinutes(
				policy,
				start,
				end,
				s.breaks.map((m) => ({
					startedAt: new Date(end.getTime() - m * 60_000),
					endedAt: end,
					isPaid: false
				}))
			);

			expect(sql.gross_minutes).toBe(ts.gross);
			expect(sql.unpaid_break_minutes).toBe(ts.unpaidBreak);
			expect(sql.payable_minutes).toBe(ts.payable);
		});
	}
});
