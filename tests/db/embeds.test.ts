import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

/**
 * PostgREST builds its embedding graph from foreign keys. A missing one does
 * not fail loudly at write time -- it fails at *read* time, with
 * "Could not find a relationship", which errors the whole query and leaves
 * the page rendering an empty list as though there were simply no data.
 *
 * That is exactly how the employees screen shipped broken: the rows existed,
 * the policies allowed them, and the page said "No one is waiting".
 *
 * The rest of the database suite runs raw SQL, so it cannot see this class
 * of bug at all. These tests assert the foreign keys that every
 * `select('*, other(...)')` in the application depends on.
 *
 * Adding an embed to a query means adding its relationship here.
 */

let t: TestDb;

beforeAll(async () => {
	t = await createTestDb();
});

afterAll(async () => {
	await t?.close();
});

/** Relationships the application embeds, as (table, column) -> table. */
const REQUIRED_EMBEDS: Array<{
	from: string;
	column: string;
	to: string;
	usedBy: string;
}> = [
	{
		from: 'organization_memberships',
		column: 'user_id',
		to: 'profiles',
		usedBy: 'employees list, employee detail, dashboard, tasks, attendance filter'
	},
	{
		from: 'employee_notes',
		column: 'author_user_id',
		to: 'profiles',
		usedBy: 'employee detail notes'
	},
	{
		from: 'shifts',
		column: 'employee_membership_id',
		to: 'organization_memberships',
		usedBy: 'attendance report, timesheets, payroll'
	},
	{
		from: 'time_off_requests',
		column: 'employee_membership_id',
		to: 'organization_memberships',
		usedBy: 'time-off review queue'
	},
	{
		from: 'timesheets',
		column: 'employee_membership_id',
		to: 'organization_memberships',
		usedBy: 'timesheet review'
	},
	{
		from: 'task_assignments',
		column: 'task_id',
		to: 'tasks',
		usedBy: 'my tasks, manager tasks'
	},
	{
		from: 'task_assignments',
		column: 'employee_membership_id',
		to: 'organization_memberships',
		usedBy: 'task assignee lists'
	},
	{
		from: 'break_records',
		column: 'shift_id',
		to: 'shifts',
		usedBy: 'active shift, dashboard break state'
	},
	{
		from: 'notification_deliveries',
		column: 'notification_id',
		to: 'notifications',
		usedBy: 'email flush'
	},
	{
		from: 'organization_daily_tokens',
		column: 'organization_id',
		to: 'organizations',
		usedBy: 'scanned code lookup'
	},
	{
		from: 'clocking_stations',
		column: 'organization_id',
		to: 'organizations',
		usedBy: 'station setup preview'
	},
	{
		from: 'clocking_stations',
		column: 'membership_id',
		to: 'organization_memberships',
		usedBy: 'station display, unlink'
	}
];

async function foreignKeyTargets(table: string, column: string): Promise<string[]> {
	const rows = await t.q<{ target: string }>(
		`select cl2.relname as target
		 from pg_constraint c
		 join pg_class cl on cl.oid = c.conrelid
		 join pg_class cl2 on cl2.oid = c.confrelid
		 join pg_namespace n on n.oid = cl.relnamespace
		 where c.contype = 'f'
		   and n.nspname = 'public'
		   and cl.relname = $1
		   and (
		     select attname from pg_attribute
		     where attrelid = c.conrelid and attnum = c.conkey[1]
		   ) = $2`,
		[table, column]
	);
	return rows.map((r) => r.target);
}

describe('PostgREST embedding relationships', () => {
	for (const rel of REQUIRED_EMBEDS) {
		it(`${rel.from}.${rel.column} -> ${rel.to} (${rel.usedBy})`, async () => {
			const targets = await foreignKeyTargets(rel.from, rel.column);
			expect(targets).toContain(rel.to);
		});
	}

	/**
	 * Two foreign keys on one column make the embed ambiguous, and PostgREST
	 * refuses it rather than guessing. That fails exactly as loudly as having
	 * none, so it is worth asserting too.
	 */
	it('no embedded column carries more than one foreign key', async () => {
		for (const rel of REQUIRED_EMBEDS) {
			const targets = await foreignKeyTargets(rel.from, rel.column);
			expect(
				targets.length,
				`${rel.from}.${rel.column} has ${targets.length} foreign keys (${targets.join(', ')})`
			).toBe(1);
		}
	});

	/** A membership must resolve to a person with a name to display. */
	it('a membership cannot exist without a profile', async () => {
		const userId = (
			await t.q<{ id: string }>(
				`insert into auth.users (email) values ('orphan@example.com') returning id`
			)
		)[0].id;

		const org = (
			await t.q<{ id: string }>(
				`insert into public.organizations (name, country_code, timezone, currency_code, created_by)
				 values ('Orphan Co', 'KE', 'Africa/Nairobi', 'KES', $1) returning id`,
				[userId]
			)
		)[0].id;

		await expect(
			t.q(
				`insert into public.organization_memberships (organization_id, user_id, role, status)
				 values ($1, $2, 'employee', 'active')`,
				[org, userId]
			)
		).rejects.toThrow(/foreign key|violates/i);
	});
});
