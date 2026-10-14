import { error, fail, redirect } from '@sveltejs/kit';
import { attendanceCorrectionSchema, formError, formFailure, parseForm } from '$lib/schemas';
import { breakPolicyFrom } from '$lib/server/attendance';
import { loadAttendance } from '$lib/server/reports';
import { payableMinutes } from '$lib/domain/attendance';
import {
	addDays,
	endOfLocalDay,
	startOfLocalDay,
	todayInTimeZone,
	zonedWallTimeToUtc
} from '$lib/domain/time';
import type { Actions, PageServerLoad } from './$types';
import type { Shift, ShiftStatus } from '$lib/types/database';

/** Reads `YYYY-MM-DDTHH:MM` as a wall time in `timeZone`. */
function wallTimeToInstant(value: string, timeZone: string): Date | null {
	const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
	if (!match) return null;
	const [, date, hh, mm, ss = '00'] = match;
	return zonedWallTimeToUtc(date, `${hh}:${mm}:${ss}`, timeZone);
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);
	const from = url.searchParams.get('from') ?? addDays(today, -13);
	const to = url.searchParams.get('to') ?? today;
	const employee = url.searchParams.get('employee') ?? 'all';
	const status = url.searchParams.get('status') ?? 'all';

	const { rows } = await loadAttendance(locals, { from, to, employee, status });

	const { data: memberRows } = await locals.supabase
		.from('organization_memberships')
		.select('id, profiles(full_name)')
		.eq('organization_id', org.organization.id)
		.eq('status', 'active')
		.order('joined_at', { ascending: true });

	const completed = rows.filter((r) => r.status === 'completed');

	return {
		from,
		to,
		filters: { employee, status },
		rows,
		employees: (memberRows ?? []).map((m) => ({
			id: m.id,
			name: (m.profiles as unknown as { full_name: string } | null)?.full_name ?? 'Unnamed'
		})),
		totals: {
			shifts: completed.length,
			grossMinutes: completed.reduce((t, r) => t + (r.grossMinutes ?? 0), 0),
			breakMinutes: completed.reduce((t, r) => t + (r.unpaidBreakMinutes ?? 0), 0),
			payableMinutes: completed.reduce((t, r) => t + (r.payableMinutes ?? 0), 0),
			incomplete: rows.filter((r) => r.incomplete).length
		},
		allowCorrections: org.settings.allow_manager_corrections,
		timezone: tz
	};
};

export const actions: Actions = {
	/**
	 * Applies a manager correction.
	 *
	 * The original clock events are never touched: the adjustment is recorded
	 * with the previous and proposed values, and the shift's derived totals
	 * are recomputed from the corrected times.
	 */
	correct: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');
		if (!org.settings.allow_manager_corrections) {
			return fail(403, formError('Attendance corrections are switched off in Settings.'));
		}

		const parsed = parseForm(attendanceCorrectionSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		const { data: existing } = await locals.supabase
			.from('shifts')
			.select('*')
			.eq('id', parsed.data.shiftId)
			.eq('organization_id', org.organization.id)
			.maybeSingle();

		if (!existing) return fail(404, formError('That shift is not in your organization.'));
		const shift = existing as Shift;

		// A datetime-local field submits a wall-clock time with no zone. It
		// means the organization's local time, not the server's -- parsing it
		// with `new Date()` would silently shift it by the server's offset.
		const startedAt = wallTimeToInstant(parsed.data.startedAt, org.organization.timezone);
		const endedAt = parsed.data.endedAt
			? wallTimeToInstant(parsed.data.endedAt, org.organization.timezone)
			: null;

		if (!startedAt || (parsed.data.endedAt && !endedAt)) {
			return fail(400, formError('Those times could not be read.'));
		}
		if (endedAt && endedAt <= startedAt!) {
			return fail(400, formFailure({ endedAt: ['The end time must be after the start time.'] }));
		}

		const { data: breaks } = await locals.supabase
			.from('break_records')
			.select('started_at, ended_at, is_paid')
			.eq('shift_id', shift.id);

		const intervals = (breaks ?? []).map((b) => ({
			startedAt: new Date(b.started_at),
			endedAt: b.ended_at ? new Date(b.ended_at) : null,
			isPaid: b.is_paid
		}));

		const policy = breakPolicyFrom(org.settings);
		const recomputed = endedAt ? payableMinutes(policy, startedAt!, endedAt, intervals) : null;

		const previous = {
			started_at: shift.started_at,
			ended_at: shift.ended_at,
			status: shift.status,
			gross_minutes: shift.gross_minutes,
			unpaid_break_minutes: shift.unpaid_break_minutes,
			payable_minutes: shift.payable_minutes
		};

		const proposed = {
			started_at: startedAt!.toISOString(),
			ended_at: endedAt?.toISOString() ?? null,
			status: (endedAt ? 'completed' : 'active') as ShiftStatus,
			gross_minutes: recomputed?.gross ?? null,
			unpaid_break_minutes: recomputed?.unpaidBreak ?? null,
			payable_minutes: recomputed?.payable ?? null
		};

		// The audit row is written first, so a correction can never be applied
		// without a record of who made it and why.
		const { error: auditError } = await locals.supabase
			.from('attendance_adjustments')
			.insert({
				organization_id: org.organization.id,
				shift_id: shift.id,
				requested_by: org.membership.user_id,
				approved_by: org.membership.user_id,
				previous_values: previous,
				proposed_values: proposed,
				reason: parsed.data.reason,
				status: 'approved',
				resolved_at: new Date().toISOString()
			});

		if (auditError) {
			return fail(500, formError('The correction could not be recorded, so nothing was changed.'));
		}

		const { error: updateError } = await locals.supabase
			.from('shifts')
			.update(proposed)
			.eq('id', shift.id)
			.eq('organization_id', org.organization.id);

		if (updateError) {
			return fail(500, formError('The shift could not be updated.'));
		}

		return { corrected: true as const };
	}
};
