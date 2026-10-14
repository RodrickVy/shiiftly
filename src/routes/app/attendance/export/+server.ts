import { error } from '@sveltejs/kit';
import { csvResponse, toCsv } from '$lib/server/csv';
import { loadAttendance } from '$lib/server/reports';
import { localDateInTimeZone, todayInTimeZone, addDays } from '$lib/domain/time';
import { minutesToHours } from '$lib/domain/earnings';
import type { RequestHandler } from './$types';

/**
 * CSV export of attendance.
 *
 * A GET endpoint rather than a form action, so it can be a plain link and the
 * browser handles the download. It reuses the page's own query so the file
 * always matches what the manager is looking at.
 */
export const GET: RequestHandler = async (event) => {
	const org = event.locals.org;
	if (!org) throw error(401, 'Sign in first.');
	if (!org.isManager) throw error(403, 'Managers only.');

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);
	const from = event.url.searchParams.get('from') ?? addDays(today, -13);
	const to = event.url.searchParams.get('to') ?? today;
	const employee = event.url.searchParams.get('employee') ?? 'all';
	const status = event.url.searchParams.get('status') ?? 'all';

	const { rows } = await loadAttendance(event.locals, { from, to, employee, status });

	const csv = toCsv(
		[
			'Employee',
			'Local date',
			'Start',
			'End',
			'Gross hours',
			'Unpaid break hours',
			'Payable hours',
			'Status',
			'Clock-in method',
			'Clock-out method',
			'Station'
		],
		rows.map((r) => [
			r.name,
			localDateInTimeZone(new Date(r.startedAt), tz),
			r.startedAt,
			r.endedAt ?? '',
			r.grossMinutes !== null ? minutesToHours(r.grossMinutes) : '',
			r.unpaidBreakMinutes !== null ? minutesToHours(r.unpaidBreakMinutes) : '',
			r.payableMinutes !== null ? minutesToHours(r.payableMinutes) : '',
			r.incomplete ? 'incomplete' : r.status,
			r.clockInMethod,
			r.clockOutMethod ?? '',
			r.stationName ?? ''
		])
	);

	return csvResponse(`shiftly-attendance-${from}-to-${to}.csv`, csv);
};
