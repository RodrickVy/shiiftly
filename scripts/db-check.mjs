#!/usr/bin/env node
/**
 * Connectivity and schema check against the configured Supabase project.
 *
 *   node scripts/db-check.mjs
 *
 * Read-only. Reports whether the migrations have been applied, whether the
 * RPC functions are installed, and how much data exists. Never prints key
 * material.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
	let raw = '';
	try {
		raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
	} catch {
		console.error('No .env file found. Copy .env.example to .env first.');
		process.exit(1);
	}
	const env = {};
	for (const line of raw.split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
	return env;
}

const env = loadEnv();
const missing = [
	'PUBLIC_SUPABASE_URL',
	'PUBLIC_SUPABASE_ANON_KEY',
	'SUPABASE_SERVICE_ROLE_KEY',
	'QR_TOKEN_SECRET'
].filter((k) => !env[k] || env[k].startsWith('your-') || env[k].startsWith('change-me'));

if (missing.length) {
	console.error('Missing or placeholder values in .env:', missing.join(', '));
	process.exit(1);
}

const db = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
	auth: { persistSession: false, autoRefreshToken: false }
});

const TABLES = [
	'profiles',
	'organizations',
	'organization_memberships',
	'organization_settings',
	'invitations',
	'clocking_stations',
	'station_daily_tokens',
	'shifts',
	'attendance_events',
	'break_records',
	'timesheets',
	'attendance_adjustments',
	'tasks',
	'task_assignments',
	'time_off_requests',
	'pay_rates',
	'payroll_periods',
	'payroll_entries',
	'notifications',
	'notification_deliveries',
	'audit_logs',
	'idempotency_keys'
];

/**
 * Probed with their real argument names: PostgREST resolves overloads by
 * parameter name, so calling with `{}` reports "not found without
 * parameters" even for a function that exists.
 */
const FUNCTIONS = {
	clock_in_with_token: { p_token_hash: 'probe', p_idempotency_key: null },
	clock_out_with_token: { p_token_hash: 'probe', p_idempotency_key: null },
	clock_in_direct: { p_org: '00000000-0000-0000-0000-000000000000', p_idempotency_key: null },
	clock_out_direct: { p_org: '00000000-0000-0000-0000-000000000000', p_idempotency_key: null },
	start_break: { p_org: '00000000-0000-0000-0000-000000000000' },
	end_break: { p_org: '00000000-0000-0000-0000-000000000000' },
	create_organization: {
		p_name: 'probe',
		p_industry: null,
		p_country_code: 'KE',
		p_timezone: 'Africa/Nairobi',
		p_currency_code: 'KES'
	},
	accept_invitation: { p_token_hash: 'probe', p_full_name: 'probe', p_phone: null },
	submit_time_off_request: {
		p_org: '00000000-0000-0000-0000-000000000000',
		p_leave_type: 'Vacation',
		p_start: '2026-01-01',
		p_end: '2026-01-01',
		p_reason: null
	},
	review_time_off_request: {
		p_request: '00000000-0000-0000-0000-000000000000',
		p_status: 'approved',
		p_comment: null
	},
	set_member_role: { p_membership: '00000000-0000-0000-0000-000000000000', p_role: 'employee' },
	set_member_status: { p_membership: '00000000-0000-0000-0000-000000000000', p_status: 'active' },
	set_pay_rate: {
		p_membership: '00000000-0000-0000-0000-000000000000',
		p_hourly_rate: 1,
		p_effective_from: '2026-01-01',
		p_currency: 'KES'
	},
	set_task_assignees: { p_task: '00000000-0000-0000-0000-000000000000', p_memberships: [] },
	manager_update_task: {
		p_task: '00000000-0000-0000-0000-000000000000',
		p_title: 'probe',
		p_description: null,
		p_priority: 'low',
		p_due_at: null
	}
};

console.log(`Project: ${env.PUBLIC_SUPABASE_URL.replace(/\/\/([a-z0-9]{4})[a-z0-9]*/i, '//$1****')}\n`);

const missingTables = [];
for (const table of TABLES) {
	const { error } = await db.from(table).select('*').limit(0);
	if (error) missingTables.push(table);
}
console.log(`Tables     ${TABLES.length - missingTables.length}/${TABLES.length}`);
if (missingTables.length) console.log(`  missing: ${missingTables.join(', ')}`);

const fnNames = Object.keys(FUNCTIONS);
const missingFns = [];
for (const [fn, args] of Object.entries(FUNCTIONS)) {
	const { error } = await db.rpc(fn, args);
	// PGRST202 means the function is genuinely not in the schema cache.
	// Any other error (a guard rejecting the probe) proves it exists.
	if (error && error.code === 'PGRST202') missingFns.push(fn);
}
console.log(`Functions  ${fnNames.length - missingFns.length}/${fnNames.length}`);
if (missingFns.length) console.log(`  missing: ${missingFns.join(', ')}`);

if (missingTables.length === 0) {
	const counts = {};
	for (const table of ['organizations', 'organization_memberships', 'shifts', 'invitations']) {
		const { count } = await db.from(table).select('*', { head: true, count: 'exact' });
		counts[table] = count ?? 0;
	}
	console.log(
		`\nData       ${counts.organizations} orgs, ${counts.organization_memberships} members, ` +
			`${counts.shifts} shifts, ${counts.invitations} invitations`
	);
}

const { data: users, error: authError } = await db.auth.admin.listUsers({ page: 1, perPage: 100 });
if (authError) {
	console.log(`\nAuth       ERROR: ${authError.message}`);
} else {
	const confirmed = users.users.filter((u) => u.email_confirmed_at).length;
	console.log(`Auth       ${users.users.length} user(s), ${confirmed} with a confirmed email`);
}

const ready = missingTables.length === 0 && missingFns.length === 0;
console.log(`\n${ready ? 'Schema is applied and ready.' : 'Schema is NOT fully applied. See README step 4.'}`);
process.exit(ready ? 0 : 2);
