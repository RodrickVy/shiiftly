import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import {
	addEmployee,
	backdateShift,
	createOrg,
	createStationWithToken,
	randomToken,
	sha256,
	type Employee,
	type Org
} from './fixtures';

let t: TestDb;
let org: Org;
let employee: Employee;
let station: Awaited<ReturnType<typeof createStationWithToken>>;

beforeAll(async () => {
	t = await createTestDb();
});

afterAll(async () => {
	await t?.close();
});

beforeEach(async () => {
	org = await createOrg(t, { email: `owner-${randomToken().slice(0, 8)}@x.test`, name: 'Kibera Cafe' });
	employee = await addEmployee(t, org, {
		email: `emp-${randomToken().slice(0, 8)}@x.test`,
		fullName: 'Amina Yusuf'
	});
	station = await createStationWithToken(t, org);
});

/** Current open shift for a membership, if any. */
async function activeShift(membershipId: string) {
	const rows = await t.q<{ id: string; started_at: string }>(
		`select id, started_at from public.shifts
		 where employee_membership_id = $1 and status = 'active'`,
		[membershipId]
	);
	return rows[0];
}

describe('clock in via QR', () => {
	it('records a shift and a clock_in event', async () => {
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; shift_id: string }>('public.clock_in_with_token', [
				sha256(station.rawToken),
				null
			])
		);

		expect(res.ok).toBe(true);

		const shift = await activeShift(employee.membershipId);
		expect(shift).toBeDefined();
		expect(shift.id).toBe(res.shift_id);

		const events = await t.q<{ event_type: string; station_id: string }>(
			`select event_type, station_id from public.attendance_events where shift_id = $1`,
			[res.shift_id]
		);
		expect(events).toHaveLength(1);
		expect(events[0].event_type).toBe('clock_in');
		expect(events[0].station_id).toBe(station.stationId);
	});

	it('rejects a duplicate clock-in while a shift is open', async () => {
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(station.rawToken), null])
		);

		const second = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [
				sha256(station.rawToken),
				null
			])
		);

		expect(second).toMatchObject({ ok: false, code: 'already_clocked_in' });

		const all = await t.q(`select id from public.shifts where employee_membership_id = $1`, [
			employee.membershipId
		]);
		expect(all).toHaveLength(1);
	});

	/**
	 * Two concurrent requests are made safe by the partial unique index, not by
	 * application sequencing. PGlite runs on a single connection, so this test
	 * proves the constraint itself: a second active shift row is impossible
	 * even when inserted directly, bypassing all application logic.
	 */
	it('cannot store two active shifts for one employee at the database level', async () => {
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(station.rawToken), null])
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

	it('rejects an unknown token', async () => {
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [
				sha256(randomToken()),
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_or_expired_token' });
	});

	it("rejects yesterday's token once the organization-local day has rolled over", async () => {
		// Age the token by a day: same station, previous local date.
		await t.q(
			`update public.station_daily_tokens
			   set local_date = local_date - 1,
			       expires_at = expires_at - interval '1 day'
			 where station_id = $1`,
			[station.stationId]
		);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [
				sha256(station.rawToken),
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_or_expired_token' });
	});

	it('rejects a token whose station has been deactivated', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(`update public.clocking_stations set is_active = false where id = $1`, [station.stationId])
		);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [
				sha256(station.rawToken),
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_or_expired_token' });
	});

	it('refuses a member of another organization', async () => {
		const other = await createOrg(t, { email: `o2-${randomToken().slice(0, 6)}@x.test`, name: 'Other Co' });
		const outsider = await addEmployee(t, other, {
			email: `out-${randomToken().slice(0, 6)}@x.test`,
			fullName: 'Outsider'
		});

		const res = await t.asUser(outsider.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_in_with_token', [
				sha256(station.rawToken),
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'not_a_member' });
	});

	it('returns the original result when a request is retried with the same idempotency key', async () => {
		const key = 'retry-key-1';
		const first = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; shift_id: string }>('public.clock_in_with_token', [
				sha256(station.rawToken),
				key
			])
		);
		const retry = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; shift_id: string }>('public.clock_in_with_token', [
				sha256(station.rawToken),
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
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		await backdateShift(t, open.shift_id, 90);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; gross_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(station.rawToken), null]
			)
		);

		expect(res.ok).toBe(true);
		expect(res.gross_minutes).toBe(90);
		// break_mode defaults to 'none'
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
			t.rpc<{ ok: boolean; code: string }>('public.clock_out_with_token', [
				sha256(station.rawToken),
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'no_active_shift' });
	});

	it('calculates an overnight shift across local midnight', async () => {
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		// 22:00 yesterday to now: 9 hours regardless of the date boundary.
		await backdateShift(t, open.shift_id, 9 * 60);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ gross_minutes: number }>('public.clock_out_with_token', [
				sha256(station.rawToken),
				null
			])
		);
		expect(res.gross_minutes).toBe(540);
	});
});

