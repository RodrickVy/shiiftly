import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** /app is a signpost: managers get the dashboard, everyone else Home. */
export const load: PageServerLoad = async ({ locals }) => {
	throw redirect(303, locals.org?.isManager ? '/app/dashboard' : '/app/home');
};
