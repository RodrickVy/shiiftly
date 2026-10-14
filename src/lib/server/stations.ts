/**
 * Station daily QR tokens.
 *
 * The token for a station on a given organization-local day is derived from a
 * server secret, so it can be recomputed on demand -- no nightly job, and the
 * database stores only its hash. Calling this twice on the same day returns
 * the same code; calling it after local midnight returns a new one and the
 * old one stops validating.
 */
import { getConfig } from './env';
import { createServiceClient, type Db } from './supabase';
import { deriveStationToken, hashToken } from '$lib/domain/tokens';
import { endOfLocalDay, todayInTimeZone } from '$lib/domain/time';
import type { Organization } from '$lib/types/database';

export interface DailyToken {
	rawToken: string;
	localDate: string;
	expiresAt: Date;
}

/**
 * Returns today's token for a station, minting the row if this is the first
 * request of the local day.
 *
 * Writes go through the service client: no user role is granted INSERT on
 * station_daily_tokens, precisely so that tokens can only ever originate
 * here. The caller must already have established that the user manages this
 * organization.
 */
export async function getStationDailyToken(
	station: { id: string; organization_id: string },
	organization: Pick<Organization, 'timezone'>
): Promise<DailyToken> {
	const { qrTokenSecret } = getConfig();

	const localDate = todayInTimeZone(organization.timezone);
	const rawToken = await deriveStationToken(qrTokenSecret, station.id, localDate);
	const tokenHash = await hashToken(rawToken);
	const expiresAt = endOfLocalDay(localDate, organization.timezone);

	const service = createServiceClient();
	const { error } = await service.from('station_daily_tokens').upsert(
		{
			organization_id: station.organization_id,
			station_id: station.id,
			local_date: localDate,
			token_hash: tokenHash,
			expires_at: expiresAt.toISOString()
		},
		{ onConflict: 'station_id,local_date' }
	);

	if (error) {
		throw new Error(`Could not prepare the station code: ${error.message}`);
	}

	return { rawToken, localDate, expiresAt };
}

/**
 * Resolves a scanned token to its station without revealing why it failed in
 * more detail than the user needs.
 *
 * Validation itself lives in SQL (`resolve_station_token`), which also
 * re-checks organization-local validity at the moment of the write; this is
 * the read-side lookup used to render the confirmation screen.
 */
export async function describeScannedToken(
	supabase: Db,
	rawToken: string
): Promise<
	| { ok: true; stationId: string; stationName: string; organizationId: string; organizationName: string }
	| { ok: false; reason: 'invalid' }
> {
	const tokenHash = await hashToken(rawToken);
	const service = createServiceClient();

	const { data, error } = await service
		.from('station_daily_tokens')
		.select(
			'station_id, organization_id, local_date, expires_at, clocking_stations(name, is_active), organizations(name, timezone)'
		)
		.eq('token_hash', tokenHash)
		.maybeSingle();

	if (error || !data) return { ok: false, reason: 'invalid' };

	const stationRow = data.clocking_stations as unknown as { name: string; is_active: boolean } | null;
	const orgRow = data.organizations as unknown as { name: string; timezone: string } | null;
	if (!stationRow || !orgRow || !stationRow.is_active) return { ok: false, reason: 'invalid' };

	// The same local-day rule the SQL applies, so the screen never invites a
	// confirmation the write would then refuse.
	const today = todayInTimeZone(orgRow.timezone);
	if (data.local_date !== today || new Date(data.expires_at) <= new Date()) {
		return { ok: false, reason: 'invalid' };
	}

	void supabase; // reserved: membership checks happen in the SQL function

	return {
		ok: true,
		stationId: data.station_id,
		stationName: stationRow.name,
		organizationId: data.organization_id,
		organizationName: orgRow.name
	};
}
