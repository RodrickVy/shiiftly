import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import {
	addMember,
	backdateShift,
	enableJoinLink,
	createDailyCode,
	createOrg,
	createStation,
	randomToken,
	sha256,
	uniqueEmail,
	type Member,
	type Org
} from './fixtures';

let t: TestDb;
let org: Org;
let employee: Member;
let code: Awaited<ReturnType<typeof createDailyCode>>;

beforeAll(async () => {
	t = await createTestDb();
});

afterAll(async () => {
	await t?.close();
});

beforeEach(async () => {
	org = await createOrg(t, { name: 'Kibera Cafe' });
	employee = await addMember(t, org, { fullName: 'Amina Yusuf' });
	code = await createDailyCode(t, org);
});

async function activeShift(membershipId: string) {
	const rows = await t.q<{ id: string; started_at: string }>(
		`select id, started_at from public.shifts
		 where employee_membership_id = $1 and status = 'active'`,
		[membershipId]
	);
	return rows[0];
}

describe('clock in by scanning', () => {
	it('records a shift and a clock_in event', async () => {
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; shift_id: string }>('public.clock_in_with_token', [
				sha256(code.raw),
				null
			])
		);

		expect(res.ok).toBe(true);

		const shift = await activeShift(employee.membershipId);
		expect(shift?.id).toBe(res.shift_id);

		const events = await t.q<{ event_type: string }>(
			`select event_type from public.attendance_events where shift_id = $1`,
			[res.shift_id]
		);
		expect(events).toHaveLength(1);
		expect(events[0].event_type).toBe('clock_in');
	});

	/**
	 * Every station screen shows the same code, so a scan identifies the
	 * organization and the day -- never which screen it came from.
	 */
	it('does not attribute the shift to any station', async () => {
		await createStation(t, org, { name: 'Front door' });
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);

		const [shift] = await t.q<{ station_id: string | null }>(
			`select station_id from public.shifts where id = $1`,
			[res.shift_id]
		);
		expect(shift.station_id).toBeNull();
	});

	it('rejects a duplicate clock-in while a shift is open', async () => {
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(code.raw), null])
		);

		const second = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		expect(second).toMatchObject({ ok: false, code: 'already_clocked_in' });

		const all = await t.q(`select id from public.shifts where employee_membership_id = $1`, [
			employee.membershipId
		]);
		expect(all).toHaveLength(1);
	});

	/**
	 * Concurrency is made safe by the partial unique index, not by
	 * application sequencing. PGlite is single-connection, so this proves the
	 * constraint itself: a second active shift is impossible even inserted
	 * directly, bypassing all application logic.
	 */
	it('cannot store two active shifts for one employee at the database level', async () => {
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(code.raw), null])
		);

		await expect(
			t.q(
				`insert into public.shifts
				   (organization_id, employee_membership_id, started_at, status, clock_in_method)
				 values ($1, $2, now(), 'active', 'qr')`,
				[org.orgId, employee.membershipId]
			)
		).rejects.toThrow(/duplicate key|unique/i);
	});

	it('rejects an unknown code', async () => {
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [
				sha256(randomToken()),
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_or_expired_token' });
	});

	it("rejects yesterday's code once the organization-local day has rolled over", async () => {
		await t.q(
			`update public.organization_daily_tokens
			   set local_date = local_date - 1, expires_at = expires_at - interval '1 day'
			 where organization_id = $1`,
			[org.orgId]
		);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_or_expired_token' });
	});

	it('refuses a member of another organization', async () => {
		const other = await createOrg(t, { name: 'Other Co' });
		const outsider = await addMember(t, other, { fullName: 'Outsider' });

		const res = await t.asUser(outsider.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		expect(res).toMatchObject({ ok: false, code: 'not_a_member' });
	});

	/** A tablet by the door is a screen, not a worker. */
	it('refuses a station device account', async () => {
		const station = await createStation(t, org);
		const res = await t.asUser(station.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		expect(res).toMatchObject({ ok: false, code: 'not_a_member' });
	});

	it('refuses someone still waiting for approval', async () => {
		const joinToken = await enableJoinLink(t, org);
		const applicantId = await t.createUser(uniqueEmail('pending'));
		await t.asUser(applicantId, () =>
			t.rpc('public.request_to_join', [sha256(joinToken), 'Still Waiting', '+254712345678'])
		);

		const res = await t.asUser(applicantId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		expect(res).toMatchObject({ ok: false, code: 'not_a_member' });
	});

	it('returns the original result when retried with the same idempotency key', async () => {
		const key = 'retry-key-1';
		const first = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), key])
		);
		const retry = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; shift_id: string }>('public.clock_in_with_token', [
				sha256(code.raw),
				key
			])
		);
		expect(retry.ok).toBe(true);
		expect(retry.shift_id).toBe(first.shift_id);
	});
});

