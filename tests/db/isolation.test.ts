import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { addMember, createDailyCode, createOrg, createStation, sha256 } from './fixtures';

/**
 * These tests drive the database through the `authenticated` role with a real
 * subject claim, which is exactly how a request from a signed-in browser
 * reaches Postgres. Anything these tests can reach, a crafted API call could
 * reach too.
 */

let t: TestDb;

// Organization A
let orgA: Awaited<ReturnType<typeof createOrg>>;
let alice: Awaited<ReturnType<typeof addMember>>;
let bob: Awaited<ReturnType<typeof addMember>>;
let managerA: Awaited<ReturnType<typeof addMember>>;

// Organization B
let orgB: Awaited<ReturnType<typeof createOrg>>;
let carol: Awaited<ReturnType<typeof addMember>>;

beforeAll(async () => {
	t = await createTestDb();

	orgA = await createOrg(t, { email: 'owner-a@x.test', name: 'Alpha Retail' });
	alice = await addMember(t, orgA, { email: 'alice@x.test', fullName: 'Alice A' });
	bob = await addMember(t, orgA, { email: 'bob@x.test', fullName: 'Bob B' });
	managerA = await addMember(t, orgA, {
		email: 'mgr-a@x.test',
		fullName: 'Manager A',
		role: 'manager'
	});

	orgB = await createOrg(t, { email: 'owner-b@x.test', name: 'Beta Logistics' });
	carol = await addMember(t, orgB, { email: 'carol@x.test', fullName: 'Carol C' });

	// Give Alice and Carol one completed shift each.
	for (const [org, emp] of [
		[orgA, alice],
		[orgB, carol]
	] as const) {
		const code = await createDailyCode(t, org);
		const open = await t.asUser(emp.userId, () =>
			t.rpc<{ shift_id: string }>('public.clock_in_with_token', [sha256(code.raw), null])
		);
		await t.q(`update public.shifts set started_at = now() - interval '4 hours' where id = $1`, [
			open.shift_id
		]);
		await t.asUser(emp.userId, () =>
			t.rpc('public.clock_out_with_token', [sha256(code.raw), null])
		);
	}
});

afterAll(async () => {
	await t?.close();
});

describe('employee vs employee', () => {
	it('an employee sees only their own shifts', async () => {
		const rows = await t.asUser(bob.userId, () =>
			t.q<{ employee_membership_id: string }>(`select employee_membership_id from public.shifts`)
		);
		// Bob has no shifts of his own, and must not see Alice's.
		expect(rows).toEqual([]);
	});

	it('an employee cannot read a colleague\'s attendance events', async () => {
		const rows = await t.asUser(bob.userId, () =>
			t.q(`select id from public.attendance_events`)
		);
		expect(rows).toEqual([]);
	});

	it('an employee cannot read a colleague\'s pay rate', async () => {
		await t.asUser(orgA.ownerUserId, () =>
			t.rpc('public.set_pay_rate', [alice.membershipId, 500, '2026-01-01', 'KES'])
		);

		const asBob = await t.asUser(bob.userId, () =>
			t.q(`select hourly_rate from public.pay_rates`)
		);
		expect(asBob).toEqual([]);

		const asAlice = await t.asUser(alice.userId, () =>
			t.q<{ hourly_rate: string }>(`select hourly_rate from public.pay_rates`)
		);
		expect(asAlice).toHaveLength(1);
	});

	it('an employee cannot read a colleague\'s time-off reason', async () => {
		await t.asUser(alice.userId, () =>
			t.rpc('public.submit_time_off_request', [
				orgA.orgId,
				'Sick Leave',
				'2026-03-01',
				'2026-03-02',
				'private medical detail'
			])
		);

		const rows = await t.asUser(bob.userId, () =>
			t.q(`select reason from public.time_off_requests`)
		);
		expect(rows).toEqual([]);
	});
});

