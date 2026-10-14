import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { TestDb } from './harness';

export function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Mirrors the production token derivation in src/lib/domain/tokens.ts. */
export function deriveStationToken(secret: string, stationId: string, localDate: string): string {
	return createHmac('sha256', secret).update(`${stationId}:${localDate}`).digest('base64url');
}

export function randomToken(): string {
	return randomBytes(32).toString('base64url');
}

export interface Org {
	orgId: string;
	ownerUserId: string;
	ownerMembershipId: string;
}

/** Creates an auth user, a profile and an organization owned by that user. */
export async function createOrg(
	t: TestDb,
	opts: { email: string; name: string; timezone?: string; currency?: string }
): Promise<Org> {
	const ownerUserId = await t.createUser(opts.email);

	await t.asUser(ownerUserId, async () => {
		await t.q(`insert into public.profiles (id, full_name, email) values ($1, $2, $3)`, [
			ownerUserId,
			`Owner of ${opts.name}`,
			opts.email
		]);
	});

	const result = await t.asUser(ownerUserId, () =>
		t.rpc<{ ok: boolean; organization_id: string; membership_id: string }>(
			'public.create_organization',
			[opts.name, 'retail', 'KE', opts.timezone ?? 'Africa/Nairobi', opts.currency ?? 'KES', 1, [1, 2, 3, 4, 5]]
		)
	);

	if (!result.ok) throw new Error(`createOrg failed: ${JSON.stringify(result)}`);

	return {
		orgId: result.organization_id,
		ownerUserId,
		ownerMembershipId: result.membership_id
	};
}

export interface Employee {
	userId: string;
	membershipId: string;
}

/** Invites and immediately accepts, producing an active employee membership. */
export async function addEmployee(
	t: TestDb,
	org: Org,
	opts: { email: string; fullName: string; role?: 'employee' | 'manager' }
): Promise<Employee> {
	const raw = randomToken();

	await t.asUser(org.ownerUserId, async () => {
		await t.q(
			`insert into public.invitations
			   (organization_id, token_hash, role, max_uses, expires_at, created_by)
			 values ($1, $2, $3, 1, now() + interval '7 days', $4)`,
			[org.orgId, sha256(raw), opts.role ?? 'employee', org.ownerUserId]
		);
	});

	const userId = await t.createUser(opts.email);
	const res = await t.asUser(userId, () =>
		t.rpc<{ ok: boolean; membership_id: string; code?: string }>('public.accept_invitation', [
			sha256(raw),
			opts.fullName,
			null
		])
	);

	if (!res.ok) throw new Error(`addEmployee failed: ${JSON.stringify(res)}`);
	return { userId, membershipId: res.membership_id };
}

/** Creates a station and mints today's token for it, returning the raw token. */
export async function createStationWithToken(
	t: TestDb,
	org: Org,
	name = 'Front desk'
): Promise<{ stationId: string; rawToken: string; localDate: string }> {
	const [station] = await t.asUser(org.ownerUserId, () =>
		t.q<{ id: string }>(
			`insert into public.clocking_stations (organization_id, name, created_by)
			 values ($1, $2, $3) returning id`,
			[org.orgId, name, org.ownerUserId]
		)
	);

	const [{ local_date }] = await t.q<{ local_date: string }>(
		`select (now() at time zone o.timezone)::date::text as local_date
		 from public.organizations o where o.id = $1`,
		[org.orgId]
	);

	const rawToken = deriveStationToken('test-secret', station.id, local_date);

	// expires_at is the next local midnight, expressed as an absolute instant.
	await t.q(
		`insert into public.station_daily_tokens
		   (organization_id, station_id, local_date, token_hash, expires_at)
		 select $1, $2, $3::date, $4,
		        ((($3::date + 1)::text || ' 00:00:00')::timestamp at time zone o.timezone)
		 from public.organizations o where o.id = $1`,
		[org.orgId, station.id, local_date, sha256(rawToken)]
	);

	return { stationId: station.id, rawToken, localDate: local_date };
}

/** Rewinds an open shift's start so elapsed-time behaviour can be exercised. */
export async function backdateShift(t: TestDb, shiftId: string, minutesAgo: number) {
	await t.q(`update public.shifts set started_at = now() - ($2 || ' minutes')::interval where id = $1`, [
		shiftId,
		String(minutesAgo)
	]);
}
