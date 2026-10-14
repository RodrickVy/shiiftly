#!/usr/bin/env node
/**
 * Concatenates the migrations in order so they can be applied without the
 * Supabase CLI -- paste the output into the SQL editor in the Supabase
 * dashboard, or pipe it into psql.
 *
 *   node scripts/db-apply.mjs > schema.sql
 *   node scripts/db-apply.mjs | psql "$DATABASE_URL"
 *
 * The files are plain SQL and idempotent only in the sense that they are
 * meant to run once, in order, against a fresh database.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../supabase/migrations', import.meta.url));
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

const parts = [
	'-- Shiftly schema',
	`-- Generated ${new Date().toISOString()} from supabase/migrations`,
	'-- Apply against a fresh Supabase project (the auth schema must exist).',
	''
];

for (const file of files) {
	parts.push(`-- ${'='.repeat(70)}`);
	parts.push(`-- ${file}`);
	parts.push(`-- ${'='.repeat(70)}`);
	parts.push(await readFile(join(dir, file), 'utf8'));
	parts.push('');
}

// Piping into `head` closes stdout early; that is not an error worth a
// stack trace.
process.stdout.on('error', (err) => {
	if (err.code === 'EPIPE') process.exit(0);
	throw err;
});

process.stdout.write(parts.join('\n'));
