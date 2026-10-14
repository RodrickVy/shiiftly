import { fail, redirect } from '@sveltejs/kit';
import { formError, parseForm, updateTaskStatusSchema } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');

	// !inner keeps this to tasks assigned to the caller; RLS enforces it too.
	const { data } = await locals.supabase
		.from('tasks')
		.select(
			'id, title, description, priority, status, due_at, completed_at, created_at, task_assignments!inner(employee_membership_id)'
		)
		.eq('task_assignments.employee_membership_id', org.membership.id)
		.order('status', { ascending: true })
		.order('due_at', { ascending: true, nullsFirst: false });

	const tasks = (data ?? []).map((t) => ({
		id: t.id,
		title: t.title,
		description: t.description,
		priority: t.priority,
		status: t.status,
		dueAt: t.due_at,
		completedAt: t.completed_at
	}));

	return {
		open: tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress'),
		done: tasks.filter((t) => t.status === 'completed' || t.status === 'cancelled')
	};
};

export const actions: Actions = {
	updateStatus: async ({ request, locals }) => {
		if (!locals.org) throw redirect(303, '/login');

		const parsed = parseForm(updateTaskStatusSchema, await request.formData());
		if (!parsed.ok) return fail(400, formError('That task update is not valid.'));

		// An employee may only move a task they are assigned, and only its
		// status: both are enforced by policy and column grant in the database.
		const { error } = await locals.supabase
			.from('tasks')
			.update({ status: parsed.data.status })
			.eq('id', parsed.data.taskId);

		if (error) return fail(500, formError('That task could not be updated.'));
		return { success: true as const };
	}
};
