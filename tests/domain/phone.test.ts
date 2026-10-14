import { describe, expect, it } from 'vitest';
import {
	formatPhone,
	isE164,
	normalizePhone,
	phoneErrorMessage,
	splitE164
} from '../../src/lib/domain/phone';
import { parseForm, signUpSchema, acceptInvitationSchema } from '../../src/lib/schemas';

describe('normalizePhone', () => {
	it('drops the domestic trunk zero', () => {
		// How a Kenyan user actually types their number.
		expect(normalizePhone('+254', '0712345678')).toEqual({ ok: true, e164: '+254712345678' });
		expect(normalizePhone('+44', '07911123456')).toEqual({ ok: true, e164: '+447911123456' });
		expect(normalizePhone('+234', '08031234567')).toEqual({ ok: true, e164: '+2348031234567' });
	});

	it('accepts a number without a trunk zero', () => {
		expect(normalizePhone('+254', '712345678')).toEqual({ ok: true, e164: '+254712345678' });
	});

	it('ignores spaces, dashes and brackets', () => {
		expect(normalizePhone('+254', '0712 345 678')).toEqual({ ok: true, e164: '+254712345678' });
		expect(normalizePhone('+254', '0712-345-678')).toEqual({ ok: true, e164: '+254712345678' });
		expect(normalizePhone('+1', '(415) 555-0123')).toEqual({ ok: true, e164: '+14155550123' });
	});

	/** A pasted international number must win over the dropdown. */
	it('respects a full international number regardless of the selected code', () => {
		expect(normalizePhone('+1', '+254712345678')).toEqual({ ok: true, e164: '+254712345678' });
		expect(normalizePhone('+1', '+254 712 345 678')).toEqual({ ok: true, e164: '+254712345678' });
	});

	it('converts a 00 international prefix', () => {
		expect(normalizePhone('+1', '00254712345678')).toEqual({ ok: true, e164: '+254712345678' });
	});

	it('rejects empty input', () => {
		expect(normalizePhone('+254', '')).toEqual({ ok: false, reason: 'empty' });
		expect(normalizePhone('+254', '   ')).toEqual({ ok: false, reason: 'empty' });
	});

	it('rejects a number that is only zeros', () => {
		expect(normalizePhone('+254', '000')).toEqual({ ok: false, reason: 'too_short' });
	});

	it('rejects too short and too long', () => {
		expect(normalizePhone('+254', '12')).toEqual({ ok: false, reason: 'too_short' });
		expect(normalizePhone('+254', '1234567890123456')).toEqual({ ok: false, reason: 'too_long' });
	});

	it('rejects a missing or malformed dial code', () => {
		expect(normalizePhone('', '712345678')).toEqual({ ok: false, reason: 'invalid_dial' });
		expect(normalizePhone('254', '712345678')).toEqual({ ok: false, reason: 'invalid_dial' });
	});

	it('always produces a value the database CHECK constraint accepts', () => {
		const inputs = [
			['+254', '0712345678'],
			['+44', '07911 123456'],
			['+234', '803 123 4567'],
			['+27', '082 123 4567'],
			['+1', '4155550123']
		] as const;
		for (const [dial, national] of inputs) {
			const result = normalizePhone(dial, national);
			expect(result.ok).toBe(true);
			if (result.ok) expect(isE164(result.e164)).toBe(true);
		}
	});

	it('gives an actionable message for each failure', () => {
		for (const reason of ['empty', 'invalid_dial', 'too_short', 'too_long', 'invalid'] as const) {
			expect(phoneErrorMessage(reason).length).toBeGreaterThan(8);
		}
	});
});

describe('splitE164', () => {
	it('round-trips a normalised number', () => {
		expect(splitE164('+254712345678')).toEqual({ dial: '+254', national: '712345678' });
		expect(splitE164('+447911123456')).toEqual({ dial: '+44', national: '7911123456' });
	});

	/** +1 must not shadow +254 when matching. */
	it('prefers the longest matching dial code', () => {
		expect(splitE164('+254712345678').dial).toBe('+254');
	});

	it('falls back safely for null or malformed input', () => {
		expect(splitE164(null)).toEqual({ dial: '+254', national: '' });
		expect(splitE164('nonsense')).toEqual({ dial: '+254', national: '' });
	});
});

describe('formatPhone', () => {
	it('groups digits for display', () => {
		expect(formatPhone('+254712345678')).toBe('+254 712 345 678');
	});
	it('handles empty input', () => {
		expect(formatPhone(null)).toBe('');
	});
});

/** FormData helper. */
function formOf(entries: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(entries)) fd.append(k, v);
	return fd;
}

describe('signup with phone', () => {
	it('normalises a locally-typed number', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'Amina Yusuf',
				email: 'amina@example.test',
				phoneDial: '+254',
				phoneNumber: '0712 345 678',
				password: 'correct-horse-battery',
				confirmPassword: 'correct-horse-battery'
			})
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.phone).toBe('+254712345678');
	});

	it('reports a bad number against the phone field', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'Amina Yusuf',
				email: 'amina@example.test',
				phoneDial: '+254',
				phoneNumber: '12',
				password: 'correct-horse-battery',
				confirmPassword: 'correct-horse-battery'
			})
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.phoneNumber?.[0]).toMatch(/too short/i);
	});

	it('requires a phone number', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'Amina Yusuf',
				email: 'amina@example.test',
				phoneDial: '+254',
				phoneNumber: '',
				password: 'correct-horse-battery',
				confirmPassword: 'correct-horse-battery'
			})
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.phoneNumber?.[0]).toMatch(/enter a phone number/i);
	});

	it('still catches a password mismatch alongside a valid phone', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'Amina Yusuf',
				email: 'amina@example.test',
				phoneDial: '+254',
				phoneNumber: '0712345678',
				password: 'correct-horse-battery',
				confirmPassword: 'different-passphrase'
			})
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.confirmPassword?.[0]).toMatch(/do not match/i);
	});

	it('does not echo the password back on failure', () => {
		const result = parseForm(
			signUpSchema,
			formOf({
				fullName: 'A',
				email: 'bad',
				phoneDial: '+254',
				phoneNumber: '0712345678',
				password: 'secret-password-value',
				confirmPassword: 'secret-password-value'
			})
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(JSON.stringify(result.values)).not.toContain('secret-password-value');
			// The phone is safe to re-render, and should be.
			expect(result.values.phoneNumber).toBe('0712345678');
		}
	});
});

describe('invitation acceptance with phone', () => {
	it('normalises the number', () => {
		const result = parseForm(
			acceptInvitationSchema,
			formOf({ fullName: 'New Joiner', phoneDial: '+234', phoneNumber: '08031234567' })
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data).toEqual({
			fullName: 'New Joiner',
			phone: '+2348031234567'
		});
	});

	it('rejects a missing number', () => {
		const result = parseForm(
			acceptInvitationSchema,
			formOf({ fullName: 'New Joiner', phoneDial: '+254', phoneNumber: '' })
		);
		expect(result.ok).toBe(false);
	});
});
