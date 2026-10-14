import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const pending = locals.pendingJoin;
	if (!pending) throw redirect(303, '/app');
	return { pending };
};
