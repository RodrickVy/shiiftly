import { error, fail, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { createStationSchema, formError, formFailure, parseForm } from '$lib/schemas';
import { getStationDailyToken } from '$lib/server/stations';
import { stationClockUrl } from '$lib/domain/tokens';
import { todayInTimeZone } from '$lib/domain/time';
import type { Actions, PageServerLoad } from './$types';
import type { ClockingStation } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Only managers can open a clocking station.');

	const { data: stationRows } = await locals.supabase
		.from('clocking_stations')
		.select('*')
		.eq('organization_id', org.organization.id)
		.order('created_at', { ascending: true });

	const stations = (stationRows ?? []) as ClockingStation[];
	const active = stations.filter((s) => s.is_active);

	const requested = url.searchParams.get('station');
	const selected = active.find((s) => s.id === requested) ?? active[0] ?? null;

	if (!selected) {
		return {
			stations,
			selected: null,
			qr: null,
			recentScans: [],
			qrEnabled: org.settings.qr_clocking_enabled,
			timezone: org.organization.timezone
		};
	}

	// Derived on demand from the organization's local date -- no scheduled job.
	const token = await getStationDailyToken(selected, org.organization);
	const clockUrl = stationClockUrl(url.origin, token.rawToken);

	const qrDataUrl = await QRCode.toDataURL(clockUrl, {
		errorCorrectionLevel: 'M',
		margin: 1,
		width: 512,
		color: { dark: '#111827', light: '#ffffff' }
	});

	// Recent successful scans at this station, newest first.
	const { data: scanRows } = await locals.supabase
		.from('attendance_events')
		.select(
			'id, event_type, occurred_at, organization_memberships(profiles(full_name))'
		)
		.eq('station_id', selected.id)
		.order('occurred_at', { ascending: false })
		.limit(12);

	const recentScans = (scanRows ?? []).map((row) => {
		const membership = row.organization_memberships as unknown as {
			profiles: { full_name: string } | null;
		} | null;
		return {
			id: row.id,
			eventType: row.event_type,
			occurredAt: row.occurred_at,
			name: membership?.profiles?.full_name ?? 'Someone'
		};
	});

	return {
		stations,
		selected: { id: selected.id, name: selected.name },
		qr: {
			dataUrl: qrDataUrl,
			localDate: token.localDate,
			expiresAt: token.expiresAt.toISOString(),
			clockUrl
		},
		recentScans,
		qrEnabled: org.settings.qr_clocking_enabled,
		timezone: org.organization.timezone,
		today: todayInTimeZone(org.organization.timezone)
	};
};

export const actions: Actions = {
	createStation: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Only managers can add a station.');

		const parsed = parseForm(createStationSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { data, error: insertError } = await locals.supabase
			.from('clocking_stations')
			.insert({
				organization_id: org.organization.id,
				name: parsed.data.name,
				created_by: org.membership.user_id
			})
			.select('id')
			.single();

		if (insertError) {
			return fail(500, formError(`Could not create the station: ${insertError.message}`));
		}

		throw redirect(303, `/app/station?station=${data.id}`);
	},

	deactivateStation: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Only managers can change a station.');

		const formData = await request.formData();
		const stationId = String(formData.get('stationId') ?? '');
		if (!stationId) return fail(400, formError('No station was specified.'));

		// Scoped to this organization so a crafted id cannot reach another's.
		const { error: updateError } = await locals.supabase
			.from('clocking_stations')
			.update({ is_active: false })
			.eq('id', stationId)
			.eq('organization_id', org.organization.id);

		if (updateError) {
			return fail(500, formError(`Could not deactivate the station: ${updateError.message}`));
		}

		throw redirect(303, '/app/station');
	}
};
