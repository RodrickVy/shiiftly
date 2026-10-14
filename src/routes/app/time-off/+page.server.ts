import { error, fail, redirect } from '@sveltejs/kit';
import { formError, formFailure, parseForm, reviewTimeOffSchema } from '$lib/schemas';
import { flushPendingEmailsInBackground } from '$lib/server/email';
import type { Actions, PageServerLoad } from './$types';
import type { TimeOffRequest } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const statusFilter = url.searchParams.get('status') ?? 'pending';

	let query = locals.supabase
		.from('time_off_requests')
		.select('*, organization_memberships(id, profiles(full_name))')
		.eq('organization_id', org.organization.id)
		.order('created_at', { ascending: false })
		.limit(200);

	if (statusFilter !== 'all') {
		query = query.eq(
			'status',
			statusFilter as 'pending' | 'approved' | 'rejected' | 'cancelled'
		);
	}

	const { data } = await query;

	type Row = TimeOffRequest & {
		organization_memberships: { id: string; profiles: { full_name: string } | null } | null;
	};

	const requests = ((data ?? []) as unknown as Row[]).map((r) => ({
		id: r.id,
		membershipId: r.employee_membership_id,
		name: r.organization_memberships?.profiles?.full_name ?? 'Unnamed',
		leaveType: r.leave_type,
		startDate: r.start_date,
		endDate: r.end_date,
		reason: r.reason,
		status: r.status,
		managerComment: r.manager_comment,
		reviewedAt: r.reviewed_at,
		createdAt: r.created_at,
		// A manager cannot decide their own request; an owner can.
		isOwnRequest: r.employee_membership_id === org.membership.id
	}));

	const { count: pendingCount } = await locals.supabase
		.from('time_off_requests')
		.select('id', { count: 'exact', head: true })
		.eq('organization_id', org.organization.id)
		.eq('status', 'pending');

	return {
		requests,
		statusFilter,
		pendingCount: pendingCount ?? 0,
		isOwner: org.isOwner
	};
};

export const actions: Actions = {
	review: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(reviewTimeOffSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		// The decision, the employee's notification and the audit entry are
		// written in one transaction inside the database function.
		const { data, error: rpcError } = await locals.supabase.rpc('review_time_off_request', {
			p_request: parsed.data.requestId,
			p_status: parsed.data.decision,
			p_comment: parsed.data.comment || null
		});

		if (rpcError) return fail(502, formError('We could not reach the server. Please try again.'));

		const result = data as { ok: boolean; code?: string };
		if (!result.ok) {
			const messages: Record<string, string> = {
				forbidden: 'You do not have permission to decide this request.',
				cannot_review_own_request:
					'You cannot decide your own request. Ask the owner or another manager.',
				already_reviewed: 'That request has already been decided.',
				not_found: 'That request no longer exists.',
				invalid_status: 'That decision is not recognised.'
			};
			return fail(400, formError(messages[result.code ?? ''] ?? 'That decision could not be saved.'));
		}

		// The decision is already durable; email is attempted afterwards.
		flushPendingEmailsInBackground();

		return { reviewed: parsed.data.decision };
	}
};
