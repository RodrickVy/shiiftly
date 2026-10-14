import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import {
	addMember,
	createOrg,
	enableJoinLink,
	requestToJoin,
	sha256,
	uniqueEmail
} from './fixtures';

let t: TestDb;
let org: Awaited<ReturnType<typeof createOrg>>;
let manager: Awaited<ReturnType<typeof addMember>>;
let employee: Awaited<ReturnType<typeof addMember>>;

beforeAll(async () => {
	t = await createTestDb();
	org = await createOrg(t, { email: 'owner@w.test', name: 'Workflow Co' });
	manager = await addMember(t, org, {
		email: 'mgr@w.test',
		fullName: 'Mary Manager',
		role: 'manager'
	});
	employee = await addMember(t, org, { email: 'emp@w.test', fullName: 'Eli Employee' });
});

afterAll(async () => {
	await t?.close();
});

describe('joining through the link', () => {
	it('creates a pending membership that grants nothing yet', async () => {
		const joinToken = await enableJoinLink(t, org);
		const { userId, result } = await requestToJoin(t, joinToken, { fullName: 'New Joiner' });

		expect(result).toMatchObject({ ok: true, status: 'pending' });

		const [m] = await t.q<{ role: string; status: string }>(
			`select role, status from public.organization_memberships
			 where organization_id = $1 and user_id = $2`,
			[org.orgId, userId]
		);
		expect(m).toMatchObject({ role: 'employee', status: 'pending' });

		// Pending means pending: no visibility into the organization at all.
		const shifts = await t.asUser(userId, () => t.q(`select id from public.shifts`));
		expect(shifts).toEqual([]);
		const people = await t.asUser(userId, () =>
			t.q(`select id from public.organization_memberships`)
		);
		expect(people).toHaveLength(1);
	});

	it('saves the name and phone the applicant gave', async () => {
		const joinToken = await enableJoinLink(t, org);
		const { userId } = await requestToJoin(t, joinToken, {
			fullName: 'Amina Yusuf',
			phone: '+254712345678'
		});

		const [profile] = await t.q<{ full_name: string; phone: string }>(
			`select full_name, phone from public.profiles where id = $1`,
			[userId]
		);
		expect(profile).toMatchObject({ full_name: 'Amina Yusuf', phone: '+254712345678' });
	});

	it('rejects an unknown link', async () => {
		const userId = await t.createUser(uniqueEmail('nobody'));
		const res = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.request_to_join', [
				sha256('not-a-real-token'),
				'Nobody',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_link' });
	});

	it('refuses when joining is switched off', async () => {
		const joinToken = await enableJoinLink(t, org);
		await t.q(`update public.organizations set join_enabled = false where id = $1`, [org.orgId]);

		const userId = await t.createUser(uniqueEmail('late'));
		const res = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.request_to_join', [
				sha256(joinToken),
				'Too Late',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'joining_closed' });

		await t.q(`update public.organizations set join_enabled = true where id = $1`, [org.orgId]);
	});

	/** Replacing the link is how a manager stops one that has spread. */
	it('stops accepting the old link after the version is bumped', async () => {
		const oldToken = await enableJoinLink(t, org);
		await t.q(
			`update public.organizations set join_token_version = join_token_version + 1 where id = $1`,
			[org.orgId]
		);
		await enableJoinLink(t, org);

		const userId = await t.createUser(uniqueEmail('stale'));
		const res = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.request_to_join', [
				sha256(oldToken),
				'Stale Link',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_link' });
	});

	it('is idempotent while a request is outstanding', async () => {
		const joinToken = await enableJoinLink(t, org);
		const { userId } = await requestToJoin(t, joinToken, { fullName: 'Twice' });

		const again = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; already_pending: boolean }>('public.request_to_join', [
				sha256(joinToken),
				'Twice',
				null
			])
		);
		expect(again).toMatchObject({ ok: true, already_pending: true });

		const rows = await t.q(
			`select id from public.organization_memberships where user_id = $1`,
			[userId]
		);
		expect(rows).toHaveLength(1);
	});

	it('notifies every manager, and nobody else', async () => {
		const joinToken = await enableJoinLink(t, org);
		await requestToJoin(t, joinToken, { fullName: 'Watched Joiner' });

		const notified = await t.q<{ recipient_user_id: string }>(
			`select recipient_user_id from public.notifications where type = 'join.requested'`
		);
		const recipients = notified.map((n) => n.recipient_user_id);
		expect(recipients).toContain(org.ownerUserId);
		expect(recipients).toContain(manager.userId);
		expect(recipients).not.toContain(employee.userId);
	});
});

