import { error, fail, redirect } from '@sveltejs/kit';
import {
	employmentDetailsSchema,
	formError,
	formFailure,
	parseForm,
	payRateSchema
} from '$lib/schemas';
import { z } from 'zod';
import { parseAmountToCents } from '$lib/domain/earnings';
import { zonedWallTimeToUtc } from '$lib/domain/time';

const noteSchema = z.object({
	body: z.string().trim().min(1, 'Write something first').max(4000)
});

const quickTaskSchema = z.object({
	title: z.string().trim().min(1, 'Give the task a title').max(160),
	description: z.string().trim().max(2000).optional().or(z.literal('')),
	priority: z.enum(['low', 'medium', 'high']).default('medium'),
	dueAt: z.union([z.iso.date(), z.literal('')]).optional()
});
import { addDays, todayInTimeZone } from '$lib/domain/time';
import type { Actions, PageServerLoad } from './$types';
import type { OrganizationMembership, PayRate, Shift, TimeOffRequest } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals, params }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	// Scoped to this organization, so an id from elsewhere simply 404s.
	const { data: row } = await locals.supabase
		.from('organization_memberships')
		.select('*, profiles(full_name, email, phone, avatar_url)')
		.eq('id', params.id)
		.eq('organization_id', org.organization.id)
		.maybeSingle();

	if (!row) throw error(404, 'That employee is not in your organization.');

	const membership = row as unknown as OrganizationMembership & {
		profiles: { full_name: string; email: string; phone: string | null } | null;
	};

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);

	const [{ data: shifts }, { data: tasks }, { data: timeOff }, { data: rates }, { data: notes }] =
		await Promise.all([
		locals.supabase
			.from('shifts')
			.select('*')
			.eq('employee_membership_id', membership.id)
			.order('started_at', { ascending: false })
			.limit(25),

		locals.supabase
			.from('tasks')
			.select('id, title, status, priority, due_at, task_assignments!inner(employee_membership_id)')
			.eq('task_assignments.employee_membership_id', membership.id)
			.order('created_at', { ascending: false })
			.limit(15),

		locals.supabase
			.from('time_off_requests')
			.select('*')
			.eq('employee_membership_id', membership.id)
			.order('start_date', { ascending: false })
			.limit(15),

		// Pay is owner-level information in this MVP.
		org.isOwner
			? locals.supabase
					.from('pay_rates')
					.select('*')
					.eq('employee_membership_id', membership.id)
					.order('effective_from', { ascending: false })
			: Promise.resolve({ data: null }),

		locals.supabase
			.from('employee_notes')
			.select('id, body, created_at, author_user_id, profiles:author_user_id(full_name)')
			.eq('employee_membership_id', membership.id)
			.order('created_at', { ascending: false })
	]);

	const shiftRows = (shifts ?? []) as Shift[];
	const completed = shiftRows.filter((s) => s.status === 'completed');

	return {
		membership: {
			id: membership.id,
			role: membership.role,
			status: membership.status,
			jobTitle: membership.job_title,
			department: membership.department,
			employeeCode: membership.employee_code,
			startDate: membership.start_date,
			joinedAt: membership.joined_at,
			name: membership.profiles?.full_name ?? 'Unnamed',
			email: membership.profiles?.email ?? '',
			phone: membership.profiles?.phone ?? null
		},
		shifts: shiftRows.map((s) => ({
			id: s.id,
			startedAt: s.started_at,
			endedAt: s.ended_at,
			status: s.status,
			grossMinutes: s.gross_minutes,
			unpaidBreakMinutes: s.unpaid_break_minutes,
			payableMinutes: s.payable_minutes
		})),
		totals: {
			shifts: completed.length,
			payableMinutes: completed.reduce((t, s) => t + (s.payable_minutes ?? 0), 0)
		},
		tasks: (tasks ?? []).map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			priority: t.priority,
			dueAt: t.due_at
		})),
		notes: (notes ?? []).map((n) => {
			const author = n.profiles as unknown as { full_name: string } | null;
			return {
				id: n.id,
				body: n.body,
				createdAt: n.created_at,
				authorName: author?.full_name ?? 'A manager',
				isMine: n.author_user_id === org.membership.user_id
			};
		}),
		timeOff: (timeOff ?? []) as TimeOffRequest[],
		payRates: org.isOwner ? ((rates ?? []) as PayRate[]) : null,
		canSeePay: org.isOwner,
		canSetRole: org.isOwner,
		currency: org.organization.currency_code,
		defaultRateDate: today,
		tomorrow: addDays(today, 1)
	};
};

