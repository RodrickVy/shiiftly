import { fail, redirect } from '@sveltejs/kit';
import { formError, formFailure, parseForm, signInSchema } from '$lib/schemas';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	return { next: url.searchParams.get('next') ?? null };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, locals, getClientAddress, url } = event;
		const formData = await request.formData();
		const parsed = parseForm(signInSchema, formData);

		if (!parsed.ok) {
			return fail(400, formFailure(parsed.errors, parsed.values));
		}

		// Throttle by address and by account, so neither a single IP nor a
		// single target can be hammered.
		const ip = getClientAddress();
		for (const key of [
			limiterKey('login:ip', { ip }),
			limiterKey('login:account', { ip: null, extra: parsed.data.email })
		]) {
			const limit = rateLimit(key, 10, 300);
			if (!limit.allowed) {
				return fail(
					429,
					formError(
						`Too many sign-in attempts. Try again in ${limit.retryAfterSeconds} seconds.`,
						{ email: parsed.data.email }
					)
				);
			}
		}

		const { error } = await locals.supabase.auth.signInWithPassword({
			email: parsed.data.email,
			password: parsed.data.password
		});

		if (error) {
			// Deliberately uniform: do not reveal whether the address exists.
			return fail(
				400,
				formError('That email and password combination is not correct.', {
					email: parsed.data.email
				})
			);
		}

		const next = url.searchParams.get('next');
		const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
		throw redirect(303, safeNext);
	}
};