describe('cross-organization isolation', () => {
	it('a member of one organization sees none of another\'s shifts', async () => {
		const rows = await t.asUser(carol.userId, () => t.q(`select id from public.shifts`));
		// Carol sees her own shift only, never Alice's.
		expect(rows).toHaveLength(1);

		const [mine] = await t.asUser(carol.userId, () =>
			t.q<{ organization_id: string }>(`select organization_id from public.shifts`)
		);
		expect(mine.organization_id).toBe(orgB.orgId);
	});

	it('a manager of one organization cannot read another\'s employees', async () => {
		const rows = await t.asUser(managerA.userId, () =>
			t.q<{ organization_id: string }>(`select organization_id from public.organization_memberships`)
		);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.organization_id === orgA.orgId)).toBe(true);
	});

	it('an outsider cannot read another organization\'s settings or stations', async () => {
		const settings = await t.asUser(carol.userId, () =>
			t.q<{ organization_id: string }>(`select organization_id from public.organization_settings`)
		);
		expect(settings.every((r) => r.organization_id === orgB.orgId)).toBe(true);

		const stations = await t.asUser(carol.userId, () =>
			t.q<{ organization_id: string }>(`select organization_id from public.clocking_stations`)
		);
		expect(stations.every((r) => r.organization_id === orgB.orgId)).toBe(true);
	});

	it('clocking codes are not readable by employees at all', async () => {
		const rows = await t.asUser(alice.userId, () =>
			t.q(`select token_hash from public.organization_daily_tokens`)
		);
		expect(rows).toEqual([]);
	});

	/** A tablet by the door must not become a window into the business. */
	it('a station device can read nothing but its own station row', async () => {
		const station = await createStation(t, orgA, { name: 'Lobby screen' });

		const shifts = await t.asUser(station.userId, () => t.q(`select id from public.shifts`));
		expect(shifts).toEqual([]);

		const people = await t.asUser(station.userId, () =>
			t.q(`select id from public.organization_memberships`)
		);
		// Only its own membership row, via the "own membership" policy.
		expect(people.length).toBeLessThanOrEqual(1);

		const codes = await t.asUser(station.userId, () =>
			t.q(`select token_hash from public.organization_daily_tokens`)
		);
		expect(codes).toEqual([]);

		const rates = await t.asUser(station.userId, () => t.q(`select id from public.pay_rates`));
		expect(rates).toEqual([]);
	});
});

