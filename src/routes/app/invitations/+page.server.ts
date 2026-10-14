import { error, fail, redirect } from '@sveltejs/kit';
import { createInvitationSchema, formError, formFailure, parseForm } from '$lib/schemas';
import { deriveInvitationToken, hashToken, invitationUrl } from '$lib/domain/tokens';
import { getConfig } from '$lib/server/env';
import { sendDirectEmail } from '$lib/server/email';
import { hasEmailProvider } from '$lib/server/env';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';
import type { Invitation } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const { data } = await locals.supabase
		.from('invitations')
		.select('*')
		.eq('organization_id', org.organization.id)
		.order('created_at', { ascending: false })
		.limit(50);

	const invitations = (data ?? []) as Invitation[];
	const now = Date.now();

	return {
		origin: url.origin,
		emailConfigured: hasEmailProvider(),
		canInviteManagers: org.isOwner,
		invitations: invitations.map((i) => ({
			id: i.id,
			role: i.role,
			invitedEmail: i.invited_email,
			maxUses: i.max_uses,
			useCount: i.use_count,
			expiresAt: i.expires_at,
			revokedAt: i.revoked_at,
			createdAt: i.created_at,
			status: i.revoked_at
				? ('revoked' as const)
				: new Date(i.expires_at).getTime() <= now
					? ('expired' as const)
					: i.use_count >= i.max_uses
						? ('used' as const)
						: ('active' as const)
		}))
	};
};

export const actions: Actions = {
	create: async ({ request, locals, url, getClientAddress }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const limit = rateLimit(
			limiterKey('invite', { userId: locals.user?.id, ip: getClientAddress() }),
			30,
			3600
		);
		if (!limit.allowed) {
			return fail(429, formError('Too many invitations created. Try again shortly.'));
		}

		const parsed = parseForm(createInvitationSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		// Only an owner may create an invitation that grants manager rights.
		if (parsed.data.role === 'manager' && !org.isOwner) {
			return fail(403, formError('Only the owner can invite managers.'));
		}

		/**
		 * The token is derived from the row id, so the QR code can be put
		 * back on screen tomorrow without the database ever storing a working
		 * link. The id is generated here so the token and its hash can be
		 * written in a single insert.
		 */
		const invitationId = crypto.randomUUID();
		const raw = await deriveInvitationToken(getConfig().qrTokenSecret, invitationId);
		const tokenHash = await hashToken(raw);
		const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400_000);

		const { error: insertError } = await locals.supabase.from('invitations').insert({
			id: invitationId,
			organization_id: org.organization.id,
			token_hash: tokenHash,
			invited_email: parsed.data.email || null,
			role: parsed.data.role,
			max_uses: parsed.data.maxUses,
			expires_at: expiresAt.toISOString(),
			created_by: org.membership.user_id
		});

		if (insertError) {
			return fail(500, formError(`Could not create the invitation: ${insertError.message}`));
		}

		const link = invitationUrl(url.origin, raw);
		let emailed: 'sent' | 'failed' | 'skipped' = 'skipped';

		if (parsed.data.email) {
			const result = await sendDirectEmail({
				to: parsed.data.email,
				subject: `You have been invited to join ${org.organization.name} on Shiftly`,
				text:
					`${org.organization.name} invited you to join their team on Shiftly.\n\n` +
					`Open this link to accept:\n${link}\n\n` +
					`The link expires on ${expiresAt.toISOString().slice(0, 10)}.`
			});
			emailed = result.ok ? 'sent' : 'failed';
		}

		return { created: true as const, link, emailed, invitationId };
	},

	revoke: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const invitationId = String((await request.formData()).get('invitationId') ?? '');
		if (!invitationId) return fail(400, formError('No invitation was specified.'));

		const { error: updateError } = await locals.supabase
			.from('invitations')
			.update({ revoked_at: new Date().toISOString() })
			.eq('id', invitationId)
			.eq('organization_id', org.organization.id)
			.is('revoked_at', null);

		if (updateError) {
			return fail(500, formError(`Could not revoke the invitation: ${updateError.message}`));
		}

		return { revoked: true as const };
	}
};
