import { error, fail, redirect } from '@sveltejs/kit';
import {
	formError,
	formFailure,
	organizationProfileSchema,
	organizationSettingsSchema,
	parseForm
} from '$lib/schemas';
import { allTimeZones, COUNTRIES, CURRENCIES, INDUSTRIES } from '$lib/data/locales';
import { hasEmailProvider } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	return {
		organization: org.organization,
		settings: org.settings,
		isOwner: org.isOwner,
		emailConfigured: hasEmailProvider(),
		countries: COUNTRIES,
		currencies: CURRENCIES,
		industries: INDUSTRIES,
		timezones: allTimeZones()
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isOwner) throw error(403, 'Only the owner can change organization details.');

		const parsed = parseForm(organizationProfileSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { error: updateError } = await locals.supabase
			.from('organizations')
			.update({
				name: parsed.data.name,
				industry: parsed.data.industry || null,
				country_code: parsed.data.countryCode,
				timezone: parsed.data.timezone,
				currency_code: parsed.data.currencyCode,
				week_starts_on: parsed.data.weekStartsOn
			})
			.eq('id', org.organization.id);

		if (updateError) {
			return fail(500, formError('Those details could not be saved.'));
		}

		return { profileSaved: true as const };
	},

	updateSettings: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(organizationSettingsSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		if (
			parsed.data.breakMode === 'automatic' &&
			parsed.data.automaticBreakMinutes > parsed.data.automaticBreakThresholdMinutes
		) {
			return fail(
				400,
				formFailure({
					automaticBreakMinutes: [
						'The break cannot be longer than the shift length that triggers it.'
					]
				})
			);
		}

		// Changes apply from now on. Shifts already closed keep the figures
		// frozen at clock-out, so nothing historical is rewritten.
		const { error: updateError } = await locals.supabase
			.from('organization_settings')
			.update({
				qr_clocking_enabled: parsed.data.qrClockingEnabled,
				direct_clocking_enabled: parsed.data.directClockingEnabled,
				break_mode: parsed.data.breakMode,
				automatic_break_minutes: parsed.data.automaticBreakMinutes,
				automatic_break_threshold_minutes: parsed.data.automaticBreakThresholdMinutes,
				timesheet_approval_required: parsed.data.timesheetApprovalRequired,
				allow_manager_corrections: parsed.data.allowManagerCorrections,
				employee_earnings_visible: parsed.data.employeeEarningsVisible,
				notify_managers_on_time_off: parsed.data.notifyManagersOnTimeOff,
				notify_employee_on_decision: parsed.data.notifyEmployeeOnDecision
			})
			.eq('organization_id', org.organization.id);

		if (updateError) {
			return fail(500, formError('Those settings could not be saved.'));
		}

		return { settingsSaved: true as const };
	}
};
