import { error, fail, redirect } from '@sveltejs/kit';
import { formError } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const search = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const statusFilter = url.searchParams.get('status') ?? 'active';
	const roleFilter = url.searchParams.get('role') ?? 'all';

	let query = locals.supabase
		.from('organization_memberships')
		.select('*, profiles(full_name, email, phone)')
		.eq('organization_id', org.organization.id)
		.order('joined_at', { ascending: true });

	if (statusFilter !== 'all') query = query.eq('status', statusFilter as 'active' | 'inactive');
	if (roleFilter !== 'all') {
		query = query.eq('role', roleFilter as 'owner' | 'manager' | 'employee');
	}

	const { data: rows } = await query;

	type Row = {
		id: string;
		role: string;
		status: string;
		job_title: string | null;
		department: string | null;
		employee_code: string | null;
		joined_at: string;
		profiles: { full_name: string; email: string; phone: string | null } | null;
	};
	const memberships = (rows ?? []) as unknown as Row[];

	// Who is on shift right now, so the list can show live status.
	const { data: activeShifts } = await locals.supabase
		.from('shifts')
		.select('id, employee_membership_id')
		.eq('organization_id', org.organization.id)
		.eq('status', 'active');

	const activeByMembership = new Map(
		(activeShifts ?? []).map((s) => [s.employee_membership_id, s.id])
	);

	const openBreakShiftIds = new Set(
		activeShifts && activeShifts.length
			? (
					(
						await locals.supabase
							.from('break_records')
							.select('shift_id')
							.in(
								'shift_id',
								activeShifts.map((s) => s.id)
							)
							.is('ended_at', null)
					).data ?? []
				).map((b) => b.shift_id)
			: []
	);

	const employees = memberships
		.map((m) => {
			const shiftId = activeByMembership.get(m.id);
			return {
				id: m.id,
				name: m.profiles?.full_name ?? 'Unnamed',
				email: m.profiles?.email ?? '',
				phone: m.profiles?.phone ?? null,
				role: m.role,
				status: m.status,
				jobTitle: m.job_title,
				department: m.department,
				employeeCode: m.employee_code,
				joinedAt: m.joined_at,
				attendance: shiftId
					? openBreakShiftIds.has(shiftId)
						? ('on_break' as const)
						: ('working' as const)
					: ('not_clocked_in' as const)
			};
		})
		// Searching on the server would need a join filter; the list is small
		// enough (2-50 people) that filtering here is simpler and exact.
		.filter((e) =>
			search
				? e.name.toLowerCase().includes(search) ||
					e.email.toLowerCase().includes(search) ||
					(e.jobTitle ?? '').toLowerCase().includes(search) ||
					(e.department ?? '').toLowerCase().includes(search)
				: true
		);

	return {
		employees,
		filters: { q: url.searchParams.get('q') ?? '', status: statusFilter, role: roleFilter },
		isOwner: org.isOwner
	};
};

export const actions: Actions = {
	setStatus: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const formData = await request.formData();
		const membershipId = String(formData.get('membershipId') ?? '');
		const status = String(formData.get('status') ?? '');

		if (status !== 'active' && status !== 'inactive') {
			return fail(400, formError('That status is not recognised.'));
		}

		// Authorization, the last-owner guard and the audit entry all live in
		// the database function.
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

		return { success: true as const };
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
				last_owner: 'An organization must keep at least one active owner.'
			};
			return fail(400, formError(messages[result.code ?? ''] ?? 'That change could not be made.'));
		}

		return { success: true as const };
	}
};
