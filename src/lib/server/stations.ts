/**
 * Clocking codes, join links and station setup links.
 *
 * All three are derived from a server secret rather than stored, so they can
 * be recomputed on demand while the database keeps only a hash. See
 * src/lib/domain/tokens.ts for the derivation and its reasoning.
 */
import { getConfig } from './env';
import { createServiceClient } from './supabase';
import {
	deriveJoinToken,
	deriveOrgDailyToken,
	deriveStationClaimToken,
	hashToken
} from '$lib/domain/tokens';
import { endOfLocalDay, todayInTimeZone } from '$lib/domain/time';
import type { Organization } from '$lib/types/database';

export interface DailyCode {
	rawToken: string;
	localDate: string;
	expiresAt: Date;
}

/**
 * Today's clocking code for an organization, minting the row on the first
 * request of the local day.
 *
 * Every station device calls this and gets the same value, which is what
 * keeps the screens in sync. Writes go through the service client because no
 * user role holds INSERT on organization_daily_tokens -- codes can only ever
 * originate here.
 */
export async function getOrganizationDailyCode(
	organization: Pick<Organization, 'id' | 'timezone'>
): Promise<DailyCode> {
	const { qrTokenSecret } = getConfig();

	const localDate = todayInTimeZone(organization.timezone);
	const rawToken = await deriveOrgDailyToken(qrTokenSecret, organization.id, localDate);
	const tokenHash = await hashToken(rawToken);
	const expiresAt = endOfLocalDay(localDate, organization.timezone);

	const { error } = await createServiceClient()
		.from('organization_daily_tokens')
		.upsert(
			{
				organization_id: organization.id,
				local_date: localDate,
				token_hash: tokenHash,
				expires_at: expiresAt.toISOString()
			},
			{ onConflict: 'organization_id,local_date' }
		);

	if (error) throw new Error(`Could not prepare the clocking code: ${error.message}`);

	return { rawToken, localDate, expiresAt };
}

/** Resolves a scanned code to its organization, for the confirmation screen. */
export async function describeScannedCode(
	rawToken: string
): Promise<
	{ ok: true; organizationId: string; organizationName: string } | { ok: false }
> {
	const tokenHash = await hashToken(rawToken);

	const { data, error } = await createServiceClient()
		.from('organization_daily_tokens')
		.select('organization_id, local_date, expires_at, organizations(name, timezone)')
		.eq('token_hash', tokenHash)
		.maybeSingle();

	if (error || !data) return { ok: false };

	const org = data.organizations as unknown as { name: string; timezone: string } | null;
	if (!org) return { ok: false };

	// The same local-day rule the SQL applies, so the screen never offers a
	// confirmation the write would then refuse.
	if (
		data.local_date !== todayInTimeZone(org.timezone) ||
		new Date(data.expires_at) <= new Date()
	) {
		return { ok: false };
	}

	return { ok: true, organizationId: data.organization_id, organizationName: org.name };
}

/**
 * The organization's current join link, minting its hash if absent.
 *
 * Re-derivable, so the manager can display it or its QR code at any time.
 */
export async function getJoinToken(
	organization: Pick<Organization, 'id' | 'join_token_version' | 'join_token_hash'>
): Promise<string> {
	const { qrTokenSecret } = getConfig();
	const raw = await deriveJoinToken(qrTokenSecret, organization.id, organization.join_token_version);
	const tokenHash = await hashToken(raw);

	// Store it the first time, or after a rotation, so lookups can find it.
	if (organization.join_token_hash !== tokenHash) {
		const { error } = await createServiceClient()
			.from('organizations')
			.update({ join_token_hash: tokenHash })
			.eq('id', organization.id);
		if (error) throw new Error(`Could not prepare the join link: ${error.message}`);
	}

	return raw;
}

/** Invalidates the current join link and returns the replacement. */
export async function rotateJoinToken(organizationId: string, currentVersion: number): Promise<string> {
	const { qrTokenSecret } = getConfig();
	const nextVersion = currentVersion + 1;
	const raw = await deriveJoinToken(qrTokenSecret, organizationId, nextVersion);

	const { error } = await createServiceClient()
		.from('organizations')
		.update({ join_token_version: nextVersion, join_token_hash: await hashToken(raw) })
		.eq('id', organizationId);

	if (error) throw new Error(`Could not regenerate the join link: ${error.message}`);
	return raw;
}

/** A station's setup link, minting its hash if absent. */
export async function getStationClaimToken(station: {
	id: string;
	claim_token_hash: string | null;
}): Promise<string> {
	const { qrTokenSecret } = getConfig();
	const raw = await deriveStationClaimToken(qrTokenSecret, station.id);
	const tokenHash = await hashToken(raw);

	if (station.claim_token_hash !== tokenHash) {
		const { error } = await createServiceClient()
			.from('clocking_stations')
			.update({ claim_token_hash: tokenHash })
			.eq('id', station.id);
		if (error) throw new Error(`Could not prepare the station link: ${error.message}`);
	}

	return raw;
}
