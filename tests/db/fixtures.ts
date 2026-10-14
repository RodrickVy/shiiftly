import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { TestDb } from './harness';

export const SECRET = 'test-secret-at-least-32-characters-long';

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function hmac(message: string): string {
	return createHmac('sha256', SECRET).update(message).digest('base64url');
}

/** Mirrors the derivations in src/lib/domain/tokens.ts. */
export const derive = {
	orgDaily: (organizationId: string, localDate: string) =>
		hmac(`clock:${organizationId}:${localDate}`),
	join: (organizationId: string, version: number) => hmac(`join:${organizationId}:${version}`),
	stationClaim: (stationId: string) => hmac(`station:${stationId}`)
};

export function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

export function uniqueEmail(prefix: string): string {
	return `${prefix}-${randomBytes(5).toString('hex')}@example.com`;
}

export interface Org {
	orgId: string;
	ownerUserId: string;
	ownerMembershipId: string;
}

/** Creates an auth user, a profile and an organization owned by that user. */
export async function createOrg(
	t: TestDb,
	opts: { email?: string; name: string; timezone?: string; currency?: string } = { name: 'Test Co' }
): Promise<Org> {
	const email = opts.email ?? uniqueEmail('owner');
	const ownerUserId = await t.createUser(email);

	await t.asUser(ownerUserId, () =>
		t.q(`insert into public.profiles (id, full_name, email) values ($1, $2, $3)`, [
			ownerUserId,
			`Owner of ${opts.name}`,
			email
		])
	);

	const result = await t.asUser(ownerUserId, () =>
		t.rpc<{ ok: boolean; organization_id: string; membership_id: string }>(
			'public.create_organization',
			[
				opts.name,
				'retail',
				'KE',
				opts.timezone ?? 'Africa/Nairobi',
				opts.currency ?? 'KES',
				1,
				[1, 2, 3, 4, 5]
			]
		)
	);

	if (!result.ok) throw new Error(`createOrg failed: ${JSON.stringify(result)}`);

	return { orgId: result.organization_id, ownerUserId, ownerMembershipId: result.membership_id };
}

/** Publishes the organization's join link and returns its raw token. */
export async function enableJoinLink(t: TestDb, org: Org): Promise<string> {
	const [row] = await t.q<{ join_token_version: number }>(
		`select join_token_version from public.organizations where id = $1`,
		[org.orgId]
	);
	const raw = derive.join(org.orgId, row.join_token_version);
	await t.q(`update public.organizations set join_token_hash = $2 where id = $1`, [
		org.orgId,
		sha256(raw)
	]);
	return raw;
}

export interface Member {
	userId: string;
	membershipId: string;
}

/** Signs someone up through the join link, leaving them pending. */
export async function requestToJoin(
	t: TestDb,
	joinToken: string,
	opts: { email?: string; fullName: string; phone?: string }
): Promise<{ userId: string; result: Record<string, unknown> }> {
	const userId = await t.createUser(opts.email ?? uniqueEmail('applicant'));
	const result = await t.asUser(userId, () =>
		t.rpc<Record<string, unknown>>('public.request_to_join', [
			sha256(joinToken),
			opts.fullName,
			opts.phone ?? '+254712345678'
		])
	);
	return { userId, result };
}

/** Join link -> request -> accepted, producing an active member. */
export async function addMember(
	t: TestDb,
	org: Org,
	opts: { email?: string; fullName: string; role?: 'employee' | 'manager' }
): Promise<Member> {
	const joinToken = await enableJoinLink(t, org);
	const { userId } = await requestToJoin(t, joinToken, {
		email: opts.email,
		fullName: opts.fullName
	});

	const [membership] = await t.q<{ id: string }>(
		`select id from public.organization_memberships where organization_id = $1 and user_id = $2`,
		[org.orgId, userId]
	);

	const review = await t.asUser(org.ownerUserId, () =>
		t.rpc<{ ok: boolean; code?: string }>('public.review_join_request', [
			membership.id,
			'accept',
			opts.role ?? 'employee'
		])
	);
	if (!review.ok) throw new Error(`addMember failed: ${JSON.stringify(review)}`);

	return { userId, membershipId: membership.id };
}

/**
 * Mints today's organization-wide clocking code and returns the raw token.
 * Every station would display exactly this.
 */
export async function createDailyCode(t: TestDb, org: Org): Promise<{ raw: string; localDate: string }> {
	const [{ local_date }] = await t.q<{ local_date: string }>(
		`select (now() at time zone o.timezone)::date::text as local_date
		 from public.organizations o where o.id = $1`,
		[org.orgId]
	);

	const raw = derive.orgDaily(org.orgId, local_date);

	await t.q(
		`insert into public.organization_daily_tokens
		   (organization_id, local_date, token_hash, expires_at)
		 select $1, $2::date, $3,
		        ((($2::date + 1)::text || ' 00:00:00')::timestamp at time zone o.timezone)
		 from public.organizations o where o.id = $1
		 on conflict (organization_id, local_date) do update set token_hash = excluded.token_hash`,
		[org.orgId, local_date, sha256(raw)]
	);

	return { raw, localDate: local_date };
}

/** Creates a station and the device account that claimed it. */
export async function createStation(
	t: TestDb,
	org: Org,
	opts: { name?: string; email?: string } = {}
): Promise<{ stationId: string; userId: string; membershipId: string; claimToken: string }> {
	const [station] = await t.asUser(org.ownerUserId, () =>
		t.q<{ id: string }>(
			`insert into public.clocking_stations (organization_id, name, created_by)
			 values ($1, $2, $3) returning id`,
			[org.orgId, opts.name ?? 'Front desk', org.ownerUserId]
		)
	);

	const claimToken = derive.stationClaim(station.id);
	await t.q(`update public.clocking_stations set claim_token_hash = $2 where id = $1`, [
		station.id,
		sha256(claimToken)
	]);

	const userId = await t.createUser(opts.email ?? uniqueEmail('station'));
	const result = await t.asService(() =>
		t.rpc<{ ok: boolean; membership_id: string; code?: string }>('public.claim_station', [
			sha256(claimToken),
			userId,
			opts.name ?? 'Front desk',
			'By the entrance'
		])
	);
	if (!result.ok) throw new Error(`createStation failed: ${JSON.stringify(result)}`);

	return { stationId: station.id, userId, membershipId: result.membership_id, claimToken };
}

/** Rewinds an open shift's start so elapsed-time behaviour can be exercised. */
export async function backdateShift(t: TestDb, shiftId: string, minutesAgo: number) {
	await t.q(
		`update public.shifts set started_at = now() - ($2 || ' minutes')::interval where id = $1`,
		[shiftId, String(minutesAgo)]
	);
}
