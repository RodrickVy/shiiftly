import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { emailSchema, formError, formFailure, parseForm, passwordSchema } from '$lib/schemas';
import { hashToken } from '$lib/domain/tokens';
import { createServiceClient } from '$lib/server/supabase';
import { ACTIVE_ORG_COOKIE } from '$lib/server/context';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Turns a device into a clocking station.
 *
 * The resulting account is a real sign-in (so the tablet survives a restart
 * and can be revoked centrally), but it holds the `station` role, which the
 * route guard and RLS both treat as "may display the clocking code and
 * nothing else". It cannot see employees, attendance or settings, and it
 * cannot clock anyone in -- staff do that from their own phones.
 */

const setupSchema = z
	.object({
		displayName: z.string().trim().min(1, 'Give this device a name').max(80),
		description: z.string().trim().max(200).optional().or(z.literal('')),
		email: emailSchema,
		password: passwordSchema,
		confirmPassword: z.string()
	})
	.refine((v) => v.password === v.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

async function previewStation(rawToken: string) {
	const tokenHash = await hashToken(rawToken);
	const { data } = await createServiceClient()
		.from('clocking_stations')
		.select('id, name, description, is_active, membership_id, organizations(name)')
		.eq('claim_token_hash', tokenHash)
		.maybeSingle();

	if (!data) return { state: 'invalid' as const };
	if (data.membership_id) return { state: 'claimed' as const, name: data.name };
	if (!data.is_active) return { state: 'disabled' as const, name: data.name };

	const org = data.organizations as unknown as { name: string } | null;
	return {
		state: 'open' as const,
		name: data.name,
		description: data.description,
		organizationName: org?.name ?? 'this organization'
	};
}

export const load: PageServerLoad = async ({ params }) => {
	return { preview: await previewStation(params.token) };
};

export const actions: Actions = {
	default: async ({ params, request, locals, cookies, getClientAddress }) => {
		const limit = rateLimit(limiterKey('station-setup', { ip: getClientAddress() }), 10, 900);
		if (!limit.allowed) {
			return fail(429, formError(`Too many attempts. Wait ${limit.retryAfterSeconds} seconds.`));
		}

		const parsed = parseForm(setupSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		// Re-rendered if a later step fails; never includes a password.
		const submitted = {
			displayName: parsed.data.displayName,
			description: parsed.data.description ?? '',
			email: parsed.data.email
		};

		const tokenHash = await hashToken(params.token);
		const service = createServiceClient();

		// Re-check the link now, so two devices racing the same link cannot
		// both get through: claim_station takes a row lock below.
		const preview = await previewStation(params.token);
		if (preview.state !== 'open') {
			const messages = {
				invalid: 'This setup link is not valid.',
				claimed: 'This station has already been set up on another device.',
				disabled: 'This station has been disabled.'
			} as const;
			return fail(400, formError(messages[preview.state]));
		}

		/**
		 * The account is created with the service role and confirmed
		 * immediately: a tablet by the door has no inbox, so an email
		 * confirmation step would make a station impossible to set up.
		 */
		const { data: created, error: createError } = await service.auth.admin.createUser({
			email: parsed.data.email,
			password: parsed.data.password,
			email_confirm: true,
			user_metadata: { full_name: parsed.data.displayName, is_station: true }
		});

		if (createError || !created.user) {
			const duplicate = /already|registered|exists/i.test(createError?.message ?? '');
			return fail(
				400,
				formError(
					duplicate
						? 'That email is already in use. Use a different one for this device.'
						: `The device account could not be created: ${createError?.message ?? 'unknown error'}`,
					submitted
				)
			);
		}

		const { data: claimed, error: claimError } = await service.rpc('claim_station', {
			p_token_hash: tokenHash,
			p_user_id: created.user.id,
			p_display_name: parsed.data.displayName,
			p_description: parsed.data.description || null
		});

		const result = claimed as { ok: boolean; code?: string; organization_id?: string } | null;

		if (claimError || !result?.ok) {
			// Leave no orphan login behind if linking failed.
			await service.auth.admin.deleteUser(created.user.id).catch(() => {});
			const messages: Record<string, string> = {
				invalid_link: 'This setup link is not valid.',
				already_claimed: 'This station has already been set up on another device.',
				station_disabled: 'This station has been disabled.'
			};
			return fail(
				400,
				formError(messages[result?.code ?? ''] ?? 'This device could not be set up.', submitted)
			);
		}

		// Sign the device in so it goes straight to the clocking screen.
		const { error: signInError } = await locals.supabase.auth.signInWithPassword({
			email: parsed.data.email,
			password: parsed.data.password
		});

		if (signInError) {
			return fail(
				500,
				formError('This device was set up. Sign in with the details you just chose.', submitted)
			);
		}

		cookies.set(ACTIVE_ORG_COOKIE, result.organization_id!, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});

		throw redirect(303, '/station');
	}
};
