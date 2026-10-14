import { describe, expect, it } from 'vitest';
import {
	deriveStationToken,
	hashToken,
	randomToken,
	stationClockUrl,
	timingSafeEqual
} from '../../src/lib/domain/tokens';

const SECRET = 'test-secret-at-least-32-characters-long';
const STATION = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('deriveStationToken', () => {
	it('is deterministic for the same station and day', async () => {
		const a = await deriveStationToken(SECRET, STATION, '2026-05-20');
		const b = await deriveStationToken(SECRET, STATION, '2026-05-20');
		expect(a).toBe(b);
	});

	/** This is what makes the code expire at local midnight without a job. */
	it('differs from one day to the next', async () => {
		const today = await deriveStationToken(SECRET, STATION, '2026-05-20');
		const tomorrow = await deriveStationToken(SECRET, STATION, '2026-05-21');
		expect(today).not.toBe(tomorrow);
	});

	it('differs between stations on the same day', async () => {
		const a = await deriveStationToken(SECRET, STATION, '2026-05-20');
		const b = await deriveStationToken(SECRET, 'a1b2c3d4-0000-0000-0000-000000000000', '2026-05-20');
		expect(a).not.toBe(b);
	});

	it('changes when the secret is rotated', async () => {
		const a = await deriveStationToken(SECRET, STATION, '2026-05-20');
		const b = await deriveStationToken(`${SECRET}-rotated`, STATION, '2026-05-20');
		expect(a).not.toBe(b);
	});

	it('is URL-safe and long enough to be unguessable', async () => {
		const token = await deriveStationToken(SECRET, STATION, '2026-05-20');
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		// 32 bytes of HMAC output, base64url encoded.
		expect(token.length).toBeGreaterThanOrEqual(42);
	});

	it('does not leak the station id or date into the token', async () => {
		const token = await deriveStationToken(SECRET, STATION, '2026-05-20');
		expect(token).not.toContain(STATION);
		expect(token).not.toContain('2026');
	});
});

describe('hashToken', () => {
	it('produces a stable hex SHA-256', async () => {
		const hash = await hashToken('hello');
		expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
	});

	it('differs for different inputs', async () => {
		expect(await hashToken('a')).not.toBe(await hashToken('b'));
	});

	/** The stored hash must not be reversible to the scannable code. */
	it('does not contain the raw token', async () => {
		const raw = await deriveStationToken(SECRET, STATION, '2026-05-20');
		const hash = await hashToken(raw);
		expect(hash).not.toContain(raw);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('randomToken', () => {
	it('is URL-safe and unique across calls', () => {
		const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
		expect(tokens.size).toBe(200);
		for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('honours the requested byte length', () => {
		expect(randomToken(16).length).toBeGreaterThanOrEqual(21);
		expect(randomToken(32).length).toBeGreaterThanOrEqual(42);
	});
});

describe('timingSafeEqual', () => {
	it('compares correctly', () => {
		expect(timingSafeEqual('abc', 'abc')).toBe(true);
		expect(timingSafeEqual('abc', 'abd')).toBe(false);
		expect(timingSafeEqual('abc', 'abcd')).toBe(false);
		expect(timingSafeEqual('', '')).toBe(true);
	});
});

describe('stationClockUrl', () => {
	it('builds the URL a QR code encodes', () => {
		expect(stationClockUrl('https://shiftly.app', 'abc123')).toBe(
			'https://shiftly.app/clock/abc123'
		);
	});

	it('does not double the slash', () => {
		expect(stationClockUrl('https://shiftly.app/', 'abc123')).toBe(
			'https://shiftly.app/clock/abc123'
		);
	});
});
