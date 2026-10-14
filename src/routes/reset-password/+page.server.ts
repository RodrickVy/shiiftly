import { fail, redirect } from '@sveltejs/kit';
import { formError, formFailure, parseForm, resetPasswordSchema } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Reaching this page requires the recovery link to have established a
	// session; without one there is nothing to update.
	return { hasSession: Boolean(locals.user) };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) {
			return fail(401, formError('This reset link has expired. Request a new one.'));
		}

		const parsed = parseForm(resetPasswordSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { error } = await locals.supabase.auth.updateUser({ password: parsed.data.password });
		if (error) {
			return fail(400, formError(error.message));
		}

		throw redirect(303, '/app');
	}
};
