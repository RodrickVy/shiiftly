import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.settings.qr_clocking_enabled) {
		throw error(403, 'QR clocking is switched off for your organization.');
	}
	return { organizationName: org.organization.name };
};
