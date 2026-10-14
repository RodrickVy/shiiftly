import { error, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { getStationDailyToken } from '$lib/server/stations';
import { stationClockUrl } from '$lib/domain/tokens';
import type { PageServerLoad } from './$types';
import type { ClockingStation } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Only managers can display a clocking station.');

	const { data: station } = await locals.supabase
		.from('clocking_stations')
		.select('*')
		.eq('id', params.id)
		.eq('organization_id', org.organization.id)
		.maybeSingle();

	if (!station) throw error(404, 'That station does not exist.');
	const row = station as ClockingStation;
	if (!row.is_active) throw error(410, 'That station has been deactivated.');

	const token = await getStationDailyToken(row, org.organization);
	const qrDataUrl = await QRCode.toDataURL(stationClockUrl(url.origin, token.rawToken), {
		errorCorrectionLevel: 'M',
		margin: 1,
		width: 1024,
		color: { dark: '#111827', light: '#ffffff' }
	});

	return {
		station: { id: row.id, name: row.name },
		organizationName: org.organization.name,
		timezone: org.organization.timezone,
		qr: { dataUrl: qrDataUrl, expiresAt: token.expiresAt.toISOString() }
	};
};
