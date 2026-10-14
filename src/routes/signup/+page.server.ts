import { fail, redirect } from '@sveltejs/kit';
import { formError, formFailure, parseForm, signUpSchema } from '$lib/schemas';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import { autoConfirmSignups } from '$lib/server/env';
import { createServiceClient } from '$lib/server/supabase';
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
				// Supabase Auth owns credentials; the profile row carries the
				// display information. Phone is mirrored into user_metadata so
				// it survives a signup that needs email confirmation, where the
				// profile row is written later by /auth/confirm.
				data: { full_name: parsed.data.fullName, phone: parsed.data.phone },
				emailRedirectTo: `${url.origin}/auth/confirm${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}`
			}
		});

		if (error) {
			return fail(
				400,
				formError(error.message, { email: parsed.data.email, fullName: parsed.data.fullName })
			);
		}

		/**
		 * When the address is already registered, Supabase does not say so --
		 * it returns a user with an empty `identities` array and no session,
		 * so the response is indistinguishable from a fresh signup and cannot
		 * be used to enumerate accounts.
		 *
		 * We must not show "check your email" for it: no email is coming, and
		 * the person would wait forever. Point them at sign-in instead, which
		 * reveals nothing they could not learn by trying to sign in anyway.
		 */
		const alreadyRegistered = data.user !== null && (data.user.identities?.length ?? 0) === 0;
		if (alreadyRegistered) {
			return fail(
				400,
				formError('That email already has an account. Sign in instead, or reset your password.', {
					email: parsed.data.email,
					fullName: parsed.data.fullName
				})
			);
		}

		/**
		 * With AUTH_AUTOCONFIRM on, confirm the address ourselves and sign the
		 * person in, rather than emailing a link that cannot be delivered.
		 * See autoConfirmSignups() for what this trades away.
		 */
		let session = data.session;
		if (!session && data.user && autoConfirmSignups()) {
			const service = createServiceClient();
			const { error: confirmError } = await service.auth.admin.updateUserById(data.user.id, {
				email_confirm: true
			});

			if (confirmError) {
				return fail(
					500,
					formError(
						`Your account was created but could not be activated: ${confirmError.message}`,
						{ email: parsed.data.email }
					)
				);
			}

			// Establish the session on the request client so its cookies are
			// written to this response.
			const { data: signedIn, error: signInError } =
				await locals.supabase.auth.signInWithPassword({
					email: parsed.data.email,
					password: parsed.data.password
				});

			if (signInError || !signedIn.session) {
				// The account exists and is confirmed, so signing in is the
				// correct next step rather than retrying signup.
				return fail(
					500,
					formError('Your account was created. Please sign in to continue.', {
						email: parsed.data.email
					})
				);
			}
			session = signedIn.session;
		}

		// A session exists either because confirmation is off for the project
		// or because we just confirmed the account above.
		if (session) {
			const { error: profileError } = await locals.supabase.from('profiles').upsert(
				{
					id: session.user.id,
					full_name: parsed.data.fullName,
					email: parsed.data.email,
					phone: parsed.data.phone
				},
				{ onConflict: 'id' }
			);

			// The account exists either way; a failed profile write would
			// otherwise surface later as a confusing error during onboarding.
			if (profileError) {
				return fail(
					500,
					formError(
						`Your account was created, but your profile could not be saved: ${profileError.message}. Try signing in.`,
						{ email: parsed.data.email }
					)
				);
			}

			throw redirect(303, safeNext ?? '/onboarding/organization');
		}

		return { checkEmail: true, email: parsed.data.email };
	}
};