describe('break policies', () => {
	it('automatic mode deducts the configured break once the threshold is met', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(
				`update public.organization_settings
				   set break_mode = 'automatic',
				       automatic_break_minutes = 30,
				       automatic_break_threshold_minutes = 360
				 where organization_id = $1`,
				[org.orgId]
			)
		);

		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		await backdateShift(t, open.shift_id, 480); // 8h

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ gross_minutes: number; unpaid_break_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(station.rawToken), null]
			)
		);

		expect(res.gross_minutes).toBe(480);
		expect(res.unpaid_break_minutes).toBe(30);
		expect(res.payable_minutes).toBe(450);
	});

	it('automatic mode deducts nothing below the threshold', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(
				`update public.organization_settings
				   set break_mode = 'automatic', automatic_break_minutes = 30,
				       automatic_break_threshold_minutes = 360
				 where organization_id = $1`,
				[org.orgId]
			)
		);

		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		await backdateShift(t, open.shift_id, 120);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ unpaid_break_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(station.rawToken), null]
			)
		);
		expect(res.unpaid_break_minutes).toBe(0);
		expect(res.payable_minutes).toBe(120);
	});

	it('manual mode subtracts recorded unpaid break time', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(`update public.organization_settings set break_mode = 'manual' where organization_id = $1`, [
				org.orgId
			])
		);

		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(station.rawToken), null])
		);

		const started = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; break_id: string }>('public.start_break', [org.orgId])
		);
		expect(started.ok).toBe(true);

		// Simulate a 20 minute break.
		await t.q(
			`update public.break_records set started_at = now() - interval '20 minutes' where id = $1`,
			[started.break_id]
		);

		const ended = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; duration_minutes: number }>('public.end_break', [org.orgId])
		);
		expect(ended.duration_minutes).toBe(20);

		await backdateShift(t, open.shift_id, 300);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ gross_minutes: number; unpaid_break_minutes: number; payable_minutes: number }>(
				'public.clock_out_with_token',
				[sha256(station.rawToken), null]
			)
		);

		expect(res.gross_minutes).toBe(300);
		expect(res.unpaid_break_minutes).toBe(20);
		expect(res.payable_minutes).toBe(280);
	});

	it('rejects a second break while one is open', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(`update public.organization_settings set break_mode = 'manual' where organization_id = $1`, [
				org.orgId
			])
		);
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		await t.asUser(employee.userId, () => t.rpc('public.start_break', [org.orgId]));

		const second = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.start_break', [org.orgId])
		);
		expect(second).toMatchObject({ ok: false, code: 'break_already_active' });
	});

	it('refuses a break with no open shift', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(`update public.organization_settings set break_mode = 'manual' where organization_id = $1`, [
				org.orgId
			])
		);
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.start_break', [org.orgId])
		);
		expect(res).toMatchObject({ ok: false, code: 'no_active_shift' });
	});

	it('refuses ending a break that was never started', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(`update public.organization_settings set break_mode = 'manual' where organization_id = $1`, [
				org.orgId
			])
		);
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.end_break', [org.orgId])
		);
		expect(res).toMatchObject({ ok: false, code: 'no_active_break' });
	});

	it('requires ending the break before clocking out', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(`update public.organization_settings set break_mode = 'manual' where organization_id = $1`, [
				org.orgId
			])
		);
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		await t.asUser(employee.userId, () => t.rpc('public.start_break', [org.orgId]));

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.clock_out_with_token', [
				sha256(station.rawToken),
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'break_in_progress' });
	});

	it('does not offer manual breaks when the policy is automatic', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.q(
				`update public.organization_settings set break_mode = 'automatic' where organization_id = $1`,
				[org.orgId]
			)
		);
		await t.asUser(employee.userId, () =>
			t.rpc('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.start_break', [org.orgId])
		);
		expect(res).toMatchObject({ ok: false, code: 'manual_breaks_disabled' });
	});

	/**
	 * Changing the policy must not retroactively rewrite what an already
	 * completed shift was worth.
	 */
	it('leaves completed shifts untouched when the break policy later changes', async () => {
		const open = await t.asUser(employee.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(station.rawToken), null])
		);
		await backdateShift(t, open.shift_id, 480);
		const before = await t.asUser(employee.userId, () =>
			t.rpc<{ payable_minutes: number }>('public.clock_out_with_token', [
				sha256(station.rawToken),
				null
			])
		);
		expect(before.payable_minutes).toBe(480);

		await t.asUser(org.ownerUserId, () =>
			t.q(
				`update public.organization_settings
				   set break_mode = 'automatic', automatic_break_minutes = 60,
				       automatic_break_threshold_minutes = 1
				 where organization_id = $1`,
				[org.orgId]
			)
		);

		const [after] = await t.q<{ payable_minutes: number }>(
			`select payable_minutes from public.shifts where id = $1`,
			[open.shift_id]
		);
		expect(after.payable_minutes).toBe(480);
	});
});
