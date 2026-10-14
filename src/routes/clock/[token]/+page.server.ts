import { fail, redirect } from '@sveltejs/kit';
import { hashToken } from '$lib/domain/tokens';
import { describeScannedCode } from '$lib/server/stations';
import { clockErrorMessage, getActiveShift } from '$lib/server/attendance';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import { formError } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';
import type { OrganizationMembership } from '$lib/types/database';

/**
 * Where a station QR scan lands.
 *
 * The page shows what will happen and waits for a confirmation -- the scan
 * itself never decides whether this is a clock-in or a clock-out, and never
 * records anything on its own.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	// Unauthenticated visitors are sent to sign in and returned here; see
	// hooks.server.ts. Reaching this point means there is a user.
	if (!locals.user) throw redirect(303, `/login?next=/clock/${params.token}`);

	const scan = await describeScannedCode(params.token);

	if (!scan.ok) {
		return {
			valid: false as const,
			organizationName: null,
			action: null,
			shift: null,
			idempotencyKey: null
		};
	}

	// The membership that matters is the one in the scanned station's
	// organization, not whichever organization is currently selected.
	const { data: membershipRow } = await locals.supabase
		.from('organization_memberships')
		.select('*')
		.eq('organization_id', scan.organizationId)
		.eq('user_id', locals.user.id)
		.eq('status', 'active')
		.neq('role', 'station')
		.maybeSingle();

	const membership = membershipRow as OrganizationMembership | null;

	if (!membership) {
		return {
			valid: true as const,
			notAMember: true,
			organizationName: scan.organizationName,
			action: null,
			shift: null,
			idempotencyKey: null
		};
	}

	const shift = await getActiveShift(locals.supabase, membership.id);

	return {
		valid: true as const,
		notAMember: false,
		organizationName: scan.organizationName,
		// On a break the employee must end it first, so no action is offered.
		action: shift ? (shift.onBreakSince ? null : ('clock_out' as const)) : ('clock_in' as const),
		shift: shift ? { startedAt: shift.startedAt, onBreakSince: shift.onBreakSince } : null,
		// Rendered into the form so a double submission is absorbed rather
		// than producing a second record.
		idempotencyKey: crypto.randomUUID()
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals, getClientAddress }) => {
		if (!locals.user) throw redirect(303, `/login?next=/clock/${params.token}`);

		const limit = rateLimit(
			limiterKey('clock', { userId: locals.user.id, ip: getClientAddress() }),
			20,
			60
		);
		if (!limit.allowed) {
			return fail(429, formError(`Too many attempts. Wait ${limit.retryAfterSeconds} seconds.`));
		}

		const formData = await request.formData();
		const intent = String(formData.get('intent') ?? '');
		const idempotencyKey = String(formData.get('idempotencyKey') ?? '') || null;

		if (intent !== 'clock_in' && intent !== 'clock_out') {
			return fail(400, formError('That action is not recognised.'));
		}

		const tokenHash = await hashToken(params.token);

		// The SQL function re-validates the token, the local day, the station
		// and the membership inside the same transaction as the write.
		const { data, error: rpcError } = await locals.supabase.rpc(
			intent === 'clock_in' ? 'clock_in_with_token' : 'clock_out_with_token',
			{ p_token_hash: tokenHash, p_idempotency_key: idempotencyKey }
		);

		if (rpcError) {
			// Never report success for something the server did not confirm.
			return fail(502, formError('We could not reach the server. Check your connection and try again.'));
		}

		const result = data as
			| { ok: true; shift_id: string; started_at?: string; ended_at?: string; payable_minutes?: number }
			| { ok: false; code: string };

		if (!result.ok) {
			return fail(400, formError(clockErrorMessage(result.code)));
		}

		return {
			success: true as const,
			intent,
			startedAt: result.started_at ?? null,
			endedAt: result.ended_at ?? null,
			payableMinutes: result.payable_minutes ?? null
		};
	}
};
