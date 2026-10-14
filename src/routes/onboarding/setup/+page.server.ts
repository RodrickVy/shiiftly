import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { formError, parseForm } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

const setupSchema = z.object({
	breakMode: z.enum(['none', 'automatic', 'manual']),
	automaticBreakMinutes: z.coerce.number().int().min(0).max(480).default(30),
	automaticBreakThresholdMinutes: z.coerce.number().int().min(0).max(1440).default(360),
	stationName: z.string().trim().min(1).max(80).default('Main entrance')
});

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.org) throw redirect(303, '/onboarding/organization');
	if (!locals.org.isManager) throw redirect(303, '/app/home');

	return {
		organizationName: locals.org.organization.name,
		settings: locals.org.settings
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const org = locals.org;
		if (!org) throw redirect(303, '/onboarding/organization');
		if (!org.isManager) throw error(403, 'Only a manager can configure the organization.');

		const parsed = parseForm(setupSchema, await request.formData());
		if (!parsed.ok) return fail(400, { errors: parsed.errors, values: parsed.values });

		const { error: settingsError } = await locals.supabase
			.from('organization_settings')
			.update({
				break_mode: parsed.data.breakMode,
				automatic_break_minutes: parsed.data.automaticBreakMinutes,
				automatic_break_threshold_minutes: parsed.data.automaticBreakThresholdMinutes
			})
			.eq('organization_id', org.organization.id);

		if (settingsError) {
			return fail(500, formError(`Could not save settings: ${settingsError.message}`));
		}

		// A first station, so the clocking screen is usable immediately.
		const { data: existing } = await locals.supabase
			.from('clocking_stations')
			.select('id')
			.eq('organization_id', org.organization.id)
			.limit(1);

		if (!existing || existing.length === 0) {
			const { error: stationError } = await locals.supabase.from('clocking_stations').insert({
				organization_id: org.organization.id,
				name: parsed.data.stationName,
				created_by: org.membership.user_id
			});
			if (stationError) {
				return fail(500, formError(`Could not create the station: ${stationError.message}`));
			}
		}

		throw redirect(303, '/app/dashboard');
	}
};
