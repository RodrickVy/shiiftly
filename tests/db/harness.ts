/**
 * Boots an in-process Postgres (PGlite) and applies the real migrations from
 * supabase/migrations, unmodified.
 *
 * Supabase provides the `auth` schema in production; here we stand up the
 * small part of it the schema depends on -- `auth.users` and `auth.uid()` --
 * with the same semantics Supabase gives them, so the policies and functions
 * under test are the ones that ship.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));

/**
 * Mirrors the pieces of Supabase's auth schema that our migrations reference.
 * auth.uid() resolves the current request's subject exactly as Supabase's
 * does, so `set_config('request.jwt.claim.sub', ...)` impersonates a user.
 */
const AUTH_SHIM = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;

  -- Supabase's three API roles.
  do $do$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin noinherit;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin noinherit bypassrls;
    end if;
  end
  $do$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant select on auth.users to authenticated, service_role;
`;

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createTestDb() {
	const db = new PGlite();
	await db.exec(AUTH_SHIM);

	const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

	for (const file of files) {
		const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
		try {
			await db.exec(sql);
		} catch (error) {
			throw new Error(`migration ${file} failed: ${(error as Error).message}`);
		}
	}

	/** Creates an auth user and returns its id. */
	async function createUser(email: string): Promise<string> {
		const res = await db.query<{ id: string }>(
			'insert into auth.users (email) values ($1) returning id',
			[email]
		);
		return res.rows[0].id;
	}

	/**
	 * Runs `fn` as the given user through the `authenticated` role, so RLS and
	 * column grants apply exactly as they would for a browser session.
	 */
	async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
		await db.exec(`set role authenticated;`);
		await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
		try {
			return await fn();
		} finally {
			await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
		}
	}

	/** Runs `fn` with RLS bypassed, standing in for the service-role client. */
	async function asService<T>(fn: () => Promise<T>): Promise<T> {
		await db.exec(`reset role;`);
		return fn();
	}

	/** Convenience: a typed query helper. */
	async function q<T extends Record<string, unknown> = Record<string, unknown>>(
		sql: string,
		params: unknown[] = []
	) {
		const res = await db.query<T>(sql, params);
		return res.rows;
	}

	/** Calls a jsonb-returning RPC and returns the parsed result. */
	async function rpc<T = Record<string, unknown>>(
		fn: string,
		params: unknown[] = []
	): Promise<T> {
		const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
		const rows = await q<{ result: T }>(
			`select ${fn}(${placeholders}) as result`,
			params
		);
		return rows[0].result;
	}

	return { db, createUser, asUser, asService, q, rpc, close: () => db.close() };
}