describe('reviewing a join request', () => {
	async function pendingApplicant(fullName = 'Hopeful') {
		const joinToken = await enableJoinLink(t, org);
		const { userId } = await requestToJoin(t, joinToken, { fullName });
		const [m] = await t.q<{ id: string }>(
			`select id from public.organization_memberships where user_id = $1`,
			[userId]
		);
		return { userId, membershipId: m.id };
	}

	it('accepting activates the membership with the chosen role', async () => {
		const applicant = await pendingApplicant();

		const res = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean }>('public.review_join_request', [
				applicant.membershipId,
				'accept',
				'employee'
			])
		);
		expect(res.ok).toBe(true);

		const [m] = await t.q<{ role: string; status: string }>(
			`select role, status from public.organization_memberships where id = $1`,
			[applicant.membershipId]
		);
		expect(m).toMatchObject({ role: 'employee', status: 'active' });
	});

	it('rejecting records the decision without deleting the person', async () => {
		const applicant = await pendingApplicant();

		const res = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean }>('public.review_join_request', [applicant.membershipId, 'reject'])
		);
		expect(res.ok).toBe(true);

		const [m] = await t.q<{ status: string; deactivated_at: string | null }>(
			`select status, deactivated_at from public.organization_memberships where id = $1`,
			[applicant.membershipId]
		);
		expect(m.status).toBe('rejected');
		expect(m.deactivated_at).not.toBeNull();
	});

	/** The role is the manager's decision, never the applicant's. */
	it('an applicant cannot accept themselves', async () => {
		const applicant = await pendingApplicant();

		const res = await t.asUser(applicant.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.review_join_request', [
				applicant.membershipId,
				'accept',
				'manager'
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'forbidden' });

		const [m] = await t.q<{ status: string }>(
			`select status from public.organization_memberships where id = $1`,
			[applicant.membershipId]
		);
		expect(m.status).toBe('pending');
	});

	it('only an owner may accept someone as a manager', async () => {
		const applicant = await pendingApplicant();

		const byManager = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.review_join_request', [
				applicant.membershipId,
				'accept',
				'manager'
			])
		);
		expect(byManager).toMatchObject({ ok: false, code: 'owner_required_for_manager' });

		const byOwner = await t.asUser(org.ownerUserId, () =>
			t.rpc<{ ok: boolean }>('public.review_join_request', [
				applicant.membershipId,
				'accept',
				'manager'
			])
		);
		expect(byOwner.ok).toBe(true);
	});

	it('cannot be decided twice', async () => {
		const applicant = await pendingApplicant();
		await t.asUser(manager.userId, () =>
			t.rpc('public.review_join_request', [applicant.membershipId, 'accept', 'employee'])
		);
		const again = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.review_join_request', [
				applicant.membershipId,
				'reject'
			])
		);
		expect(again).toMatchObject({ ok: false, code: 'already_reviewed' });
	});

	it('a rejected applicant cannot quietly re-apply', async () => {
		const applicant = await pendingApplicant();
		await t.asUser(manager.userId, () =>
			t.rpc('public.review_join_request', [applicant.membershipId, 'reject'])
		);

		const joinToken = await enableJoinLink(t, org);
		const retry = await t.asUser(applicant.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.request_to_join', [
				sha256(joinToken),
				'Hopeful',
				null
			])
		);
		expect(retry).toMatchObject({ ok: false, code: 'request_rejected' });
	});

	it('notifies the applicant of the decision', async () => {
		const applicant = await pendingApplicant('Told Promptly');
		await t.asUser(manager.userId, () =>
			t.rpc('public.review_join_request', [applicant.membershipId, 'accept', 'employee'])
		);

		const notified = await t.q<{ recipient_user_id: string }>(
			`select recipient_user_id from public.notifications where type = 'join.accept'`
		);
		expect(notified.map((n) => n.recipient_user_id)).toContain(applicant.userId);
	});
});

