/**
 * The migrations are normally applied one file at a time (Supabase CLI), but
 * `scripts/db-apply.mjs` concatenates them into a single script to paste into
 * the SQL editor. That path has to work too: a dependency ordering mistake
 * would only show up when someone pastes the file into a live project.
 */
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

const SUPABASE_PRELUDE = `
	create schema if not exists auth;
	create table auth.users (
		id uuid primary key default gen_random_uuid(),
		email text unique,
		raw_user_meta_data jsonb not null default '{}'::jsonb,
		created_at timestamptz default now()
	);
	create or replace function auth.uid() returns uuid language sql stable as $fn$
		select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
	$fn$;
	do $do$ begin
		if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
		if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
		if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
	end $do$;
	grant usage on schema auth to anon, authenticated, service_role;
`;

describe('concatenated schema', () => {
	it('applies as a single script, in order', async () => {
		const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
		const combined = (
			await Promise.all(files.map((f) => readFile(join(MIGRATIONS, f), 'utf8')))
		).join('\n');

		const db = new PGlite();
		await db.exec(SUPABASE_PRELUDE);
		await db.exec(combined);

		const tables = await db.query<{ c: number }>(
			`select count(*)::int c from information_schema.tables
			 where table_schema = 'public' and table_type = 'BASE TABLE'`
		);
		expect(tables.rows[0].c).toBe(22);

		// Every table must end up with RLS on, however the script was run.
		const unprotected = await db.query<{ relname: string }>(
			`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
			 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false`
		);
		expect(unprotected.rows.map((r) => r.relname)).toEqual([]);

		// The callable surface the application depends on.
		const required = [
			'clock_in_with_token',
			'clock_out_with_token',
			'clock_in_direct',
			'clock_out_direct',
			'start_break',
			'end_break',
			'create_organization',
			'request_to_join',
			'review_join_request',
			'claim_station',
			'submit_time_off_request',
			'review_time_off_request',
			'set_member_role',
			'set_member_status',
			'set_pay_rate',
			'set_task_assignees',
			'manager_update_task'
		];
		const fns = await db.query<{ proname: string }>(
			`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'public'`
		);
		const names = fns.rows.map((r) => r.proname);
		for (const fn of required) expect(names).toContain(fn);

		await db.close();
	});
});
