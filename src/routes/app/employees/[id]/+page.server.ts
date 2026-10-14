import { error, fail, redirect } from '@sveltejs/kit';
import {
	employmentDetailsSchema,
	formError,
	formFailure,
	parseForm,
	payRateSchema
} from '$lib/schemas';
import { parseAmountToCents } from '$lib/domain/earnings';
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

	const [{ data: shifts }, { data: tasks }, { data: timeOff }, { data: rates }] = await Promise.all([
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
			: Promise.resolve({ data: null })
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
		tasks: tasks ?? [],
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
