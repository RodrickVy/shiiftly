import { fail, redirect } from '@sveltejs/kit';
import {
	attendanceStateFor,
	breakPolicyFrom,
	clockErrorMessage,
	getActiveShift,
	getShiftsBetween,
	hasCompletedShiftToday,
	toIntervals
} from '$lib/server/attendance';
import { endOfLocalDay, startOfLocalDay, todayInTimeZone } from '$lib/domain/time';
import { payableMinutes } from '$lib/domain/attendance';
import { formError } from '$lib/schemas';
import { limiterKey, rateLimit } from '$lib/server/rate-limit';
import type { Actions, PageServerLoad } from './$types';
import type { Task } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);
	const dayStart = startOfLocalDay(today, tz).toISOString();
	const dayEnd = endOfLocalDay(today, tz).toISOString();

	const membershipId = org.membership.id;

	const [shift, completedToday] = await Promise.all([
		getActiveShift(locals.supabase, membershipId),
		hasCompletedShiftToday(locals.supabase, membershipId, dayStart, dayEnd)
	]);

	const recent = await getShiftsBetween(locals.supabase, {
		membershipId,
		fromIso: startOfLocalDay(today, tz).toISOString(),
		toIso: dayEnd
	});

	// Today's assigned tasks that are still open.
	const { data: taskRows } = await locals.supabase
		.from('tasks')
		.select('id, title, priority, status, due_at, task_assignments!inner(employee_membership_id)')
		.eq('task_assignments.employee_membership_id', membershipId)
		.in('status', ['todo', 'in_progress'])
		.order('due_at', { ascending: true, nullsFirst: false })
		.limit(5);

	// Approved leave that is upcoming or current.
	const { data: timeOff } = await locals.supabase
		.from('time_off_requests')
		.select('id, leave_type, start_date, end_date')
		.eq('employee_membership_id', membershipId)
		.eq('status', 'approved')
		.gte('end_date', today)
		.order('start_date', { ascending: true })
		.limit(3);

	// Last few completed shifts, for context.
	const { data: history } = await locals.supabase
		.from('shifts')
		.select('id, started_at, ended_at, payable_minutes, status')
		.eq('employee_membership_id', membershipId)
		.eq('status', 'completed')
		.order('started_at', { ascending: false })
		.limit(5);

	const policy = breakPolicyFrom(org.settings);
	const completedBreakSeconds = (shift?.breaks ?? [])
		.filter((b) => b.endedAt)
		.reduce(
			(total, b) =>
				total + Math.floor((new Date(b.endedAt!).getTime() - new Date(b.startedAt).getTime()) / 1000),
			0
		);

	return {
		// Sent so the browser can correct for a wrong device clock.
		serverNow: new Date().toISOString(),
		state: attendanceStateFor(shift, completedToday),
		shift,
		completedBreakSeconds,
		breakMode: org.settings.break_mode,
		qrEnabled: org.settings.qr_clocking_enabled,
		directEnabled: org.settings.direct_clocking_enabled,
		todayPayableMinutes: recent
			.filter((s) => s.status === 'completed')
			.reduce((total, s) => total + (s.payable_minutes ?? 0), 0),
		// A preview of what the open shift is worth so far, using the same
		// rules the database will apply at clock-out.
		projected: shift
			? payableMinutes(policy, new Date(shift.startedAt), new Date(), toIntervals(shift.breaks))
			: null,
		tasks: (taskRows ?? []) as Pick<Task, 'id' | 'title' | 'priority' | 'status' | 'due_at'>[],
		upcomingTimeOff: timeOff ?? [],
		history: history ?? [],
		idempotencyKey: crypto.randomUUID()
	};
};

export const actions: Actions = {
	clock: async ({ request, locals, getClientAddress }) => {
		const org = locals.org;
		if (!org || !locals.user) throw redirect(303, '/login');

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
		const key = String(formData.get('idempotencyKey') ?? '') || null;

		const fn =
			intent === 'clock_in'
				? 'clock_in_direct'
				: intent === 'clock_out'
					? 'clock_out_direct'
					: null;

		if (!fn) return fail(400, formError('That action is not recognised.'));

		const { data, error } = await locals.supabase.rpc(fn, {
			p_org: org.organization.id,
			p_idempotency_key: key
		});

		if (error) {
			return fail(502, formError('We could not reach the server. Check your connection and try again.'));
		}

		const result = data as { ok: boolean; code?: string; payable_minutes?: number };
		if (!result.ok) return fail(400, formError(clockErrorMessage(result.code ?? '')));

		return { success: true as const, intent };
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

		return { success: true as const, intent };
	}
};
