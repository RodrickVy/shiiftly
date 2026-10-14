import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { addEmployee, createOrg, randomToken, sha256 } from './fixtures';

let t: TestDb;
let org: Awaited<ReturnType<typeof createOrg>>;
let manager: Awaited<ReturnType<typeof addEmployee>>;
let employee: Awaited<ReturnType<typeof addEmployee>>;

beforeAll(async () => {
	t = await createTestDb();
	org = await createOrg(t, { email: 'owner@w.test', name: 'Workflow Co' });
	manager = await addEmployee(t, org, {
		email: 'mgr@w.test',
		fullName: 'Mary Manager',
		role: 'manager'
	});
	employee = await addEmployee(t, org, { email: 'emp@w.test', fullName: 'Eli Employee' });
});

afterAll(async () => {
	await t?.close();
});

/** Creates an invitation and returns the raw token the link would carry. */
async function invite(opts: {
	role?: 'employee' | 'manager';
	expiresIn?: string;
	maxUses?: number;
	email?: string | null;
	revoked?: boolean;
}) {
	const raw = randomToken();
	const [row] = await t.asUser(org.ownerUserId, () =>
		t.q<{ id: string }>(
			`insert into public.invitations
			   (organization_id, token_hash, invited_email, role, max_uses, expires_at, created_by, revoked_at)
			 values ($1, $2, $3, $4, $5, now() + $6::interval, $7, $8)
			 returning id`,
			[
				org.orgId,
				sha256(raw),
				opts.email ?? null,
				opts.role ?? 'employee',
				opts.maxUses ?? 1,
				opts.expiresIn ?? '7 days',
				org.ownerUserId,
				opts.revoked ? new Date().toISOString() : null
			]
		)
	);
	return { raw, id: row.id };
}

