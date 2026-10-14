import { error } from '@sveltejs/kit';
import { csvResponse, toCsv } from '$lib/server/csv';
import { buildPayroll } from '$lib/server/reports';
import { addDays, todayInTimeZone } from '$lib/domain/time';
import { minutesToHours } from '$lib/domain/earnings';
import type { RequestHandler } from './$types';

/** CSV of the earnings estimate. Clearly labelled as an estimate in the file. */
export const GET: RequestHandler = async (event) => {
	const org = event.locals.org;
	if (!org) throw error(401, 'Sign in first.');
	if (!org.isOwner) throw error(403, 'Only the owner can export pay information.');

	const tz = org.organization.timezone;
	const today = todayInTimeZone(tz);
	const from = event.url.searchParams.get('from') ?? addDays(today, -29);
	const to = event.url.searchParams.get('to') ?? today;
	const approvedOnly = event.url.searchParams.get('approved') === '1';

	const { rows } = await buildPayroll(event.locals, { from, to, approvedOnly });

	const csv = toCsv(
		[
			'Employee',
			'Period start',
			'Period end',
			'Payable hours',
			'Unrated hours',
			'Estimated gross',
			'Currency',
			'Timesheet approved',
			'Note'
		],
		rows.map((r) => [
			r.name,
			from,
			to,
			minutesToHours(r.payableMinutes - r.unratedMinutes),
			minutesToHours(r.unratedMinutes),
			(r.grossCents / 100).toFixed(2),
			r.currencyCode,
			r.approved ? 'yes' : 'no',
			r.hasRate ? 'ESTIMATE ONLY - excludes taxes and deductions' : 'No pay rate recorded'
		])
	);

	return csvResponse(`shiftly-earnings-estimate-${from}-to-${to}.csv`, csv);
};
