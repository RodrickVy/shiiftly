import { error, redirect } from '@sveltejs/kit';
import { endOfLocalDay, startOfLocalDay, todayInTimeZone } from '$lib/domain/time';
import { breakPolicyFrom } from '$lib/server/attendance';
import { payableMinutes } from '$lib/domain/attendance';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org) throw redirect(303, '/onboarding/organization');
	if (!org.isManager) throw error(403, 'Managers only.');

	const supabase = locals.supabase;
	const orgId = org.organization.id;
	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);
	const dayStart = startOfLocalDay(today, tz).toISOString();
	const dayEnd = endOfLocalDay(today, tz).toISOString();

	const [
		{ data: memberRows },
		{ data: shiftRows },
		{ data: timeOffRows },
		{ count: pendingTimesheets },
		{ data: upcomingLeave },
		{ data: activity }
	] = await Promise.all([
		supabase
			.from('organization_memberships')
			.select('id, role, job_title, user_id, profiles(full_name)')
			.eq('organization_id', orgId)
			.eq('status', 'active'),

		// Everything that started today, plus anything still open from before
		// (an overnight shift started yesterday is still "on shift" now).
		supabase
			.from('shifts')
			.select('id, employee_membership_id, started_at, ended_at, status, payable_minutes')
			.eq('organization_id', orgId)
			.or(`started_at.gte.${dayStart},status.eq.active`)
			.order('started_at', { ascending: false }),

		supabase
			.from('time_off_requests')
			.select('id, leave_type, start_date, end_date, created_at, employee_membership_id')
			.eq('organization_id', orgId)
			.eq('status', 'pending')
			.order('created_at', { ascending: true })
			.limit(10),

		supabase
			.from('timesheets')
			.select('id', { count: 'exact', head: true })
			.eq('organization_id', orgId)
			.eq('status', 'pending'),

		supabase
			.from('time_off_requests')
			.select('id, leave_type, start_date, end_date, employee_membership_id')
			.eq('organization_id', orgId)
			.eq('status', 'approved')
			.gte('end_date', today)
			.order('start_date', { ascending: true })
			.limit(5),

		supabase
			.from('audit_logs')
			.select('id, action, entity_type, created_at, metadata')
			.eq('organization_id', orgId)
			.order('created_at', { ascending: false })
			.limit(8)
	]);

	type MemberRow = {
		id: string;
		role: string;
		job_title: string | null;
		user_id: string;
		profiles: { full_name: string } | null;
	};
	const members = (memberRows ?? []) as unknown as MemberRow[];
	const nameOf = new Map(members.map((m) => [m.id, m.profiles?.full_name ?? 'Unnamed']));

	type ShiftRow = {
		id: string;
		employee_membership_id: string;
		started_at: string;
		ended_at: string | null;
		status: string;
		payable_minutes: number | null;
	};
	const shifts = (shiftRows ?? []) as unknown as ShiftRow[];
	const activeShifts = shifts.filter((s) => s.status === 'active');
	const completedToday = shifts.filter((s) => s.status === 'completed' && s.started_at >= dayStart);

	// Which of the open shifts are currently paused on a break.
	const openBreaks = activeShifts.length
		? ((
				await supabase
					.from('break_records')
					.select('shift_id, started_at')
					.in(
						'shift_id',
						activeShifts.map((s) => s.id)
					)
					.is('ended_at', null)
			).data ?? [])
		: [];
	const onBreakByShift = new Map(openBreaks.map((b) => [b.shift_id, b.started_at]));

	const policy = breakPolicyFrom(org.settings);
	const now = new Date();

	const onShift = activeShifts.map((s) => {
		const onBreakSince = onBreakByShift.get(s.id) ?? null;
		return {
			shiftId: s.id,
			membershipId: s.employee_membership_id,
			name: nameOf.get(s.employee_membership_id) ?? 'Unnamed',
			startedAt: s.started_at,
			onBreakSince,
			state: (onBreakSince ? 'on_break' : 'working') as 'on_break' | 'working',
			// Live preview using the policy that will be applied at clock-out.
			projectedPayable: payableMinutes(policy, new Date(s.started_at), now, []).payable
		};
	});

	const clockedInIds = new Set(activeShifts.map((s) => s.employee_membership_id));

	return {
		serverNow: now.toISOString(),
		today,
		stats: {
			activeEmployees: members.length,
			clockedIn: onShift.filter((s) => s.state === 'working').length,
			onBreak: onShift.filter((s) => s.state === 'on_break').length,
			notClockedIn: members.filter((m) => !clockedInIds.has(m.id)).length,
			pendingTimeOff: (timeOffRows ?? []).length,
			pendingTimesheets: pendingTimesheets ?? 0,
			// Completed time today, plus what open shifts have accrued so far.
			minutesToday:
				completedToday.reduce((total, s) => total + (s.payable_minutes ?? 0), 0) +
				onShift.reduce((total, s) => total + s.projectedPayable, 0)
		},
		onShift,
		completedToday: completedToday.slice(0, 8).map((s) => ({
			id: s.id,
			name: nameOf.get(s.employee_membership_id) ?? 'Unnamed',
			startedAt: s.started_at,
			endedAt: s.ended_at,
			payableMinutes: s.payable_minutes
		})),
		notClockedIn: members
			.filter((m) => !clockedInIds.has(m.id))
			.slice(0, 10)
			.map((m) => ({ id: m.id, name: m.profiles?.full_name ?? 'Unnamed', jobTitle: m.job_title })),
		pendingRequests: (timeOffRows ?? []).map((r) => ({
			id: r.id,
			name: nameOf.get(r.employee_membership_id) ?? 'Unnamed',
			leaveType: r.leave_type,
			startDate: r.start_date,
			endDate: r.end_date
		})),
		upcomingLeave: (upcomingLeave ?? []).map((r) => ({
			id: r.id,
			name: nameOf.get(r.employee_membership_id) ?? 'Unnamed',
			leaveType: r.leave_type,
			startDate: r.start_date,
			endDate: r.end_date
		})),
		activity: activity ?? []
	};
};
