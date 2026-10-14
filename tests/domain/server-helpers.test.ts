import { beforeEach, describe, expect, it } from 'vitest';
import { toCsv } from '../../src/lib/server/csv';
import { limiterKey, rateLimit, resetRateLimits } from '../../src/lib/server/rate-limit';
import { clockErrorMessage } from '../../src/lib/server/attendance';
import {
	createInvitationSchema,
	parseForm,
	signUpSchema,
	timeOffRequestSchema,
	phoneSchema,
	payRateSchema
} from '../../src/lib/schemas';

describe('CSV export', () => {
	it('quotes fields and escapes embedded quotes', () => {
		const csv = toCsv(['Name', 'Note'], [['Amina', 'said "hello"']]);
		expect(csv).toContain('"Name","Note"');
		expect(csv).toContain('"Amina","said ""hello"""');
	});

	it('keeps a comma inside a field from splitting it', () => {
		const csv = toCsv(['Name'], [['Yusuf, Amina']]);
		expect(csv).toContain('"Yusuf, Amina"');
	});

	/**
	 * A spreadsheet treats a leading = as a formula. A name is data, and must
	 * never execute when a manager opens the export.
	 */
	it('neutralises formula injection', () => {
		const csv = toCsv(
			['Name'],
			[['=cmd|calc'], ['+1234'], ['-1+1'], ['@SUM(A1)']]
		);
		expect(csv).toContain(`"'=cmd|calc"`);
		expect(csv).toContain(`"'+1234"`);
		expect(csv).toContain(`"'-1+1"`);
		expect(csv).toContain(`"'@SUM(A1)"`);
	});

	it('starts with a BOM so Excel reads UTF-8 names correctly', () => {
		expect(toCsv(['Name'], [['Zoë']]).startsWith('﻿')).toBe(true);
	});

	it('renders null and undefined as empty fields', () => {
		const csv = toCsv(['A', 'B'], [[null, undefined]]);
		expect(csv).toContain('"",""');
	});
});

describe('rate limiting', () => {
	beforeEach(() => resetRateLimits());

	it('allows up to the limit then refuses', () => {
		for (let i = 0; i < 5; i++) {
			expect(rateLimit('k', 5, 60).allowed).toBe(true);
		}
		const blocked = rateLimit('k', 5, 60);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
	});

	it('counts each key separately', () => {
		for (let i = 0; i < 5; i++) rateLimit('a', 5, 60);
		expect(rateLimit('a', 5, 60).allowed).toBe(false);
		expect(rateLimit('b', 5, 60).allowed).toBe(true);
	});

	it('reports the remaining allowance', () => {
		expect(rateLimit('r', 3, 60).remaining).toBe(2);
		expect(rateLimit('r', 3, 60).remaining).toBe(1);
		expect(rateLimit('r', 3, 60).remaining).toBe(0);
	});

	it('builds distinct keys per scope and identity', () => {
		expect(limiterKey('login', { userId: 'u1' })).not.toBe(limiterKey('login', { userId: 'u2' }));
		expect(limiterKey('login', { userId: 'u1' })).not.toBe(limiterKey('clock', { userId: 'u1' }));
		expect(limiterKey('login', { ip: '1.2.3.4' })).toContain('1.2.3.4');
		// Falls back to the address when there is no user.
		expect(limiterKey('x', { userId: null, ip: '9.9.9.9' })).toBe('x:9.9.9.9');
	});
});

describe('clock error messages', () => {
	it('explains every failure code the database can return', () => {
		const codes = [
			'already_clocked_in',
			'no_active_shift',
			'break_in_progress',
			'break_already_active',
			'no_active_break',
			'manual_breaks_disabled',
			'invalid_or_expired_token',
			'qr_clocking_disabled',
			'direct_clocking_disabled',
			'not_a_member',
			'not_authenticated'
		];
		for (const code of codes) {
			const message = clockErrorMessage(code);
			expect(message.length).toBeGreaterThan(10);
			// Never surface the raw code to the user.
			expect(message).not.toContain(code);
		}
	});

	it('falls back to something usable for an unknown code', () => {
		expect(clockErrorMessage('something_new')).toMatch(/try again/i);
	});
});