describe('station device accounts', () => {
	it('claiming a station creates a station-role membership', async () => {
		const { createStation } = await import('./fixtures');
		const station = await createStation(t, org, { name: 'Side door' });

		const [m] = await t.q<{ role: string; status: string }>(
			`select role, status from public.organization_memberships where id = $1`,
			[station.membershipId]
		);
		expect(m).toMatchObject({ role: 'station', status: 'active' });

		const [row] = await t.q<{ membership_id: string; claimed_at: string }>(
			`select membership_id, claimed_at from public.clocking_stations where id = $1`,
			[station.stationId]
		);
		expect(row.membership_id).toBe(station.membershipId);
		expect(row.claimed_at).not.toBeNull();
	});

	it('refuses a second device on the same setup link', async () => {
		const { createStation, derive } = await import('./fixtures');
		const station = await createStation(t, org, { name: 'Taken' });

		const otherUser = await t.createUser(uniqueEmail('second-device'));
		const res = await t.asService(() =>
			t.rpc<{ ok: boolean; code: string }>('public.claim_station', [
				sha256(derive.stationClaim(station.stationId)),
				otherUser,
				'Impostor',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'already_claimed' });
	});

	it('a station device cannot be given a person\u2019s role', async () => {
		const { createStation } = await import('./fixtures');
		const station = await createStation(t, org, { name: 'Fixed role' });

		const res = await t.asUser(org.ownerUserId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.set_member_role', [
				station.membershipId,
				'manager'
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'station_role_fixed' });
	});
});

describe('tasks', () => {
	async function createTask(title = 'Restock the fridge') {
		const [task] = await t.asUser(manager.userId, () =>
			t.q<{ id: string }>(
				`insert into public.tasks (organization_id, title, priority, created_by)
				 values ($1, $2, 'high', $3) returning id`,
				[org.orgId, title, manager.userId]
			)
		);
		return task.id;
	}

	it('a manager can create and assign a task', async () => {
		const taskId = await createTask();
		const res = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean }>('public.set_task_assignees', [taskId, [employee.membershipId]])
		);
		expect(res.ok).toBe(true);

		const seen = await t.asUser(employee.userId, () =>
			t.q<{ id: string; title: string }>(`select id, title from public.tasks`)
		);
		expect(seen.map((r) => r.id)).toContain(taskId);
	});

	it('an assignee can advance the status, and completed_at is set for them', async () => {
		const taskId = await createTask('Sweep the floor');
		await t.asUser(manager.userId, () =>
			t.rpc('public.set_task_assignees', [taskId, [employee.membershipId]])
		);

		await t.asUser(employee.userId, () =>
			t.q(`update public.tasks set status = 'in_progress' where id = $1`, [taskId])
		);
		let [row] = await t.q<{ status: string; completed_at: string | null }>(
			`select status, completed_at from public.tasks where id = $1`,
			[taskId]
		);
		expect(row).toMatchObject({ status: 'in_progress', completed_at: null });

		await t.asUser(employee.userId, () =>
			t.q(`update public.tasks set status = 'completed' where id = $1`, [taskId])
		);
		[row] = await t.q<{ status: string; completed_at: string | null }>(
			`select status, completed_at from public.tasks where id = $1`,
			[taskId]
		);
		expect(row.status).toBe('completed');
		expect(row.completed_at).not.toBeNull();
	});

	it('an assignee cannot rewrite the task itself', async () => {
		const taskId = await createTask('Original title');
		await t.asUser(manager.userId, () =>
			t.rpc('public.set_task_assignees', [taskId, [employee.membershipId]])
		);

		await t.asUser(employee.userId, async () => {
			await expect(
				t.q(`update public.tasks set title = 'Hijacked' where id = $1`, [taskId])
			).rejects.toThrow(/permission denied/i);
		});

		const [row] = await t.q<{ title: string }>(`select title from public.tasks where id = $1`, [
			taskId
		]);
		expect(row.title).toBe('Original title');
	});

	it('an unassigned employee cannot see or touch the task', async () => {
		const taskId = await createTask('Secret task');
		const other = await addMember(t, org, {
			email: uniqueEmail('other'),
			fullName: 'Other Person'
		});

		const seen = await t.asUser(other.userId, () =>
			t.q<{ id: string }>(`select id from public.tasks where id = $1`, [taskId])
		);
		expect(seen).toEqual([]);

		await t.asUser(other.userId, () =>
			t.q(`update public.tasks set status = 'completed' where id = $1`, [taskId])
		);
		const [row] = await t.q<{ status: string }>(`select status from public.tasks where id = $1`, [
			taskId
		]);
		expect(row.status).toBe('todo');
	});

	it('refuses an assignee from another organization', async () => {
		const taskId = await createTask('Cross-org task');
		const otherOrg = await createOrg(t, {
			email: uniqueEmail('other-org'),
			name: 'Elsewhere Ltd'
		});
		const outsider = await addMember(t, otherOrg, {
			email: uniqueEmail('outsider'),
			fullName: 'Outsider'
		});

		const res = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.set_task_assignees', [
				taskId,
				[outsider.membershipId]
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_assignee' });
	});
});

