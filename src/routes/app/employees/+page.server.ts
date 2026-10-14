import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { formError, parseForm } from '$lib/schemas';
import { getJoinToken, rotateJoinToken } from '$lib/server/stations';
import { joinUrl } from '$lib/domain/tokens';
import { createServiceClient } from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';

const reviewSchema = z.object({
	membershipId: z.uuid(),
	decision: z.enum(['accept', 'reject']),
	role: z.enum(['employee', 'manager']).default('employee')
});

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const tab = url.searchParams.get('tab') === 'requests' ? 'requests' : 'team';
	const search = (url.searchParams.get('q') ?? '').trim().toLowerCase();

	const { data: rows } = await locals.supabase
		.from('organization_memberships')
		.select('*, profiles(full_name, email, phone)')
		.eq('organization_id', org.organization.id)
		.order('created_at', { ascending: false });

	type Row = {
		id: string;
		role: string;
		status: string;
		job_title: string | null;
		department: string | null;
		joined_at: string;
		created_at: string;
		profiles: { full_name: string; email: string; phone: string | null } | null;
	};
	const all = (rows ?? []) as unknown as Row[];

	// Who is on shift right now, for the live column.
	const { data: activeShifts } = await locals.supabase
		.from('shifts')
		.select('id, employee_membership_id')
		.eq('organization_id', org.organization.id)
		.eq('status', 'active');

	const onShift = new Map((activeShifts ?? []).map((s) => [s.employee_membership_id, s.id]));
	const openBreaks = new Set(
		activeShifts && activeShifts.length
			? (
					(
						await locals.supabase
							.from('break_records')
							.select('shift_id')
							.in('shift_id', activeShifts.map((s) => s.id))
							.is('ended_at', null)
					).data ?? []
				).map((b) => b.shift_id)
			: []
	);

	const shape = (m: Row) => {
		const shiftId = onShift.get(m.id);
		return {
			id: m.id,
			name: m.profiles?.full_name ?? 'Unnamed',
			email: m.profiles?.email ?? '',
			phone: m.profiles?.phone ?? null,
			role: m.role,
			status: m.status,
			jobTitle: m.job_title,
			department: m.department,
			joinedAt: m.joined_at,
			requestedAt: m.created_at,
			attendance: shiftId
				? openBreaks.has(shiftId)
					? ('on_break' as const)
					: ('working' as const)
				: ('not_clocked_in' as const)
		};
	};

	// Station devices are not people and never appear in the team list.
	const people = all.filter((m) => m.role !== 'station');

	const team = people
		.filter((m) => m.status === 'active' || m.status === 'inactive')
		.map(shape)
		.filter((e) =>
			search
				? e.name.toLowerCase().includes(search) ||
					e.email.toLowerCase().includes(search) ||
					(e.jobTitle ?? '').toLowerCase().includes(search)
				: true
		);

	const requests = people.filter((m) => m.status === 'pending').map(shape);

	const joinRaw = await getJoinToken(org.organization);

	return {
		tab,
		team,
		requests,
		search: url.searchParams.get('q') ?? '',
		isOwner: org.isOwner,
		joinLink: joinUrl(url.origin, joinRaw),
		joinEnabled: org.organization.join_enabled
	};
};

export const actions: Actions = {
	/** Accept or reject someone who used the join link. */
	review: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(reviewSchema, await request.formData());
		if (!parsed.ok) return fail(400, formError('That decision could not be read.'));

		const { data, error: rpcError } = await locals.supabase.rpc('review_join_request', {
			p_membership: parsed.data.membershipId,
			p_decision: parsed.data.decision,
			p_role: parsed.data.role
		});

		if (rpcError) return fail(502, formError('We could not reach the server. Please try again.'));

		const result = data as { ok: boolean; code?: string };
		if (!result.ok) {
			const messages: Record<string, string> = {
				forbidden: 'You do not have permission to decide this request.',
				owner_required_for_manager: 'Only the owner can accept somebody as a manager.',
				already_reviewed: 'That request has already been decided.',
				not_found: 'That request no longer exists.',
				invalid_role: 'That role cannot be assigned here.'
			};
			return fail(400, formError(messages[result.code ?? ''] ?? 'That decision could not be saved.'));
		}

		return { reviewed: parsed.data.decision };
	},

	setStatus: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const formData = await request.formData();
		const membershipId = String(formData.get('membershipId') ?? '');
		const status = String(formData.get('status') ?? '');

		if (status !== 'active' && status !== 'inactive') {
			return fail(400, formError('That status is not recognised.'));
		}

		const { data, error: rpcError } = await locals.supabase.rpc('set_member_status', {
			p_membership: membershipId,
			p_status: status
		});

		if (rpcError) return fail(502, formError('We could not reach the server. Please try again.'));

		const result = data as { ok: boolean; code?: string };
		if (!result.ok) {
			const messages: Record<string, string> = {
				forbidden: 'You do not have permission to change that member.',
				last_owner: 'An organization must keep at least one active owner.',
				not_found: 'That member no longer exists.'
			};
			return fail(400, formError(messages[result.code ?? ''] ?? 'That change could not be made.'));
		}

		return { statusChanged: true as const };
	},

	setRole: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isOwner) throw error(403, 'Only the owner can change roles.');

		const formData = await request.formData();
		const membershipId = String(formData.get('membershipId') ?? '');
		const role = String(formData.get('role') ?? '');

		if (!['owner', 'manager', 'employee'].includes(role)) {
			return fail(400, formError('That role is not recognised.'));
		}

		const { data, error: rpcError } = await locals.supabase.rpc('set_member_role', {
			p_membership: membershipId,
			p_role: role as 'owner' | 'manager' | 'employee'
		});

		if (rpcError) return fail(502, formError('We could not reach the server. Please try again.'));

		const result = data as { ok: boolean; code?: string };
		if (!result.ok) {
			const messages: Record<string, string> = {
				forbidden: 'Only the owner can change roles.',
				last_owner: 'An organization must keep at least one active owner.',
				station_role_fixed: 'A station device cannot be given a person’s role.',
				still_pending: 'Accept this person first, choosing their role as you do.'
			};
			return fail(400, formError(messages[result.code ?? ''] ?? 'That change could not be made.'));
		}

		return { roleChanged: true as const };
	},

	/** Replaces the join link, so an old one stops working. */
	rotateLink: async ({ locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		await rotateJoinToken(org.organization.id, org.organization.join_token_version);
		return { rotated: true as const };
	},

	setJoinEnabled: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const enabled = String((await request.formData()).get('enabled') ?? '') === 'true';

		// Direct updates to `organizations` are owner-only under RLS, because
		// that row also carries timezone and currency. Opening and closing
		// the join link is a manager's job, so it goes through the service
		// client -- after the isManager check above.
		const { error: updateError } = await createServiceClient()
			.from('organizations')
			.update({ join_enabled: enabled })
			.eq('id', org.organization.id);

		if (updateError) return fail(500, formError('That setting could not be saved.'));
		return { joinToggled: enabled };
	}
};
