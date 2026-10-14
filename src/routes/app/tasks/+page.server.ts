import { error, fail, redirect } from '@sveltejs/kit';
import { createTaskSchema, formError, formFailure, parseForm } from '$lib/schemas';
import { zonedWallTimeToUtc } from '$lib/domain/time';
import type { Actions, PageServerLoad } from './$types';
import type { Task } from '$lib/types/database';

/** Reads a `datetime-local` or date value as a wall time in `timeZone`. */
function dueAtInstant(value: string, timeZone: string): string | null {
	if (!value) return null;
	const withTime = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
	if (withTime) {
		const [, date, hh, mm] = withTime;
		return zonedWallTimeToUtc(date, `${hh}:${mm}:00`, timeZone).toISOString();
	}
	const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}$/);
	// A date with no time means end of that working day, local.
	if (dateOnly) return zonedWallTimeToUtc(value, '17:00:00', timeZone).toISOString();
	return null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const statusFilter = url.searchParams.get('status') ?? 'open';

	const { data: taskRows } = await locals.supabase
		.from('tasks')
		.select('*, task_assignments(employee_membership_id)')
		.eq('organization_id', org.organization.id)
		.order('created_at', { ascending: false })
		.limit(200);

	const { data: memberRows } = await locals.supabase
		.from('organization_memberships')
		.select('id, profiles(full_name)')
		.eq('organization_id', org.organization.id)
		.eq('status', 'active')
		.order('joined_at', { ascending: true });

	const employees = (memberRows ?? []).map((m) => ({
		id: m.id,
		name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Unnamed'
	}));
	const nameOf = new Map(employees.map((e) => [e.id, e.name]));

	type Row = Task & { task_assignments: { employee_membership_id: string }[] };

	const tasks = ((taskRows ?? []) as unknown as Row[]).map((t) => ({
		id: t.id,
		title: t.title,
		description: t.description,
		priority: t.priority,
		status: t.status,
		dueAt: t.due_at,
		completedAt: t.completed_at,
		assigneeIds: t.task_assignments.map((a) => a.employee_membership_id),
		assignees: t.task_assignments
			.map((a) => nameOf.get(a.employee_membership_id) ?? 'Unknown')
			.sort()
	}));

	const filtered =
		statusFilter === 'all'
			? tasks
			: statusFilter === 'open'
				? tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress')
				: tasks.filter((t) => t.status === statusFilter);

	return {
		tasks: filtered,
		employees,
		statusFilter,
		counts: {
			open: tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress').length,
			completed: tasks.filter((t) => t.status === 'completed').length
		}
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(createTaskSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { data: created, error: insertError } = await locals.supabase
			.from('tasks')
			.insert({
				organization_id: org.organization.id,
				title: parsed.data.title,
				description: parsed.data.description || null,
				priority: parsed.data.priority,
				due_at: parsed.data.dueAt
					? dueAtInstant(parsed.data.dueAt, org.organization.timezone)
					: null,
				created_by: org.membership.user_id
			})
			.select('id')
			.single();

		if (insertError || !created) {
			return fail(500, formError('That task could not be created.'));
		}

		if (parsed.data.assignees.length > 0) {
			// The function rejects anyone outside this organization.
			const { data, error: assignError } = await locals.supabase.rpc('set_task_assignees', {
				p_task: created.id,
				p_memberships: parsed.data.assignees
			});

			const result = data as { ok: boolean; code?: string } | null;
			if (assignError || !result?.ok) {
				return fail(
					400,
					formError(
						result?.code === 'invalid_assignee'
							? 'One of those people is not in your organization.'
							: 'The task was created, but assigning it failed.'
					)
				);
			}
		}

		return { created: true as const };
	},

	assign: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const formData = await request.formData();
		const taskId = String(formData.get('taskId') ?? '');
		const assignees = formData.getAll('assignees[]').map(String).filter(Boolean);

		const { data, error: rpcError } = await locals.supabase.rpc('set_task_assignees', {
			p_task: taskId,
			p_memberships: assignees
		});

		if (rpcError) return fail(502, formError('We could not reach the server. Please try again.'));

		const result = data as { ok: boolean; code?: string };
		if (!result.ok) {
			const messages: Record<string, string> = {
				forbidden: 'You do not have permission to change that task.',
				invalid_assignee: 'One of those people is not in your organization.',
				not_found: 'That task no longer exists.'
			};
			return fail(400, formError(messages[result.code ?? ''] ?? 'That change could not be saved.'));
		}

		return { assigned: true as const };
	},

	setStatus: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const formData = await request.formData();
		const taskId = String(formData.get('taskId') ?? '');
		const status = String(formData.get('status') ?? '');

		if (!['todo', 'in_progress', 'completed', 'cancelled'].includes(status)) {
			return fail(400, formError('That status is not recognised.'));
		}

		// completed_at is maintained by a database trigger.
		const { error: updateError } = await locals.supabase
			.from('tasks')
			.update({ status: status as 'todo' | 'in_progress' | 'completed' | 'cancelled' })
			.eq('id', taskId)
			.eq('organization_id', org.organization.id);

		if (updateError) return fail(500, formError('That task could not be updated.'));
		return { statusChanged: true as const };
	},

	delete: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const taskId = String((await request.formData()).get('taskId') ?? '');
		const { error: deleteError } = await locals.supabase
			.from('tasks')
			.delete()
			.eq('id', taskId)
			.eq('organization_id', org.organization.id);

		if (deleteError) return fail(500, formError('That task could not be deleted.'));
		return { deleted: true as const };
	}
};