describe('invitations', () => {
	it('a valid invitation creates an active membership with the invited role', async () => {
		const { raw } = await invite({ role: 'employee' });
		const userId = await t.createUser(`join-${randomToken().slice(0, 6)}@w.test`);

		const res = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; organization_id: string; role: string }>('public.accept_invitation', [
				sha256(raw),
				'New Joiner',
				'+254712345678'
			])
		);

		expect(res.ok).toBe(true);
		expect(res.organization_id).toBe(org.orgId);
		expect(res.role).toBe('employee');

		const [m] = await t.q<{ role: string; status: string }>(
			`select role, status from public.organization_memberships
			 where organization_id = $1 and user_id = $2`,
			[org.orgId, userId]
		);
		expect(m).toMatchObject({ role: 'employee', status: 'active' });

		const [p] = await t.q<{ full_name: string; phone: string }>(
			`select full_name, phone from public.profiles where id = $1`,
			[userId]
		);
		expect(p).toMatchObject({ full_name: 'New Joiner', phone: '+254712345678' });
	});

	it('rejects an expired invitation', async () => {
		const { raw } = await invite({ expiresIn: '-1 hour' });
		const userId = await t.createUser(`exp-${randomToken().slice(0, 6)}@w.test`);

		const res = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.accept_invitation', [sha256(raw), 'Too Late', null])
		);
		expect(res).toMatchObject({ ok: false, code: 'invitation_expired' });

		const rows = await t.q(
			`select 1 from public.organization_memberships where user_id = $1`, [userId]
		);
		expect(rows).toEqual([]);
	});

	it('rejects a revoked invitation', async () => {
		const { raw } = await invite({ revoked: true });
		const userId = await t.createUser(`rev-${randomToken().slice(0, 6)}@w.test`);
		const res = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.accept_invitation', [sha256(raw), 'Revoked', null])
		);
		expect(res).toMatchObject({ ok: false, code: 'invitation_revoked' });
	});

	it('rejects an unknown token', async () => {
		const userId = await t.createUser(`unk-${randomToken().slice(0, 6)}@w.test`);
		const res = await t.asUser(userId, () =>
			t.rpc<{ ok: boolean; code: string }>('public.accept_invitation', [
				sha256(randomToken()),
				'Nobody',
				null
			])
		);
		expect(res).toMatchObject({ ok: false, code: 'invalid_invitation' });
	});

	it('enforces the usage limit', async () => {
		const { raw } = await invite({ maxUses: 1 });

		const first = await t.createUser(`u1-${randomToken().slice(0, 6)}@w.test`);
		const ok = await t.asUser(first, () =>
			t.rpc<{ ok: boolean }>('public.accept_invitation', [sha256(raw), 'First', null])
		);
		expect(ok.ok).toBe(true);

		const second = await t.createUser(`u2-${randomToken().slice(0, 6)}@w.test`);
		const exhausted = await t.asUser(second, () =>
			t.rpc<{ ok: boolean; code: string }>('public.accept_invitation', [sha256(raw), 'Second', null])
		);
		expect(exhausted).toMatchObject({ ok: false, code: 'invitation_exhausted' });
	});

	it('allows several joiners on a reusable link', async () => {
		const { raw } = await invite({ maxUses: 3 });
		for (let i = 0; i < 3; i++) {
			const u = await t.createUser(`multi-${i}-${randomToken().slice(0, 6)}@w.test`);
			const res = await t.asUser(u, () =>
				t.rpc<{ ok: boolean }>('public.accept_invitation', [sha256(raw), `Joiner ${i}`, null])
			);
			expect(res.ok).toBe(true);
		}
	});

	it('binds an email-specific invitation to that address', async () => {
		const { raw } = await invite({ email: 'intended@w.test' });

		const wrong = await t.createUser('someone-else@w.test');
		const rejected = await t.asUser(wrong, () =>
			t.rpc<{ ok: boolean; code: string }>('public.accept_invitation', [
				sha256(raw),
				'Wrong Person',
				null
			])
		);
		expect(rejected).toMatchObject({ ok: false, code: 'invitation_email_mismatch' });

		const right = await t.createUser('intended@w.test');
		const accepted = await t.asUser(right, () =>
			t.rpc<{ ok: boolean }>('public.accept_invitation', [sha256(raw), 'Right Person', null])
		);
		expect(accepted.ok).toBe(true);
	});

	it('an invitee cannot award themselves a manager role', async () => {
		const { raw } = await invite({ role: 'employee' });
		const userId = await t.createUser(`sneaky-${randomToken().slice(0, 6)}@w.test`);

		await t.asUser(userId, () =>
			t.rpc('public.accept_invitation', [sha256(raw), 'Sneaky', null])
		);

		// Try to escalate straight after joining.
		await t.asUser(userId, () =>
			t.q(`update public.organization_memberships set role = 'manager' where user_id = $1`, [userId])
		);

		const [m] = await t.q<{ role: string }>(
			`select role from public.organization_memberships where user_id = $1`,
			[userId]
		);
		expect(m.role).toBe('employee');
	});

	it('an employee cannot read or mint invitations', async () => {
		const visible = await t.asUser(employee.userId, () =>
			t.q(`select id from public.invitations`)
		);
		expect(visible).toEqual([]);

		await t.asUser(employee.userId, async () => {
			await expect(
				t.q(
					`insert into public.invitations
					   (organization_id, token_hash, role, max_uses, expires_at, created_by)
					 values ($1, $2, 'manager', 1, now() + interval '1 day', $3)`,
					[org.orgId, sha256(randomToken()), employee.userId]
				)
			).rejects.toThrow(/row-level security|violates/i);
		});
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
		const other = await addEmployee(t, org, {
			email: `other-${randomToken().slice(0, 6)}@w.test`,
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
			email: `oo-${randomToken().slice(0, 6)}@w.test`,
			name: 'Elsewhere Ltd'
		});
		const outsider = await addEmployee(t, otherOrg, {
			email: `oi-${randomToken().slice(0, 6)}@w.test`,
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
			`select count(*)::int as c from public.notifications where organization_id = $1`,
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
