import { error, fail, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { formError, formFailure, parseForm } from '$lib/schemas';
import { getOrganizationDailyCode, getStationClaimToken } from '$lib/server/stations';
import { clockUrl, stationClaimUrl } from '$lib/domain/tokens';
import { createServiceClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';
import type { ClockingStation } from '$lib/types/database';

const createStationSchema = z.object({
	name: z.string().trim().min(1, 'Give the station a name').max(80),
	description: z.string().trim().max(200).optional().or(z.literal(''))
});

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const { data: rows } = await locals.supabase
		.from('clocking_stations')
		.select('*')
		.eq('organization_id', org.organization.id)
		.order('created_at', { ascending: true });

	const stations = (rows ?? []) as ClockingStation[];

	// A setup link for each station that has not been claimed yet.
	const withLinks = await Promise.all(
		stations.map(async (station) => ({
			id: station.id,
			name: station.name,
			description: station.description,
			isActive: station.is_active,
			claimed: station.membership_id !== null,
			claimedAt: station.claimed_at,
			setupUrl: station.membership_id
				? null
				: stationClaimUrl(url.origin, await getStationClaimToken(station))
		}))
	);

	// The shared code, shown here so a manager can see exactly what every
	// station is displaying right now.
	const code = await getOrganizationDailyCode(org.organization);
	const previewQr = await QRCode.toDataURL(clockUrl(url.origin, code.rawToken), {
		errorCorrectionLevel: 'M',
		margin: 1,
		width: 512,
		color: { dark: '#111827', light: '#ffffff' }
	});

	return {
		stations: withLinks,
		qrEnabled: org.settings.qr_clocking_enabled,
		timezone: org.organization.timezone,
		preview: { dataUrl: previewQr, expiresAt: code.expiresAt.toISOString() }
	};
};

export const actions: Actions = {
	create: async ({ request, locals, url }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(createStationSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { data, error: insertError } = await locals.supabase
			.from('clocking_stations')
			.insert({
				organization_id: org.organization.id,
				name: parsed.data.name,
				description: parsed.data.description || null,
				created_by: org.membership.user_id
			})
			.select('id, claim_token_hash')
			.single();

		if (insertError || !data) {
			return fail(500, formError('That station could not be created.'));
		}

		const setupUrl = stationClaimUrl(
			url.origin,
			await getStationClaimToken({ id: data.id, claim_token_hash: data.claim_token_hash })
		);

		return { created: true as const, stationId: data.id, setupUrl };
	},

	setActive: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const formData = await request.formData();
		const stationId = String(formData.get('stationId') ?? '');
		const active = String(formData.get('active') ?? '') === 'true';

		const { error: updateError } = await locals.supabase
			.from('clocking_stations')
			.update({ is_active: active })
			.eq('id', stationId)
			.eq('organization_id', org.organization.id);

		if (updateError) return fail(500, formError('That station could not be updated.'));
		return { toggled: true as const, active };
	},

	/**
	 * Unlinks the device account from a station so the station can be set up
	 * again elsewhere. The account itself is deleted, which signs the old
	 * device out for good -- that is the point of the action.
	 */
	unlink: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const stationId = String((await request.formData()).get('stationId') ?? '');

		const { data: station } = await locals.supabase
			.from('clocking_stations')
			.select('id, membership_id')
			.eq('id', stationId)
			.eq('organization_id', org.organization.id)
			.maybeSingle();

		if (!station?.membership_id) return fail(404, formError('That station is not set up.'));

		const service = createServiceClient();

		const { data: membership } = await service
			.from('organization_memberships')
			.select('user_id, role')
			.eq('id', station.membership_id)
			.maybeSingle();

		// Guard against unlinking anything that is not a device account.
		if (!membership || membership.role !== 'station') {
			return fail(400, formError('That station is not linked to a device account.'));
		}

		await service
			.from('clocking_stations')
			.update({ membership_id: null, claimed_at: null })
			.eq('id', station.id);

		await service.from('organization_memberships').delete().eq('id', station.membership_id);
		await service.auth.admin.deleteUser(membership.user_id).catch(() => {});

		return { unlinked: true as const };
	}
};
