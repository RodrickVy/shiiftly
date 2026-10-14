import { redirect } from '@sveltejs/kit';
import { ACTIVE_ORG_COOKIE } from '$lib/server/context';
import type { RequestHandler } from './$types';

/** POST only, so a stray link or prefetch cannot sign someone out. */
export const POST: RequestHandler = async ({ locals, cookies }) => {
	await locals.supabase.auth.signOut();
	cookies.delete(ACTIVE_ORG_COOKIE, { path: '/' });
	throw redirect(303, '/');
};
