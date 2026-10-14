import { fail, redirect } from '@sveltejs/kit';
import { formError, formFailure, parseForm, signUpSchema } from '$lib/schemas';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	return { next: url.searchParams.get('next') ?? null };
};

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress, url }) => {
		const formData = await request.formData();
		const parsed = parseForm(signUpSchema, formData);

		if (!parsed.ok) {
			return fail(400, formFailure(parsed.errors, parsed.values));
		}

		const limit = rateLimit(limiterKey('signup:ip', { ip: getClientAddress() }), 5, 3600);
		if (!limit.allowed) {
			return fail(
				429,
				formError(`Too many sign-up attempts. Try again in ${limit.retryAfterSeconds} seconds.`)
			);
		}

		const next = url.searchParams.get('next');
		const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

		const { data, error } = await locals.supabase.auth.signUp({
			email: parsed.data.email,
			password: parsed.data.password,
			options: {
				// Supabase Auth owns credentials; the profile row carries only
				// the display information.
				data: { full_name: parsed.data.fullName },
				emailRedirectTo: `${url.origin}/auth/confirm${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}`
			}
		});

		if (error) {
			return fail(400, formError(error.message, { email: parsed.data.email, fullName: parsed.data.fullName }));
		}

		// Supabase returns a session immediately only when email confirmation
		// is switched off for the project.
		if (data.session) {
			await locals.supabase
				.from('profiles')
				.upsert(
					{
						id: data.session.user.id,
						full_name: parsed.data.fullName,
						email: parsed.data.email
					},
					{ onConflict: 'id' }
				);

			throw redirect(303, safeNext ?? '/onboarding/organization');
		}

		return { checkEmail: true, email: parsed.data.email };
	}
};
