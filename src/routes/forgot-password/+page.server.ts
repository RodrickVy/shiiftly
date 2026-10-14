import { fail } from '@sveltejs/kit';
import { forgotPasswordSchema, formError, formFailure, parseForm } from '$lib/schemas';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, locals, getClientAddress, url }) => {
		const parsed = parseForm(forgotPasswordSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const limit = rateLimit(limiterKey('reset:ip', { ip: getClientAddress() }), 5, 900);
		if (!limit.allowed) {
			return fail(
				429,
				formError(`Too many requests. Try again in ${limit.retryAfterSeconds} seconds.`, {
					email: parsed.data.email
				})
			);
		}

		await locals.supabase.auth.resetPasswordForEmail(parsed.data.email, {
			redirectTo: `${url.origin}/auth/confirm?next=/reset-password`
		});

		// Always the same answer, so this endpoint cannot be used to discover
		// which addresses have accounts.
		return { sent: true };
	}
};
