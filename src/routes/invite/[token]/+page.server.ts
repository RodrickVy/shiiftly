import { fail, redirect } from '@sveltejs/kit';
import { acceptInvitationSchema, formError, formFailure, parseForm } from '$lib/schemas';
import { hashToken } from '$lib/domain/tokens';
import { createServiceClient } from '$lib/server/supabase';
import { ACTIVE_ORG_COOKIE } from '$lib/server/context';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Invitation landing page.
 *
 * Readable while signed out, so an invitee can see who invited them before
 * creating an account. Redemption itself is an authenticated, atomic SQL
 * operation (accept_invitation) that takes the role from the stored row --
 * nothing the invitee submits can change which role they receive.
 */

type Preview =
	| { state: 'invalid' }
	| { state: 'expired' }
	| { state: 'revoked' }
	| { state: 'exhausted' }
	| { state: 'valid'; organizationName: string; role: string; boundEmail: string | null };

async function previewInvitation(rawToken: string): Promise<Preview> {
	const tokenHash = await hashToken(rawToken);

	// The service client is needed because an invitee is not yet a member and
	// so cannot read the invitation row under RLS. Only non-sensitive
	// descriptive fields are surfaced.
	const service = createServiceClient();
	const { data, error } = await service
		.from('invitations')
		.select('role, invited_email, max_uses, use_count, expires_at, revoked_at, organizations(name)')
		.eq('token_hash', tokenHash)
		.maybeSingle();

	if (error || !data) return { state: 'invalid' };
	if (data.revoked_at) return { state: 'revoked' };
	if (new Date(data.expires_at).getTime() <= Date.now()) return { state: 'expired' };
	if (data.use_count >= data.max_uses) return { state: 'exhausted' };

	const organization = data.organizations as unknown as { name: string } | null;

	return {
		state: 'valid',
		organizationName: organization?.name ?? 'an organization',
		role: data.role,
		boundEmail: data.invited_email
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const preview = await previewInvitation(params.token);

	return {
		preview,
		signedIn: Boolean(locals.user),
		currentEmail: locals.user?.email ?? null,
		suggestedName: (locals.user?.user_metadata?.full_name as string) ?? ''
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals, cookies, getClientAddress }) => {
		if (!locals.user) {
			throw redirect(303, `/signup?next=/invite/${params.token}`);
		}

		// Invitation tokens are unguessable, but throttle anyway so this
		// endpoint cannot be used to probe for valid ones.
		const limit = rateLimit(
			limiterKey('invite-accept', { userId: locals.user.id, ip: getClientAddress() }),
			15,
			600
		);
		if (!limit.allowed) {
			return fail(429, formError(`Too many attempts. Wait ${limit.retryAfterSeconds} seconds.`));
		}

		const parsed = parseForm(acceptInvitationSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const tokenHash = await hashToken(params.token);

		const { data, error } = await locals.supabase.rpc('accept_invitation', {
			p_token_hash: tokenHash,
			p_full_name: parsed.data.fullName,
			p_phone: parsed.data.phone
		});

		if (error) {
			return fail(502, formError('We could not reach the server. Please try again.'));
		}

		const result = data as { ok: boolean; code?: string; organization_id?: string };

		if (!result.ok) {
			const messages: Record<string, string> = {
				invalid_invitation: 'This invitation link is not valid.',
				invitation_revoked: 'This invitation has been revoked.',
				invitation_expired: 'This invitation has expired.',
				invitation_exhausted: 'This invitation has already been used.',
				invitation_email_mismatch:
					'This invitation was sent to a different email address. Sign in with that address to accept it.',
				not_authenticated: 'Your session has expired. Sign in and open the link again.'
			};
			return fail(
				400,
				formError(messages[result.code ?? ''] ?? 'This invitation could not be accepted.')
			);
		}

		cookies.set(ACTIVE_ORG_COOKIE, result.organization_id!, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});

		throw redirect(303, '/app');
	}
};
