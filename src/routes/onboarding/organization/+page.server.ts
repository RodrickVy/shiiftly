import { fail, redirect } from '@sveltejs/kit';
import { createOrganizationSchema, formError, formFailure, parseForm } from '$lib/schemas';
import { ACTIVE_ORG_COOKIE } from '$lib/server/context';
import { allTimeZones, COUNTRIES, CURRENCIES, INDUSTRIES } from '$lib/data/locales';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		countries: COUNTRIES,
		currencies: CURRENCIES,
		industries: INDUSTRIES,
		timezones: allTimeZones(),
		fullName: (locals.user?.user_metadata?.full_name as string) ?? ''
	};
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		if (!locals.user) throw redirect(303, '/login');

		const parsed = parseForm(createOrganizationSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		// Echoed back if a later step fails, so the form re-renders filled in.
		const submitted = {
			name: parsed.data.name,
			industry: parsed.data.industry ?? '',
			countryCode: parsed.data.countryCode,
			timezone: parsed.data.timezone,
			currencyCode: parsed.data.currencyCode,
			weekStartsOn: String(parsed.data.weekStartsOn)
		};

		// A profile row must exist before the membership references it.
		await locals.supabase.from('profiles').upsert(
			{
				id: locals.user.id,
				full_name: (locals.user.user_metadata?.full_name as string) ?? parsed.data.name,
				email: locals.user.email ?? ''
			},
			{ onConflict: 'id' }
		);

		// Organization, settings and owner membership are created together or
		// not at all; see create_organization in migration 0003.
		const { data, error } = await locals.supabase.rpc('create_organization', {
			p_name: parsed.data.name,
			p_industry: parsed.data.industry || null,
			p_country_code: parsed.data.countryCode,
			p_timezone: parsed.data.timezone,
			p_currency_code: parsed.data.currencyCode,
			p_week_starts_on: parsed.data.weekStartsOn,
			p_workweek_days: [1, 2, 3, 4, 5]
		});

		if (error) {
			return fail(500, formError(`Could not create the organization: ${error.message}`, submitted));
		}

		const result = data as { ok: boolean; code?: string; organization_id?: string };
		if (!result?.ok) {
			const message =
				result?.code === 'invalid_timezone'
					? 'That timezone is not recognised.'
					: 'Could not create the organization. Please try again.';
			return fail(400, formError(message, submitted));
		}

		cookies.set(ACTIVE_ORG_COOKIE, result.organization_id!, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});

		throw redirect(303, '/onboarding/setup');
	}
};
