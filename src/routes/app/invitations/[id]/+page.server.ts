import { error, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { deriveInvitationToken, invitationUrl } from '$lib/domain/tokens';
import { getConfig } from '$lib/server/env';
import type { PageServerLoad } from './$types';
import type { Invitation } from '$lib/types/database';

/**
 * A scannable invitation.
 *
 * Because the token is derived from the row id rather than stored, this page
 * can regenerate the same code on any day -- so a manager can print it, pin
 * it to a noticeboard, or put it on a tablet at induction, and people sign
 * themselves up by scanning it.
 *
 * Revocation and expiry still bite: the token resolves to this row, and the
 * row is what `accept_invitation` validates.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const { data } = await locals.supabase
		.from('invitations')
		.select('*')
		.eq('id', params.id)
		.eq('organization_id', org.organization.id)
		.maybeSingle();

	if (!data) throw error(404, 'That invitation does not exist.');
	const invitation = data as Invitation;

	const expired = new Date(invitation.expires_at).getTime() <= Date.now();
	const exhausted = invitation.use_count >= invitation.max_uses;
	const usable = !invitation.revoked_at && !expired && !exhausted;

	const raw = await deriveInvitationToken(getConfig().qrTokenSecret, invitation.id);
	const link = invitationUrl(url.origin, raw);

	// Only render a scannable code for an invitation that would actually
	// work; a QR that fails on scan is worse than no QR.
	const qrDataUrl = usable
		? await QRCode.toDataURL(link, {
				errorCorrectionLevel: 'M',
				margin: 1,
				width: 1024,
				color: { dark: '#111827', light: '#ffffff' }
			})
		: null;

	return {
		invitation: {
			id: invitation.id,
			role: invitation.role,
			invitedEmail: invitation.invited_email,
			maxUses: invitation.max_uses,
			useCount: invitation.use_count,
			expiresAt: invitation.expires_at,
			revokedAt: invitation.revoked_at
		},
		organizationName: org.organization.name,
		link,
		qrDataUrl,
		status: invitation.revoked_at
			? ('revoked' as const)
			: expired
				? ('expired' as const)
				: exhausted
					? ('used' as const)
					: ('active' as const)
	};
};
