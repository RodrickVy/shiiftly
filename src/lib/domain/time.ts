/**
 * Timezone arithmetic for organization-local days.
 *
 * Everything Shiftly stores is an absolute instant (timestamptz). "Which day
 * was that?" is a question that only has an answer relative to an
 * organization's IANA timezone, and that is what this module answers.
 *
 * No dependency on a date library: Intl already carries the tz database.
 */

/** A calendar date with no timezone attached, as `YYYY-MM-DD`. */
export type LocalDate = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = partsCache.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		partsCache.set(timeZone, f);
	}
	return f;
}

/** Throws if the zone is not one the runtime knows. */
export function assertValidTimeZone(timeZone: string): void {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
	} catch {
		throw new Error(`Unknown IANA timezone: ${timeZone}`);
	}
}

export function isValidTimeZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}

interface WallClock {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function wallClockIn(instant: Date, timeZone: string): WallClock {
	const parts = formatter(timeZone).formatToParts(instant);
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value ?? '0');

	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		// Intl can render midnight as hour 24 in some locales/zones.
		hour: get('hour') % 24,
		minute: get('minute'),
		second: get('second')
	};
}

/** The organization-local calendar date of an instant. */
export function localDateInTimeZone(instant: Date, timeZone: string): LocalDate {
	const { year, month, day } = wallClockIn(instant, timeZone);
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The zone's UTC offset in milliseconds at a given instant. */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
	const w = wallClockIn(instant, timeZone);
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
	// Match the instant's sub-second part so the difference is a clean offset.
	return asUtc - (instant.getTime() - (instant.getTime() % 1000));
}

/**
 * Converts a local wall-clock time to the absolute instant it names.
 *
 * Two passes: the first guesses using the offset at the naive timestamp, the
 * second corrects it using the offset actually in force at that guess. This
 * is what makes DST transitions come out right. On a spring-forward gap the
 * named time does not exist and we return the instant the clock jumps to.
 */
export function zonedWallTimeToUtc(
	date: LocalDate,
	time: `${string}:${string}:${string}`,
	timeZone: string
): Date {
	const [y, m, d] = date.split('-').map(Number);
	const [hh, mm, ss] = time.split(':').map(Number);
	const naive = Date.UTC(y, m - 1, d, hh, mm, ss);

	let guess = naive - timeZoneOffsetMs(new Date(naive), timeZone);
	guess = naive - timeZoneOffsetMs(new Date(guess), timeZone);

	return new Date(guess);
}

/** Midnight that opens the given local day, as an absolute instant. */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
	return zonedWallTimeToUtc(date, '00:00:00', timeZone);
}

/**
 * The instant the given local day ends -- i.e. the next local midnight.
 * This is the expiry a station's daily QR token is given.
 */
export function endOfLocalDay(date: LocalDate, timeZone: string): Date {
	return startOfLocalDay(addDays(date, 1), timeZone);
}

/** Shifts a `YYYY-MM-DD` by whole days, without timezone involvement. */
export function addDays(date: LocalDate, days: number): LocalDate {
	const [y, m, d] = date.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	t.setUTCDate(t.getUTCDate() + days);
	return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}`;
}

/** Whole days from `from` to `to`, inclusive of both ends. */
export function inclusiveDayCount(from: LocalDate, to: LocalDate): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	return Math.floor((b - a) / 86_400_000) + 1;
}

/** Today's date in the organization's timezone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): LocalDate {
	return localDateInTimeZone(now, timeZone);
}

/**
 * The local date range covering a week that contains `date`, honouring the
 * organization's configured first day of the week (0 = Sunday).
 */
export function weekRange(
	date: LocalDate,
	weekStartsOn: number
): { start: LocalDate; end: LocalDate } {
	const [y, m, d] = date.split('-').map(Number);
	const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	const back = (dow - weekStartsOn + 7) % 7;
	const start = addDays(date, -back);
	return { start, end: addDays(start, 6) };
}

function pad(n: number, width: number): string {
	return String(n).padStart(width, '0');
}