describe('time off and notifications', () => {
	it('submitting a request queues a notification and a pending email for each manager', async () => {
		const before = await t.q<{ c: number }>(
			`select count(*)::int as c from public.notifications
			 where organization_id = $1 and type = 'time_off.requested'`,
			[org.orgId]
		);

		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; request_id: string }>('public.submit_time_off_request', [
				org.orgId,
				'Sick Leave',
				'2026-07-01',
				'2026-07-02',
				'flu'
			])
		);
		expect(res.ok).toBe(true);

		const notifications = await t.q<{ recipient_user_id: string; type: string }>(
			`select recipient_user_id, type from public.notifications
			 where organization_id = $1 and type = 'time_off.requested'`,
			[org.orgId]
		);
		const recipients = notifications.map((n) => n.recipient_user_id);

		// Both the owner and the manager are notified; the employee is not.
		expect(recipients).toContain(org.ownerUserId);
		expect(recipients).toContain(manager.userId);
		expect(recipients).not.toContain(employee.userId);
		expect(notifications.length).toBeGreaterThan(before[0].c);

		const deliveries = await t.q<{ status: string; attempts: number }>(
			`select d.status, d.attempts
			 from public.notification_deliveries d
			 join public.notifications n on n.id = d.notification_id
			 where n.type = 'time_off.requested'`
		);
		expect(deliveries.length).toBeGreaterThan(0);
		expect(deliveries.every((d) => d.status === 'pending' && d.attempts === 0)).toBe(true);
	});

	it('a manager can approve, and the employee is notified', async () => {
		const submitted = await t.asUser(employee.userId, () =>
			t.rpc<{ request_id: string }>('public.submit_time_off_request', [
				org.orgId,
				'Vacation',
				'2026-08-01',
				'2026-08-05',
				null
			])
		);

		const res = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean }>('public.review_time_off_request', [
				submitted.request_id,
				'approved',
				'Enjoy'
			])
		);
		expect(res.ok).toBe(true);

		const [row] = await t.q<{
			status: string;
			reviewed_by: string;
			reviewed_at: string;
			manager_comment: string;
		}>(
			`select status, reviewed_by, reviewed_at, manager_comment
			 from public.time_off_requests where id = $1`,
			[submitted.request_id]
		);
		expect(row.status).toBe('approved');
		expect(row.reviewed_by).toBe(manager.userId);
		expect(row.reviewed_at).not.toBeNull();
		expect(row.manager_comment).toBe('Enjoy');

		const notified = await t.q<{ recipient_user_id: string }>(
			`select recipient_user_id from public.notifications where type = 'time_off.reviewed'`
		);
		expect(notified.map((n) => n.recipient_user_id)).toContain(employee.userId);
	});

	it('a request cannot be decided twice', async () => {
		const submitted = await t.asUser(employee.userId, () =>
			t.rpc<{ request_id: string }>('public.submit_time_off_request', [
				org.orgId,
				'Personal Leave',
				'2026-09-01',
				'2026-09-01',
				null
			])
		);
		await t.asUser(manager.userId, () =>
			t.rpc('public.review_time_off_request', [submitted.request_id, 'approved', null])
		);
		const again = await t.asUser(manager.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.review_time_off_request', [
				submitted.request_id,
				'rejected',
				null
			])
		);
		expect(again).toMatchObject({ ok: false, code: 'already_reviewed' });
	});

	it('an employee can cancel their own pending request but not an approved one', async () => {
		const submitted = await t.asUser(employee.userId, () =>
			t.rpc<{ request_id: string }>('public.submit_time_off_request', [
				org.orgId,
				'Vacation',
				'2026-10-01',
				'2026-10-02',
				null
			])
		);

		await t.asUser(employee.userId, () =>
			t.q(`update public.time_off_requests set status = 'cancelled' where id = $1`, [
				submitted.request_id
			])
		);
		let [row] = await t.q<{ status: string }>(
			`select status from public.time_off_requests where id = $1`,
			[submitted.request_id]
		);
		expect(row.status).toBe('cancelled');

		// Now an approved request: the employee must not be able to flip it.
		const second = await t.asUser(employee.userId, () =>
			t.rpc<{ request_id: string }>('public.submit_time_off_request', [
				org.orgId,
				'Vacation',
				'2026-11-01',
				'2026-11-02',
				null
			])
		);
		await t.asUser(manager.userId, () =>
			t.rpc('public.review_time_off_request', [second.request_id, 'approved', null])
		);
		await t.asUser(employee.userId, () =>
			t.q(`update public.time_off_requests set status = 'cancelled' where id = $1`, [
				second.request_id
			])
		);
		[row] = await t.q<{ status: string }>(
			`select status from public.time_off_requests where id = $1`,
			[second.request_id]
		);
		expect(row.status).toBe('approved');
	});

	it('rejects an end date before the start date', async () => {
		const res = await t.asUser(employee.userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.submit_time_off_request', [
				org.orgId,
				'Vacation',
				'2026-12-10',
				'2026-12-01',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_date_range' });
	});

	it('a notification is readable only by its recipient', async () => {
		const mine = await t.asUser(employee.userId, () =>
			t.q<{ recipient_user_id: string }>(`select recipient_user_id from public.notifications`)
		);
		expect(mine.every((n) => n.recipient_user_id === employee.userId)).toBe(true);
	});
});

describe('pay rate history', () => {
	it('closes the previous rate instead of overwriting it', async () => {
		await t.asUser(org.ownerUserId, () =>
			t.rpc('public.set_pay_rate', [employee.membershipId, 200, '2026-01-01', 'KES'])
		);
		await t.asUser(org.ownerUserId, () =>
			t.rpc('public.set_pay_rate', [employee.membershipId, 250, '2026-06-01', 'KES'])
		);

		const rows = await t.q<{
			hourly_rate: string;
			effective_from: string;
			effective_until: string | null;
		}>(
			`select hourly_rate, effective_from::text, effective_until::text
			 from public.pay_rates where employee_membership_id = $1
			 order by effective_from`,
			[employee.membershipId]
		);

		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			hourly_rate: '200.00',
			effective_from: '2026-01-01',
			effective_until: '2026-05-31'
		});
		expect(rows[1]).toMatchObject({
			hourly_rate: '250.00',
			effective_from: '2026-06-01',
			effective_until: null
		});
	});
});