export const actions: Actions = {
	updateEmployment: async ({ request, locals, params }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(employmentDetailsSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { error: updateError } = await locals.supabase
			.from('organization_memberships')
			.update({
				job_title: parsed.data.jobTitle || null,
				department: parsed.data.department || null,
				employee_code: parsed.data.employeeCode || null,
				start_date: parsed.data.startDate || null
			})
			.eq('id', params.id)
			.eq('organization_id', org.organization.id);

		if (updateError) {
			const duplicate = updateError.message.includes('employee_code');
			return fail(
				400,
				formError(
					duplicate
						? 'That employee ID is already used by someone else.'
						: 'Those details could not be saved.'
				)
			);
		}

		return { saved: true as const };
	},

	setPayRate: async ({ request, locals, params }) => {
		const org = locals.org;
		if (!org?.isOwner) throw error(403, 'Only the owner can set pay rates.');

		const parsed = parseForm(payRateSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const cents = parseAmountToCents(parsed.data.hourlyRate);
		if (cents === null) {
			return fail(400, formFailure({ hourlyRate: ['Enter an amount such as 250.00'] }));
		}

		// The function closes the previous rate rather than overwriting it, so
		// past periods keep resolving to the rate that applied then.
		const { data, error: rpcError } = await locals.supabase.rpc('set_pay_rate', {
			p_membership: params.id,
			p_hourly_rate: cents / 100,
			p_effective_from: parsed.data.effectiveFrom,
			p_currency: org.organization.currency_code
		});

		if (rpcError) return fail(502, formError('We could not reach the server. Please try again.'));

		const result = data as { ok: boolean; code?: string };
		if (!result.ok) {
			const messages: Record<string, string> = {
				forbidden: 'Only the owner can set pay rates.',
				invalid_rate: 'That rate is not valid.',
				not_found: 'That employee no longer exists.'
			};
			return fail(400, formError(messages[result.code ?? ''] ?? 'That rate could not be saved.'));
		}

		return { rateSaved: true as const };
	},

	/** Adds an internal note about this person. Managers only, by policy. */
	addNote: async ({ request, locals, params }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(noteSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		// Confirm the membership belongs to this organization before writing
		// a row that references it.
		const { data: target } = await locals.supabase
			.from('organization_memberships')
			.select('id')
			.eq('id', params.id)
			.eq('organization_id', org.organization.id)
			.maybeSingle();

		if (!target) return fail(404, formError('That employee is not in your organization.'));

		const { error: insertError } = await locals.supabase.from('employee_notes').insert({
			organization_id: org.organization.id,
			employee_membership_id: params.id,
			author_user_id: org.membership.user_id,
			body: parsed.data.body
		});

		if (insertError) return fail(500, formError('That note could not be saved.'));
		return { noteAdded: true as const };
	},

	deleteNote: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const noteId = String((await request.formData()).get('noteId') ?? '');

		const { error: deleteError } = await locals.supabase
			.from('employee_notes')
			.delete()
			.eq('id', noteId)
			.eq('organization_id', org.organization.id);

		if (deleteError) return fail(500, formError('That note could not be removed.'));
		return { noteDeleted: true as const };
	},

	/** Creates a task and assigns it to this person in one step. */
	assignTask: async ({ request, locals, params }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(quickTaskSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { data: created, error: insertError } = await locals.supabase
			.from('tasks')
			.insert({
				organization_id: org.organization.id,
				title: parsed.data.title,
				description: parsed.data.description || null,
				priority: parsed.data.priority,
				due_at: parsed.data.dueAt
					? zonedWallTimeToUtc(parsed.data.dueAt, '17:00:00', org.organization.timezone).toISOString()
					: null,
				created_by: org.membership.user_id
			})
			.select('id')
			.single();

		if (insertError || !created) return fail(500, formError('That task could not be created.'));

		const { data, error: assignError } = await locals.supabase.rpc('set_task_assignees', {
			p_task: created.id,
			p_memberships: [params.id]
		});

		const result = data as { ok: boolean; code?: string } | null;
		if (assignError || !result?.ok) {
			return fail(400, formError('The task was created, but assigning it failed.'));
		}

		return { taskAssigned: true as const };
	},

	updateTaskStatus: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const formData = await request.formData();
		const taskId = String(formData.get('taskId') ?? '');
		const status = String(formData.get('status') ?? '');

		if (!['todo', 'in_progress', 'completed', 'cancelled'].includes(status)) {
			return fail(400, formError('That status is not recognised.'));
		}

		const { error: updateError } = await locals.supabase
			.from('tasks')
			.update({ status: status as 'todo' | 'in_progress' | 'completed' | 'cancelled' })
			.eq('id', taskId)
			.eq('organization_id', org.organization.id);

		if (updateError) return fail(500, formError('That task could not be updated.'));
		return { taskUpdated: true as const };
	},

	setRole: async ({ request, locals, params }) => {
		const org = locals.org;
		if (!org?.isOwner) throw error(403, 'Only the owner can change roles.');

		const role = String((await request.formData()).get('role') ?? '');
		if (!['owner', 'manager', 'employee'].includes(role)) {
			return fail(400, formError('That role is not recognised.'));
		}

		const { data, error: rpcError } = await locals.supabase.rpc('set_member_role', {
			p_membership: params.id,
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

		return { roleSaved: true as const };
	}
};
