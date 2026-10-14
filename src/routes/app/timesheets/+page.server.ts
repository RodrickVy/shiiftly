import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { formError, parseForm } from '$lib/schemas';
import {
	addDays,
	endOfLocalDay,
	startOfLocalDay,
	todayInTimeZone,
	weekRange
} from '$lib/domain/time';
import type { Actions, PageServerLoad } from './$types';
import type { Shift, Timesheet } from '$lib/types/database';

const reviewSchema = z.object({
	membershipId: z.uuid(),
	periodStart: z.iso.date(),
	periodEnd: z.iso.date(),
	decision: z.enum(['approved', 'rejected']),
	note: z.string().trim().max(1000).optional().or(z.literal(''))
});

const reopenSchema = z.object({ timesheetId: z.uuid() });

export const load: PageServerLoad = async ({ locals, url }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);

	// Default to the week just gone, which is what a manager usually reviews.
	const thisWeek = weekRange(today, org.organization.week_starts_on);
	const defaults = weekRange(addDays(thisWeek.start, -7), org.organization.week_starts_on);

	const periodStart = url.searchParams.get('from') ?? defaults.start;
	const periodEnd = url.searchParams.get('to') ?? defaults.end;

	const { data: shiftRows } = await locals.supabase
		.from('shifts')
		.select('*, organization_memberships(id, profiles(full_name))')
		.eq('organization_id', org.organization.id)
		.eq('status', 'completed')
		.gte('started_at', startOfLocalDay(periodStart, tz).toISOString())
		.lt('started_at', endOfLocalDay(periodEnd, tz).toISOString());

	type Row = Shift & {
		organization_memberships: { id: string; profiles: { full_name: string } | null } | null;
	};

	// Totals are derived from the source shifts every time, never cached.
	const byMembership = new Map<
		string,
		{ name: string; gross: number; breaks: number; payable: number; shifts: number }
	>();

	for (const shift of (shiftRows ?? []) as unknown as Row[]) {
		const key = shift.employee_membership_id;
		const entry = byMembership.get(key) ?? {
			name: shift.organization_memberships?.profiles?.full_name ?? 'Unnamed',
			gross: 0,
			breaks: 0,
			payable: 0,
			shifts: 0
		};
		entry.gross += shift.gross_minutes ?? 0;
		entry.breaks += shift.unpaid_break_minutes ?? 0;
		entry.payable += shift.payable_minutes ?? 0;
		entry.shifts += 1;
		byMembership.set(key, entry);
	}

	const { data: sheetRows } = await locals.supabase
		.from('timesheets')
		.select('*')
		.eq('organization_id', org.organization.id)
		.eq('period_start', periodStart)
		.eq('period_end', periodEnd);

	const sheets = new Map(
		((sheetRows ?? []) as Timesheet[]).map((s) => [s.employee_membership_id, s])
	);

	const rows = [...byMembership.entries()]
		.map(([membershipId, totals]) => {
			const sheet = sheets.get(membershipId);
			return {
				membershipId,
				name: totals.name,
				shifts: totals.shifts,
				grossMinutes: totals.gross,
				breakMinutes: totals.breaks,
				payableMinutes: totals.payable,
				timesheetId: sheet?.id ?? null,
				status: sheet?.status ?? ('draft' as const),
				reviewedAt: sheet?.reviewed_at ?? null,
				reviewNote: sheet?.review_note ?? null,
				// A stored total that no longer matches the shifts means the
				// underlying records changed after approval.
				stale: sheet ? sheet.payable_minutes !== totals.payable : false
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		periodStart,
		periodEnd,
		rows,
		approvalRequired: org.settings.timesheet_approval_required,
		weekOptions: [0, 1, 2, 3].map((i) => {
			const range = weekRange(addDays(thisWeek.start, -7 * i), org.organization.week_starts_on);
			return { ...range, label: i === 0 ? 'This week' : i === 1 ? 'Last week' : range.start };
		}),
		totals: {
			payableMinutes: rows.reduce((t, r) => t + r.payableMinutes, 0),
			pending: rows.filter((r) => r.status !== 'approved').length
		}
	};
};

export const actions: Actions = {
	review: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(reviewSchema, await request.formData());
		if (!parsed.ok) return fail(400, formError('That review could not be read.'));

		const tz = org.organization.timezone;

		// Recompute from the source shifts rather than trusting the browser.
		const { data: shiftRows } = await locals.supabase
			.from('shifts')
			.select('gross_minutes, unpaid_break_minutes, payable_minutes')
			.eq('organization_id', org.organization.id)
			.eq('employee_membership_id', parsed.data.membershipId)
			.eq('status', 'completed')
			.gte('started_at', startOfLocalDay(parsed.data.periodStart, tz).toISOString())
			.lt('started_at', endOfLocalDay(parsed.data.periodEnd, tz).toISOString());

		const totals = (shiftRows ?? []).reduce(
			(acc, s) => ({
				gross: acc.gross + (s.gross_minutes ?? 0),
				breaks: acc.breaks + (s.unpaid_break_minutes ?? 0),
				payable: acc.payable + (s.payable_minutes ?? 0)
			}),
			{ gross: 0, breaks: 0, payable: 0 }
		);

		const { error: upsertError } = await locals.supabase.from('timesheets').upsert(
			{
				organization_id: org.organization.id,
				employee_membership_id: parsed.data.membershipId,
				period_start: parsed.data.periodStart,
				period_end: parsed.data.periodEnd,
				gross_minutes: totals.gross,
				unpaid_break_minutes: totals.breaks,
				payable_minutes: totals.payable,
				status: parsed.data.decision,
				reviewed_by: org.membership.user_id,
				reviewed_at: new Date().toISOString(),
				review_note: parsed.data.note || null
			},
			{ onConflict: 'employee_membership_id,period_start,period_end' }
		);

		if (upsertError) {
			return fail(500, formError('That timesheet could not be saved.'));
		}

		return { reviewed: parsed.data.decision };
	},

	reopen: async ({ request, locals }) => {
		const org = locals.org;
		if (!org?.isManager) throw error(403, 'Managers only.');

		const parsed = parseForm(reopenSchema, await request.formData());
		if (!parsed.ok) return fail(400, formError('No timesheet was specified.'));

		// Reopening is itself an authorized action: an approved timesheet is
		// locked until a manager deliberately unlocks it.
		const { error: updateError } = await locals.supabase
			.from('timesheets')
			.update({
				status: 'draft',
				reviewed_by: null,
				reviewed_at: null,
				review_note: null
			})
			.eq('id', parsed.data.timesheetId)
			.eq('organization_id', org.organization.id);

		if (updateError) return fail(500, formError('That timesheet could not be reopened.'));
		return { reopened: true as const };
	}
};
