import { fail, redirect } from '@sveltejs/kit';
import { formError, formFailure, parseForm, timeOffRequestSchema } from '$lib/schemas';
import { flushPendingEmailsInBackground } from '$lib/server/email';
import type { Actions, PageServerLoad } from './$types';
import type { TimeOffRequest } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');

	const { data } = await locals.supabase
		.from('time_off_requests')
		.select('*')
		.eq('employee_membership_id', org.membership.id)
		.order('start_date', { ascending: false })
		.limit(100);

	return { requests: (data ?? []) as TimeOffRequest[] };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const org = locals.org;
		if (!org) throw redirect(303, '/login');

		const parsed = parseForm(timeOffRequestSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		// The request and the managers' notifications are written together.
		const { data, error } = await locals.supabase.rpc('submit_time_off_request', {
			p_org: org.organization.id,
			p_leave_type: parsed.data.leaveType,
			p_start: parsed.data.startDate,
			p_end: parsed.data.endDate,
			p_reason: parsed.data.reason || null
		});

		if (error) {
			return fail(502, formError('We could not reach the server. Please try again.'));
		}

		const result = data as { ok: boolean; code?: string };
		if (!result.ok) {
			const messages: Record<string, string> = {
				invalid_date_range: 'The end date cannot be before the start date.',
				not_a_member: 'You are not an active member of this organization.'
			};
			return fail(
				400,
				formError(messages[result.code ?? ''] ?? 'That request could not be submitted.')
			);
		}

		// Email delivery is attempted after the fact; a provider outage must
		// not undo a request that is already saved.
		flushPendingEmailsInBackground();

		return { success: true as const };
	},

	cancel: async ({ request, locals }) => {
		const org = locals.org;
		if (!org) throw redirect(303, '/login');

		const requestId = String((await request.formData()).get('requestId') ?? '');
		if (!requestId) return fail(400, formError('No request was specified.'));

		// RLS allows an employee to touch only their own pending requests.
		const { error } = await locals.supabase
			.from('time_off_requests')
			.update({ status: 'cancelled' })
			.eq('id', requestId)
			.eq('employee_membership_id', org.membership.id)
			.eq('status', 'pending');

		if (error) return fail(500, formError('That request could not be cancelled.'));
		return { cancelled: true as const };
	}
};
