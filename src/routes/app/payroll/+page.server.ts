import { error, redirect } from '@sveltejs/kit';
import { buildPayroll } from '$lib/server/reports';
import { addDays, todayInTimeZone } from '$lib/domain/time';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');
	// Pay figures are owner-level in this MVP.
	if (!org.isOwner) throw error(403, 'Only the owner can see pay information.');

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);
	const from = url.searchParams.get('from') ?? addDays(today, -29);
	const to = url.searchParams.get('to') ?? today;
	const approvedOnly = url.searchParams.get('approved') === '1';

	const { rows, currency } = await buildPayroll(locals, { from, to, approvedOnly });

	return {
		from,
		to,
		approvedOnly,
		rows,
		currency,
		approvalRequired: org.settings.timesheet_approval_required,
		totals: {
			grossCents: rows.reduce((t, r) => t + r.grossCents, 0),
			payableMinutes: rows.reduce((t, r) => t + r.payableMinutes, 0),
			missingRates: rows.filter((r) => !r.hasRate).length
		}
	};
};
