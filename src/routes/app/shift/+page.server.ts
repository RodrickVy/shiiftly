import { fail, redirect } from '@sveltejs/kit';
import {
	breakPolicyFrom,
	clockErrorMessage,
	getActiveShift,
	toIntervals
} from '$lib/server/attendance';
import { payableMinutes } from '$lib/domain/attendance';
import { formError } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';
import type { Task } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');

	const shift = await getActiveShift(locals.supabase, org.membership.id);

	// Without an open shift there is nothing to show; Home explains the state.
	if (!shift) {
		const { data: last } = await locals.supabase
			.from('shifts')
			.select('id, started_at, ended_at, gross_minutes, unpaid_break_minutes, payable_minutes')
			.eq('employee_membership_id', org.membership.id)
			.eq('status', 'completed')
			.order('started_at', { ascending: false })
			.limit(1)
			.maybeSingle();

		return {
			serverNow: new Date().toISOString(),
			shift: null,
			lastShift: last ?? null,
			tasks: [],
			breakMode: org.settings.break_mode,
			directEnabled: org.settings.direct_clocking_enabled,
			qrEnabled: org.settings.qr_clocking_enabled,
			projected: null,
			completedBreakSeconds: 0,
			idempotencyKey: crypto.randomUUID()
		};
	}

	const { data: taskRows } = await locals.supabase
		.from('tasks')
		.select('id, title, priority, status, due_at, task_assignments!inner(employee_membership_id)')
		.eq('task_assignments.employee_membership_id', org.membership.id)
		.in('status', ['todo', 'in_progress'])
		.order('due_at', { ascending: true, nullsFirst: false });

	const policy = breakPolicyFrom(org.settings);

	return {
		serverNow: new Date().toISOString(),
		shift,
		lastShift: null,
		tasks: (taskRows ?? []) as Pick<Task, 'id' | 'title' | 'priority' | 'status' | 'due_at'>[],
		breakMode: org.settings.break_mode,
		directEnabled: org.settings.direct_clocking_enabled,
		qrEnabled: org.settings.qr_clocking_enabled,
		projected: payableMinutes(
			policy,
			new Date(shift.startedAt),
			new Date(),
			toIntervals(shift.breaks)
		),
		completedBreakSeconds: shift.breaks
			.filter((b) => b.endedAt)
			.reduce(
				(total, b) =>
					total +
					Math.floor((new Date(b.endedAt!).getTime() - new Date(b.startedAt).getTime()) / 1000),
				0
			),
		idempotencyKey: crypto.randomUUID()
	};
};

export const actions: Actions = {
	clock: async ({ request, locals }) => {
		const org = locals.org;
		if (!org) throw redirect(303, '/login');

		const formData = await request.formData();
		const intent = String(formData.get('intent') ?? '');
		const key = String(formData.get('idempotencyKey') ?? '') || null;
		if (intent !== 'clock_out') return fail(400, formError('That action is not recognised.'));

		const { data, error } = await locals.supabase.rpc('clock_out_direct', {
			p_org: org.organization.id,
			p_idempotency_key: key
		});

		if (error) {
			return fail(502, formError('We could not reach the server. Check your connection and try again.'));
		}
		const result = data as { ok: boolean; code?: string };
		if (!result.ok) return fail(400, formError(clockErrorMessage(result.code ?? '')));

		throw redirect(303, '/app/home');
	},

	break: async ({ request, locals }) => {
		const org = locals.org;
		if (!org) throw redirect(303, '/login');

		const intent = String((await request.formData()).get('intent') ?? '');
		const fn = intent === 'start' ? 'start_break' : intent === 'end' ? 'end_break' : null;
		if (!fn) return fail(400, formError('That action is not recognised.'));

		const { data, error } = await locals.supabase.rpc(fn, { p_org: org.organization.id });
		if (error) {
			return fail(502, formError('We could not reach the server. Check your connection and try again.'));
		}
		const result = data as { ok: boolean; code?: string };
		if (!result.ok) return fail(400, formError(clockErrorMessage(result.code ?? '')));

		return { success: true as const };
	},

	updateTask: async ({ request, locals }) => {
		const org = locals.org;
		if (!org) throw redirect(303, '/login');

		const formData = await request.formData();
		const taskId = String(formData.get('taskId') ?? '');
		const status = String(formData.get('status') ?? '');

		if (!['todo', 'in_progress', 'completed'].includes(status)) {
			return fail(400, formError('That status is not recognised.'));
		}

		// RLS limits this to tasks assigned to the caller, and the column
		// grant limits it to `status` alone.
		const { error } = await locals.supabase
			.from('tasks')
			.update({ status: status as 'todo' | 'in_progress' | 'completed' })
			.eq('id', taskId);

		if (error) return fail(500, formError('That task could not be updated.'));
		return { success: true as const };
	}
};
