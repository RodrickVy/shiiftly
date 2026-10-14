import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

/**
 * Landing point for Supabase email links (confirmation and recovery).
 * Exchanges the one-time token for a session, then forwards the user on.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	const next = url.searchParams.get('next');

	// Only same-origin paths, so a crafted link cannot bounce someone offsite.
	const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';

	if (!tokenHash || !type) {
		throw redirect(303, '/auth/error?reason=missing');
	}

	const { error } = await locals.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
	if (error) {
		throw redirect(303, '/auth/error?reason=invalid');
	}

	// Make sure a profile row exists for a freshly confirmed account.
	const {
		data: { user }
	} = await locals.supabase.auth.getUser();

	if (user) {
		await locals.supabase.from('profiles').upsert(
			{
				id: user.id,
				full_name: (user.user_metadata?.full_name as string) ?? user.email ?? 'New user',
				email: user.email ?? '',
				// Captured at signup; only reaches the profile once confirmed.
				phone: (user.user_metadata?.phone as string) ?? null
			},
			{ onConflict: 'id' }
		);
	}

	throw redirect(303, safeNext);
};
