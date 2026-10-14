import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;

beforeAll(async () => {
	t = await createTestDb();
});

afterAll(async () => {
	await t?.close();
});

describe('migrations', () => {
	it('apply cleanly and create the expected tables', async () => {
		const rows = await t.q<{ table_name: string }>(
			`select table_name from information_schema.tables
			 where table_schema = 'public' and table_type = 'BASE TABLE'
			 order by table_name`
		);
		const names = rows.map((r) => r.table_name);

		expect(names).toEqual(
			expect.arrayContaining([
				'attendance_adjustments',
				'attendance_events',
				'audit_logs',
				'break_records',
				'clocking_stations',
				'employee_notes',
				'idempotency_keys',
				'notification_deliveries',
				'notifications',
				'organization_memberships',
				'organization_settings',
				'organizations',
				'pay_rates',
				'payroll_entries',
				'payroll_periods',
				'profiles',
				'shifts',
				'organization_daily_tokens',
				'task_assignments',
				'tasks',
				'time_off_requests',
				'timesheets'
			])
		);
	});

	it('enables row level security on every public table', async () => {
		const rows = await t.q<{ relname: string }>(
			`select c.relname from pg_class c
			 join pg_namespace n on n.oid = c.relnamespace
			 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false`
		);
		expect(rows.map((r) => r.relname)).toEqual([]);
	});
});