describe('privilege escalation', () => {
	it('an employee cannot promote themselves', async () => {
		await t.asUser(alice.userId, () =>
			t.q(`update public.organization_memberships set role = 'owner' where id = $1`, [
				alice.membershipId
			])
		);

		const [row] = await t.q<{ role: string }>(
			`select role from public.organization_memberships where id = $1`,
			[alice.membershipId]
		);
		expect(row.role).toBe('employee');
	});

	it('an employee cannot promote themselves through the role RPC', async () => {
		const res = await t.asUser(alice.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.set_member_role', [alice.membershipId, 'owner'])
		);
		expect(res).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('a manager cannot change roles; only an owner can', async () => {
		const asManager = await t.asUser(managerA.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.set_member_role', [bob.membershipId, 'manager'])
		);
		expect(asManager).toMatchObject({ ok: false, code: 'forbidden' });

		const asOwner = await t.asUser(orgA.ownerUserId, () =>
			t.rpc<{ ok: boolean }>('public.set_member_role', [bob.membershipId, 'manager'])
		);
		expect(asOwner.ok).toBe(true);
	});

	it('an employee cannot approve their own time-off request', async () => {
		// A dedicated employee, so an earlier promotion in this file cannot
		// make the assertion vacuous.
		const dave = await addMember(t, orgA, { email: 'dave@x.test', fullName: 'Dave D' });

		const submitted = await t.asUser(dave.userId, () =>
			t.rpc<{ request_id: string }>('public.submit_time_off_request', [
				orgA.orgId,
				'Vacation',
				'2026-04-01',
				'2026-04-03',
				null
			])
		);

		const res = await t.asUser(dave.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.review_time_off_request', [
				submitted.request_id,
				'approved',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'forbidden' });

		const [row] = await t.q<{ status: string }>(
			`select status from public.time_off_requests where id = $1`,
			[submitted.request_id]
		);
		expect(row.status).toBe('pending');
	});

	it('a manager cannot approve their own time-off request', async () => {
		const submitted = await t.asUser(managerA.userId, () =>
			t.rpc<{ request_id: string }>('public.submit_time_off_request', [
				orgA.orgId,
				'Vacation',
				'2026-06-01',
				'2026-06-02',
				null
			])
		);

		const self = await t.asUser(managerA.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.review_time_off_request', [
				submitted.request_id,
				'approved',
				null
			])
		);
		expect(self).toMatchObject({ ok: false, code: 'cannot_review_own_request' });

		// The owner can decide it.
		const byOwner = await t.asUser(orgA.ownerUserId, () =>
			t.rpc<{ ok: boolean }>('public.review_time_off_request', [
				submitted.request_id,
				'approved',
				null
			])
		);
		expect(byOwner.ok).toBe(true);
	});

	it('a manager of another organization cannot approve the request', async () => {
		const submitted = await t.asUser(alice.userId, () =>
			t.rpc<{ request_id: string }>('public.submit_time_off_request', [
				orgA.orgId,
				'Vacation',
				'2026-05-01',
				'2026-05-02',
				null
			])
		);

		const res = await t.asUser(orgB.ownerUserId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.review_time_off_request', [
				submitted.request_id,
				'approved',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('an employee cannot set a pay rate', async () => {
		const res = await t.asUser(alice.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.set_pay_rate', [
				alice.membershipId,
				9999,
				'2026-01-01',
				'KES'
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'forbidden' });
	});

	it('the last owner cannot be demoted or deactivated', async () => {
		const demote = await t.asUser(orgB.ownerUserId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.set_member_role', [
				orgB.ownerMembershipId,
				'employee'
			])
		);
		expect(demote).toMatchObject({ ok: false, code: 'last_owner' });

		const deactivate = await t.asUser(orgB.ownerUserId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.set_member_status', [
				orgB.ownerMembershipId,
				'inactive'
			])
		);
		expect(deactivate).toMatchObject({ ok: false, code: 'last_owner' });
	});
});

describe('immutability', () => {
	it('attendance events cannot be inserted or altered by a user', async () => {
		await expect(
			t.asUser(alice.userId, () =>
				t.q(
					`insert into public.attendance_events
					   (organization_id, shift_id, employee_membership_id, event_type, occurred_at)
					 select organization_id, id, employee_membership_id, 'clock_in', now()
					 from public.shifts limit 1`
				)
			)
		).rejects.toThrow(/permission denied/i);

		await expect(
			t.asUser(alice.userId, () =>
				t.q(`update public.attendance_events set occurred_at = now()`)
			)
		).rejects.toThrow(/permission denied/i);
	});

	it('break records cannot be written directly', async () => {
		await expect(
			t.asUser(alice.userId, () =>
				t.q(
					`insert into public.break_records (organization_id, shift_id, started_at)
					 select organization_id, id, now() from public.shifts limit 1`
				)
			)
		).rejects.toThrow(/permission denied/i);
	});

	it('audit logs cannot be written or erased by a user', async () => {
		await expect(
			t.asUser(managerA.userId, () =>
				t.q(
					`insert into public.audit_logs (organization_id, action, entity_type)
					 values ($1, 'forged', 'test')`,
					[orgA.orgId]
				)
			)
		).rejects.toThrow(/permission denied/i);

		await expect(
			t.asUser(managerA.userId, () => t.q(`delete from public.audit_logs`))
		).rejects.toThrow(/permission denied/i);
	});

	it('pay rates cannot be written directly, only through the owner RPC', async () => {
		await expect(
			t.asUser(managerA.userId, () =>
				t.q(
					`insert into public.pay_rates
					   (organization_id, employee_membership_id, hourly_rate, currency_code, effective_from)
					 values ($1, $2, 1, 'KES', current_date)`,
					[orgA.orgId, bob.membershipId]
				)
			)
		).rejects.toThrow(/permission denied/i);
	});
});