describe('clock out', () => {
	it('closes the shift and records payable time', async () => {
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await backdateShift(t, open.shift_id, 90);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; gross_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(code.raw), null]
			)
		);

		expect(res.ok).toBe(true);
		expect(res.gross_minutes).toBe(90);
		expect(res.payable_minutes).toBe(90);

		const [shift] = await t.q<{ status: string; ended_at: string }>(
			`select status, ended_at from public.shifts where id = $1`,
			[open.shift_id]
		);
		expect(shift.status).toBe('completed');
		expect(shift.ended_at).not.toBeNull();
	});

	it('rejects clock-out when no shift is open', async () => {
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_out_with_token', [sha256(code.raw), null])
		);
		expect(res).toMatchObject({ ok: false, code: 'no_active_shift' });
	});

	it('calculates an overnight shift across local midnight', async () => {
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await backdateShift(t, open.shift_id, 9 * 60);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ gross_minutes: number }>('public.clock_out_with_token', [sha256(code.raw), null])
		);
		expect(res.gross_minutes).toBe(540);
	});
});

describe('break policies', () => {
	async function setBreakMode(mode: string, minutes = 30, threshold = 360) {
		await t.asUser(org.ownerUserId, () =>
			t.q(
				`update public.organization_settings
				   set break_mode = $2::break_mode,
				       automatic_break_minutes = $3,
				       automatic_break_threshold_minutes = $4
				 where organization_id = $1`,
				[org.orgId, mode, minutes, threshold]
			)
		);
	}

	it('automatic mode deducts the configured break once the threshold is met', async () => {
		await setBreakMode('automatic', 30, 360);
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await backdateShift(t, open.shift_id, 480);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ gross_minutes: number; unpaid_break_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(code.raw), null]
			)
		);
		expect(res).toMatchObject({
			gross_minutes: 480,
			unpaid_break_minutes: 30,
			payable_minutes: 450
		});
	});

	it('automatic mode deducts nothing below the threshold', async () => {
		await setBreakMode('automatic', 30, 360);
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await backdateShift(t, open.shift_id, 120);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ unpaid_break_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(code.raw), null]
			)
		);
		expect(res).toMatchObject({ unpaid_break_minutes: 0, payable_minutes: 120 });
	});

	it('manual mode subtracts recorded unpaid break time', async () => {
		await setBreakMode('manual');
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);

		const started = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; break_id: string }>('public.start_break', [org.orgId])
		);
		expect(started.ok).toBe(true);

		await t.q(
			`update public.break_records set started_at = now() - interval '20 minutes' where id = $1`,
			[started.break_id]
		);

		const ended = await t.asUser(employee.userId, () =>
			t.rpc<{ duration_minutes: number }>('public.end_break', [org.orgId])
		);
		expect(ended.duration_minutes).toBe(20);

		await backdateShift(t, open.shift_id, 300);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ gross_minutes: number; unpaid_break_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(code.raw), null]
			)
		);
		expect(res).toMatchObject({
			gross_minutes: 300,
			unpaid_break_minutes: 20,
			payable_minutes: 280
		});
	});

	it('rejects a second break while one is open', async () => {
		await setBreakMode('manual');
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await t.asUser(employee.userId, () => t.rpc('public.start_break', [org.orgId]));

		const second = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.start_break', [org.orgId])
		);
		expect(second).toMatchObject({ ok: false, code: 'break_already_active' });
	});

	it('refuses a break with no open shift', async () => {
		await setBreakMode('manual');
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.start_break', [org.orgId])
		);
		expect(res).toMatchObject({ ok: false, code: 'no_active_shift' });
	});

	it('refuses ending a break that was never started', async () => {
		await setBreakMode('manual');
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(code.raw), null])
		);
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.end_break', [org.orgId])
		);
		expect(res).toMatchObject({ ok: false, code: 'no_active_break' });
	});

	it('requires ending the break before clocking out', async () => {
		await setBreakMode('manual');
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await t.asUser(employee.userId, () => t.rpc('public.start_break', [org.orgId]));

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_out_with_token', [sha256(code.raw), null])
		);
		expect(res).toMatchObject({ ok: false, code: 'break_in_progress' });
	});

	it('does not offer manual breaks when the policy is automatic', async () => {
		await setBreakMode('automatic');
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(code.raw), null])
		);
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.start_break', [org.orgId])
		);
		expect(res).toMatchObject({ ok: false, code: 'manual_breaks_disabled' });
	});

	it('leaves completed shifts untouched when the break policy later changes', async () => {
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await backdateShift(t, open.shift_id, 480);
		const before = await t.asUser(employee.userId, () =>
			t.rpc<{ payable_minutes: number }>('public.clock_out_with_token', [sha256(code.raw), null])
		);
		expect(before.payable_minutes).toBe(480);

		await setBreakMode('automatic', 60, 1);

		const [after] = await t.q<{ payable_minutes: number }>(
			`select payable_minutes from public.shifts where id = $1`,
			[open.shift_id]
		);
		expect(after.payable_minutes).toBe(480);
	});
});
