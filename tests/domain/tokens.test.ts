import { describe, expect, it } from 'vitest';
import {
	clockUrl,
	deriveJoinToken,
	deriveOrgDailyToken,
	deriveStationClaimToken,
	hashToken,
	joinUrl,
	randomToken,
	stationClaimUrl,
	timingSafeEqual
} from '../../src/lib/domain/tokens';

const SECRET = 'test-secret-at-least-32-characters-long';
const ORG = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const STATION = 'd3b07384-d9a0-4f1e-9c2b-1a2b3c4d5e6f';

describe('deriveOrgDailyToken', () => {
	it('is deterministic for the same organization and day', async () => {
		const a = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		const b = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		expect(a).toBe(b);
	});

	/**
	 * The whole point of the organization-wide code: two station devices
	 * asking for today's code must get an identical value, because they are
	 * asked to display the same image.
	 */
	it('is identical for every station in the organization', async () => {
		const screenA = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		const screenB = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		expect(screenA).toBe(screenB);
	});

	it('differs from one day to the next, which is what expires it', async () => {
		const today = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		const tomorrow = await deriveOrgDailyToken(SECRET, ORG, '2026-05-21');
		expect(today).not.toBe(tomorrow);
	});

	it('differs between organizations on the same day', async () => {
		const a = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		const b = await deriveOrgDailyToken(SECRET, STATION, '2026-05-20');
		expect(a).not.toBe(b);
	});

	it('changes when the secret is rotated', async () => {
		const a = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		const b = await deriveOrgDailyToken(`${SECRET}-rotated`, ORG, '2026-05-20');
		expect(a).not.toBe(b);
	});

	it('leaks neither the organization id nor the date', async () => {
		const token = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
		expect(token).not.toContain(ORG);
		expect(token).not.toContain('2026');
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(token.length).toBeGreaterThanOrEqual(42);
	});
});

describe('deriveJoinToken', () => {
	it('is stable for a version, so the link can be redisplayed', async () => {
		const a = await deriveJoinToken(SECRET, ORG, 1);
		const b = await deriveJoinToken(SECRET, ORG, 1);
		expect(a).toBe(b);
	});

	/** Bumping the version is how a leaked link is invalidated. */
	it('changes when the version is bumped', async () => {
		const v1 = await deriveJoinToken(SECRET, ORG, 1);
		const v2 = await deriveJoinToken(SECRET, ORG, 2);
		expect(v1).not.toBe(v2);
	});

	it('differs between organizations', async () => {
		const a = await deriveJoinToken(SECRET, ORG, 1);
		const b = await deriveJoinToken(SECRET, STATION, 1);
		expect(a).not.toBe(b);
	});
});

describe('deriveStationClaimToken', () => {
	it('is stable for a station', async () => {
		const a = await deriveStationClaimToken(SECRET, STATION);
		const b = await deriveStationClaimToken(SECRET, STATION);
		expect(a).toBe(b);
	});

	it('differs between stations', async () => {
		const a = await deriveStationClaimToken(SECRET, STATION);
		const b = await deriveStationClaimToken(SECRET, ORG);
		expect(a).not.toBe(b);
	});
});

/**
 * Three kinds of token share one secret. If any pair could collide, a join
 * link could be redeemed as a clocking code, or a station setup link could
 * be used to join as staff.
 */
describe('domain separation', () => {
	it('never produces the same token for different purposes', async () => {
		const id = ORG;
		const tokens = [
			await deriveOrgDailyToken(SECRET, id, '2026-05-20'),
			await deriveJoinToken(SECRET, id, 1),
			await deriveStationClaimToken(SECRET, id)
		];
		expect(new Set(tokens).size).toBe(3);
	});
});

describe('hashToken', () => {
	it('produces a stable hex SHA-256', async () => {
		expect(await hashToken('hello')).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
	});

	it('does not contain the raw token', async () => {
		const raw = await deriveOrgDailyToken(SECRET, ORG, '2026-05-20');
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
});

describe('timingSafeEqual', () => {
	it('compares correctly', () => {
		expect(timingSafeEqual('abc', 'abc')).toBe(true);
		expect(timingSafeEqual('abc', 'abd')).toBe(false);
		expect(timingSafeEqual('abc', 'abcd')).toBe(false);
	});
});

describe('urls', () => {
	it('builds each link, without doubling the slash', () => {
		expect(clockUrl('https://shiftly.app', 'tok')).toBe('https://shiftly.app/clock/tok');
		expect(clockUrl('https://shiftly.app/', 'tok')).toBe('https://shiftly.app/clock/tok');
		expect(joinUrl('https://shiftly.app', 'tok')).toBe('https://shiftly.app/join/tok');
		expect(stationClaimUrl('https://shiftly.app', 'tok')).toBe(
			'https://shiftly.app/station/setup/tok'
		);
	});
});