/** FormData in, typed value or field errors out. */
function formOf(entries: Record<string, string | string[]>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(entries)) {
		if (Array.isArray(value)) for (const v of value) fd.append(`${key}[]`, v);
		else fd.append(key, value);
	}
	return fd;
}

describe('form parsing', () => {
	it('accepts a valid sign-up', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'Amina Yusuf',
				email: 'Amina@Example.COM',
				phoneDial: '+254',
				phoneNumber: '0712345678',
				password: 'correct-horse-battery',
				confirmPassword: 'correct-horse-battery'
			})
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.email).toBe('amina@example.com');
	});

	it('rejects mismatched passwords against the confirm field', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'Amina Yusuf',
				email: 'a@b.test',
				phoneDial: '+254',
				phoneNumber: '0712345678',
				password: 'correct-horse-battery',
				confirmPassword: 'something-else-here'
			})
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.confirmPassword?.[0]).toMatch(/do not match/i);
	});

	/** A rejected form is re-rendered; a password must never come back with it. */
	it('never echoes a password back to the page', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'A',
				email: 'nope',
				phoneDial: '+254',
				phoneNumber: '0712345678',
				password: 'secret-password-value',
				confirmPassword: 'secret-password-value'
			})
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(JSON.stringify(result.values)).not.toContain('secret-password-value');
			expect(result.values.email).toBe('nope');
		}
	});

	it('collects array fields from repeated inputs', () => {
		const fd = formOf({ leaveType: 'Vacation', startDate: '2026-05-01', endDate: '2026-05-03' });
		const result = parseForm(timeOffRequestSchema, fd);
		expect(result.ok).toBe(true);
	});

	it('rejects an end date before the start date', () => {
		const result = parseForm(
			timeOffRequestSchema,
			formOf({ leaveType: 'Vacation', startDate: '2026-05-10', endDate: '2026-05-01' })
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.endDate?.[0]).toMatch(/cannot be before/i);
	});

	it('requires a personal invitation to be single-use', () => {
		const shared = parseForm(
			createInvitationSchema,
			formOf({ role: 'employee', email: '', maxUses: '25', expiresInDays: '7' })
		);
		expect(shared.ok).toBe(true);

		const personal = parseForm(
			createInvitationSchema,
			formOf({ role: 'employee', email: 'a@b.test', maxUses: '25', expiresInDays: '7' })
		);
		expect(personal.ok).toBe(false);
		if (!personal.ok) expect(personal.errors.maxUses?.[0]).toMatch(/one person/i);
	});

	it('validates phone numbers as E.164', () => {
		expect(phoneSchema.safeParse('+254712345678').success).toBe(true);
		expect(phoneSchema.safeParse('+447911123456').success).toBe(true);
		expect(phoneSchema.safeParse('0712345678').success).toBe(false);
		expect(phoneSchema.safeParse('+0712345678').success).toBe(false);
		expect(phoneSchema.safeParse('not a phone').success).toBe(false);
	});

	it('accepts money with up to two decimals and rejects anything else', () => {
		const good = parseForm(payRateSchema, formOf({ hourlyRate: '250.50', effectiveFrom: '2026-01-01' }));
		expect(good.ok).toBe(true);

		const bad = parseForm(payRateSchema, formOf({ hourlyRate: '250.555', effectiveFrom: '2026-01-01' }));
		expect(bad.ok).toBe(false);

		const negative = parseForm(payRateSchema, formOf({ hourlyRate: '-5', effectiveFrom: '2026-01-01' }));
		expect(negative.ok).toBe(false);
	});
});
