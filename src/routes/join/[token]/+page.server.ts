import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	emailSchema,
	formError,
	formFailure,
	fullNameSchema,
	parseForm,
	passwordSchema
} from '$lib/schemas';
import { normalizePhone, phoneErrorMessage } from '$lib/domain/phone';
import { hashToken } from '$lib/domain/tokens';
import { createServiceClient } from '$lib/server/supabase';
import { ACTIVE_ORG_COOKIE } from '$lib/server/context';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

/**
 * The public join page.
 *
 * Anyone with the link can apply. Applying creates an account and a *pending*
 * membership -- it grants nothing. A manager decides whether the person joins
 * and with which role, so the link being forwarded around is an annoyance
 * rather than a breach.
 */

/** Signing up and applying in one step, for a visitor with no account. */
const joinSignUpSchema = z
	.object({
		fullName: fullNameSchema,
		email: emailSchema,
		phoneDial: z.string().trim().default('+254'),
		phoneNumber: z.string().trim(),
		password: passwordSchema,
		confirmPassword: z.string()
	})
	.refine((v) => v.password === v.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	})
	.transform((v, ctx) => {
		const phone = normalizePhone(v.phoneDial, v.phoneNumber);
		if (!phone.ok) {
			ctx.addIssue({ code: 'custom', message: phoneErrorMessage(phone.reason), path: ['phoneNumber'] });
			return z.NEVER;
		}
		return { ...v, phone: phone.e164 };
	});

/** Applying when already signed in. */
const joinOnlySchema = z
	.object({
		fullName: fullNameSchema,
		phoneDial: z.string().trim().default('+254'),
		phoneNumber: z.string().trim()
	})
	.transform((v, ctx) => {
		const phone = normalizePhone(v.phoneDial, v.phoneNumber);
		if (!phone.ok) {
			ctx.addIssue({ code: 'custom', message: phoneErrorMessage(phone.reason), path: ['phoneNumber'] });
			return z.NEVER;
		}
		return { fullName: v.fullName, phone: phone.e164 };
	});

/** Describes the link without revealing anything beyond the team's name. */
async function previewLink(rawToken: string) {
	const tokenHash = await hashToken(rawToken);
	const { data } = await createServiceClient()
		.from('organizations')
		.select('id, name, join_enabled')
		.eq('join_token_hash', tokenHash)
		.maybeSingle();

	if (!data) return { state: 'invalid' as const };
	if (!data.join_enabled) return { state: 'closed' as const, name: data.name };
	return { state: 'open' as const, id: data.id, name: data.name };
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const preview = await previewLink(params.token);

	// Someone already in this organization does not need to apply again.
	let existingStatus: string | null = null;
	if (preview.state === 'open' && locals.user) {
		const { data } = await createServiceClient()
			.from('organization_memberships')
			.select('status')
			.eq('organization_id', preview.id)
			.eq('user_id', locals.user.id)
			.maybeSingle();
		existingStatus = data?.status ?? null;
	}

	const { data: profile } = locals.user
		? await locals.supabase
				.from('profiles')
				.select('full_name, phone')
				.eq('id', locals.user.id)
				.maybeSingle()
		: { data: null };

	return {
		preview,
		signedIn: Boolean(locals.user),
		existingStatus,
		suggestedName:
			profile?.full_name ?? (locals.user?.user_metadata?.full_name as string) ?? '',
		suggestedPhone: profile?.phone ?? null
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals, cookies, getClientAddress }) => {
		const limit = rateLimit(
			limiterKey('join', { userId: locals.user?.id, ip: getClientAddress() }),
			12,
			600
		);
		if (!limit.allowed) {
			return fail(429, formError(`Too many attempts. Wait ${limit.retryAfterSeconds} seconds.`));
		}

		const formData = await request.formData();
		const tokenHash = await hashToken(params.token);

		// --- Create the account first, when there is not one already ---
		if (!locals.user) {
			const parsed = parseForm(joinSignUpSchema, formData);
			if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

			// Re-rendered if a later step fails; never includes a password.
			const submitted = {
				fullName: parsed.data.fullName,
				email: parsed.data.email,
				phoneDial: parsed.data.phoneDial,
				phoneNumber: parsed.data.phoneNumber
			};

			const { data, error } = await locals.supabase.auth.signUp({
				email: parsed.data.email,
				password: parsed.data.password,
				options: { data: { full_name: parsed.data.fullName, phone: parsed.data.phone } }
			});

			if (error) {
				return fail(400, formError(error.message, submitted));
			}

			// Supabase hides an existing address behind an empty identities
			// array; tell the person to sign in rather than wait for nothing.
			if (data.user && (data.user.identities?.length ?? 0) === 0) {
				return fail(
					400,
					formError(
						'That email already has an account. Sign in first, then open this link again.',
						submitted
					)
				);
			}

			if (!data.session) {
				return fail(
					500,
					formError(
						'Your account was created but could not be signed in. Sign in, then open this link again.',
						submitted
					)
				);
			}

			const result = await applyToJoin(locals, tokenHash, parsed.data.fullName, parsed.data.phone);
			return finish(result, cookies);
		}

		// --- Already signed in: just apply ---
		const parsed = parseForm(joinOnlySchema, formData);
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const result = await applyToJoin(locals, tokenHash, parsed.data.fullName, parsed.data.phone);
		return finish(result, cookies);
	}
};

async function applyToJoin(
	locals: App.Locals,
	tokenHash: string,
	fullName: string,
	phone: string
) {
	const { data, error } = await locals.supabase.rpc('request_to_join', {
		p_token_hash: tokenHash,
		p_full_name: fullName,
		p_phone: phone
	});

	if (error) return { ok: false as const, code: 'unreachable' };
	return data as
		| { ok: true; organization_id: string; status: string; already_member?: boolean }
		| { ok: false; code: string };
}

function finish(
	result: Awaited<ReturnType<typeof applyToJoin>>,
	cookies: import('@sveltejs/kit').Cookies
) {
	if (!result.ok) {
		const messages: Record<string, string> = {
			invalid_link: 'This join link is not valid.',
			joining_closed: 'This team is not accepting new members right now.',
			request_rejected:
				'A previous request from this account was not accepted. Please speak to your manager.',
			not_authenticated: 'Your session expired. Sign in and open the link again.',
			unreachable: 'We could not reach the server. Please try again.'
		};
		return fail(400, formError(messages[result.code] ?? 'Your request could not be sent.'));
	}

	cookies.set(ACTIVE_ORG_COOKIE, result.organization_id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365
	});

	// An accepted member goes straight in; everyone else waits.
	if (result.already_member || result.status === 'active') throw redirect(303, '/app');
	return { submitted: true as const };
}
