import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { addMember, createOrg, createStation, type Member, type Org } from './fixtures';

/**
 * Employee notes are an internal record kept *about* a person. The whole
 * point is that a manager can write one candidly, so the access rules are
 * the feature -- these tests are what make the UI's promise ("only managers
 * can see these") true rather than decorative.
 */

let t: TestDb;
let org: Org;
let manager: Member;
let employee: Member;
let other: Member;

beforeAll(async () => {
	t = await createTestDb();
	org = await createOrg(t, { name: 'Notes Co' });
	manager = await addMember(t, org, { fullName: 'Mary Manager', role: 'manager' });
	employee = await addMember(t, org, { fullName: 'Eli Employee' });
	other = await addMember(t, org, { fullName: 'Olive Other' });
});

afterAll(async () => {
	await t?.close();
});

async function addNote(asUserId: string, aboutMembershipId: string, body: string) {
	return t.asUser(asUserId, () =>
		t.q(
			`insert into public.employee_notes
			   (organization_id, employee_membership_id, author_user_id, body)
			 values ($1, $2, $3, $4)`,
			[org.orgId, aboutMembershipId, asUserId, body]
		)
	);
}

describe('employee notes', () => {
	it('a manager can write and read a note about someone', async () => {
		await addNote(manager.userId, employee.membershipId, 'Trained on the till.');

		const rows = await t.asUser(manager.userId, () =>
			t.q<{ body: string }>(
				`select body from public.employee_notes where employee_membership_id = $1`,
				[employee.membershipId]
			)
		);
		expect(rows.map((r) => r.body)).toContain('Trained on the till.');
	});

	it('the owner can read notes written by a manager', async () => {
		const rows = await t.asUser(org.ownerUserId, () =>
			t.q(`select id from public.employee_notes where employee_membership_id = $1`, [
				employee.membershipId
			])
		);
		expect(rows.length).toBeGreaterThan(0);
	});

	/** The promise the UI makes to the manager writing the note. */
	it('the person a note is about cannot read it', async () => {
		const rows = await t.asUser(employee.userId, () =>
			t.q(`select id, body from public.employee_notes`)
		);
		expect(rows).toEqual([]);
	});

	it('a colleague cannot read notes either', async () => {
		const rows = await t.asUser(other.userId, () => t.q(`select id from public.employee_notes`));
		expect(rows).toEqual([]);
	});

	it('an employee cannot write a note about anyone', async () => {
		await t.asUser(employee.userId, async () => {
			await expect(
				t.q(
					`insert into public.employee_notes
					   (organization_id, employee_membership_id, author_user_id, body)
					 values ($1, $2, $3, 'I am great')`,
					[org.orgId, employee.membershipId, employee.userId]
				)
			).rejects.toThrow(/row-level security|violates/i);
		});
	});

	it('an employee cannot delete a note about themselves', async () => {
		const before = await t.asUser(manager.userId, () =>
			t.q(`select count(*)::int c from public.employee_notes`)
		);

		await t.asUser(employee.userId, () => t.q(`delete from public.employee_notes`));

		const after = await t.asUser(manager.userId, () =>
			t.q<{ c: number }>(`select count(*)::int c from public.employee_notes`)
		);
		expect(after[0].c).toBe((before[0] as { c: number }).c);
	});

	it('a manager of another organization cannot read them', async () => {
		const otherOrg = await createOrg(t, { name: 'Elsewhere Ltd' });

		const rows = await t.asUser(otherOrg.ownerUserId, () =>
			t.q(`select id from public.employee_notes`)
		);
		expect(rows).toEqual([]);
	});

	it('a station device cannot read them', async () => {
		const station = await createStation(t, org, { name: 'Lobby' });
		const rows = await t.asUser(station.userId, () =>
			t.q(`select id from public.employee_notes`)
		);
		expect(rows).toEqual([]);
	});

	it('rejects an empty note at the database level', async () => {
		await t.asUser(manager.userId, async () => {
			await expect(
				t.q(
					`insert into public.employee_notes
					   (organization_id, employee_membership_id, author_user_id, body)
					 values ($1, $2, $3, '   ')`,
					[org.orgId, employee.membershipId, manager.userId]
				)
			).rejects.toThrow(/check constraint|violates/i);
		});
	});

	it('keeps the note when its author is removed from auth', async () => {
		// A note is a record about the organization, not about its author.
		const [note] = await t.asUser(manager.userId, () =>
			t.q<{ id: string }>(
				`select id from public.employee_notes where employee_membership_id = $1 limit 1`,
				[employee.membershipId]
			)
		);

		await t.asService(() => t.q(`delete from auth.users where id = $1`, [manager.userId]));

		const [still] = await t.asUser(org.ownerUserId, () =>
			t.q<{ author_user_id: string | null }>(
				`select author_user_id from public.employee_notes where id = $1`,
				[note.id]
			)
		);
		expect(still).toBeDefined();
		expect(still.author_user_id).toBeNull();
	});
});
