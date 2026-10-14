import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Overflow menu for the manager's mobile navigation. */
export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');
	return {};
};
