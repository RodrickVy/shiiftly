import { error, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { getOrganizationDailyCode } from '$lib/server/stations';
import { clockUrl } from '$lib/domain/tokens';
import type { PageServerLoad } from './$types';

/**
 * The clocking screen a station device shows all day.
 *
 * The code is organization-wide, so every station renders exactly the same
 * image. A manager can also open this from the dashboard to preview it.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/app');

	const isStation = org.membership.role === 'station';
	if (!isStation && !org.isManager) {
		throw error(403, 'Only a station device or a manager can open this screen.');
	}

	// Which station this device is, if it is one.
	const { data: station } = isStation
		? await locals.supabase
				.from('clocking_stations')
				.select('id, name, description, is_active')
				.eq('membership_id', org.membership.id)
				.maybeSingle()
		: { data: null };

	if (isStation && station && !station.is_active) {
		return {
			disabled: true as const,
			stationName: station.name,
			organizationName: org.organization.name,
			timezone: org.organization.timezone,
			qr: null,
			isStation
		};
	}

	const code = await getOrganizationDailyCode(org.organization);
	const qrDataUrl = await QRCode.toDataURL(clockUrl(url.origin, code.rawToken), {
		errorCorrectionLevel: 'M',
		margin: 1,
		width: 1024,
		color: { dark: '#111827', light: '#ffffff' }
	});

	return {
		disabled: false as const,
		stationName: station?.name ?? 'Clocking station',
		organizationName: org.organization.name,
		timezone: org.organization.timezone,
		qr: { dataUrl: qrDataUrl, expiresAt: code.expiresAt.toISOString(), localDate: code.localDate },
		isStation
	};
};
