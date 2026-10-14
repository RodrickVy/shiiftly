/**
 * Phone number normalisation.
 *
 * The database stores E.164 (`+254712345678`) and enforces it with a CHECK
 * constraint. People do not type E.164 -- they type `0712 345 678`, or
 * `0712-345-678`, or paste `+254 712 345 678`. Rejecting those would make the
 * field hostile for exactly the markets this is built for.
 *
 * So the form asks for a country dial code and a national number separately,
 * and this module joins them. A leading trunk zero (used in Kenya, Nigeria,
 * the UK and many others) is dropped, because it is a domestic-dialling
 * prefix that never appears in the international form.
 */

export interface DialCode {
	/** ISO 3166-1 alpha-2, matching organizations.country_code. */
	country: string;
	name: string;
	/** Including the leading plus, e.g. "+254". */
	dial: string;
}

/** Ordered to match the country list used elsewhere. */
export const DIAL_CODES: DialCode[] = [
	{ country: 'KE', name: 'Kenya', dial: '+254' },
	{ country: 'NG', name: 'Nigeria', dial: '+234' },
	{ country: 'ZA', name: 'South Africa', dial: '+27' },
	{ country: 'GH', name: 'Ghana', dial: '+233' },
	{ country: 'TZ', name: 'Tanzania', dial: '+255' },
	{ country: 'UG', name: 'Uganda', dial: '+256' },
	{ country: 'RW', name: 'Rwanda', dial: '+250' },
	{ country: 'ET', name: 'Ethiopia', dial: '+251' },
	{ country: 'EG', name: 'Egypt', dial: '+20' },
	{ country: 'MA', name: 'Morocco', dial: '+212' },
	{ country: 'SN', name: 'Senegal', dial: '+221' },
	{ country: 'CI', name: "Côte d'Ivoire", dial: '+225' },
	{ country: 'CM', name: 'Cameroon', dial: '+237' },
	{ country: 'ZM', name: 'Zambia', dial: '+260' },
	{ country: 'ZW', name: 'Zimbabwe', dial: '+263' },
	{ country: 'BW', name: 'Botswana', dial: '+267' },
	{ country: 'NA', name: 'Namibia', dial: '+264' },
	{ country: 'MW', name: 'Malawi', dial: '+265' },
	{ country: 'MZ', name: 'Mozambique', dial: '+258' },
	{ country: 'AO', name: 'Angola', dial: '+244' },
	{ country: 'AE', name: 'United Arab Emirates', dial: '+971' },
	{ country: 'AU', name: 'Australia', dial: '+61' },
	{ country: 'BR', name: 'Brazil', dial: '+55' },
	{ country: 'CA', name: 'Canada', dial: '+1' },
	{ country: 'DE', name: 'Germany', dial: '+49' },
	{ country: 'ES', name: 'Spain', dial: '+34' },
	{ country: 'FR', name: 'France', dial: '+33' },
	{ country: 'GB', name: 'United Kingdom', dial: '+44' },
	{ country: 'IN', name: 'India', dial: '+91' },
	{ country: 'IE', name: 'Ireland', dial: '+353' },
	{ country: 'NL', name: 'Netherlands', dial: '+31' },
	{ country: 'PH', name: 'Philippines', dial: '+63' },
	{ country: 'PK', name: 'Pakistan', dial: '+92' },
	{ country: 'PT', name: 'Portugal', dial: '+351' },
	{ country: 'SA', name: 'Saudi Arabia', dial: '+966' },
	{ country: 'SG', name: 'Singapore', dial: '+65' },
	{ country: 'US', name: 'United States', dial: '+1' }
];

export const DEFAULT_DIAL = '+254';

/** Matches the CHECK constraint on profiles.phone. */
const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string): boolean {
	return E164.test(value);
}

export type PhoneResult =
	| { ok: true; e164: string }
	| { ok: false; reason: 'empty' | 'invalid_dial' | 'too_short' | 'too_long' | 'invalid' };

/**
 * Combines a dial code and a locally-typed number into E.164.
 *
 * If the national part already carries a `+` or a `00` international prefix,
 * that wins over the selected dial code -- someone who pastes a full
 * international number should not have it mangled.
 */
export function normalizePhone(dial: string, national: string): PhoneResult {
	const rawNational = (national ?? '').trim();
	if (rawNational === '') return { ok: false, reason: 'empty' };

	// Keep digits, and a leading + if present.
	const cleanedNational = rawNational.replace(/[^\d+]/g, '');

	let candidate: string;

	if (cleanedNational.startsWith('+')) {
		candidate = `+${cleanedNational.slice(1).replace(/\D/g, '')}`;
	} else if (cleanedNational.startsWith('00')) {
		candidate = `+${cleanedNational.slice(2).replace(/\D/g, '')}`;
	} else {
		const cleanedDial = (dial ?? '').trim().replace(/[^\d+]/g, '');
		if (!/^\+\d{1,4}$/.test(cleanedDial)) return { ok: false, reason: 'invalid_dial' };

		// Drop the domestic trunk prefix: 0712... -> 712...
		const withoutTrunk = cleanedNational.replace(/^0+/, '');
		if (withoutTrunk === '') return { ok: false, reason: 'too_short' };

		candidate = `${cleanedDial}${withoutTrunk}`;
	}

	const digits = candidate.slice(1);
	if (digits.length < 7) return { ok: false, reason: 'too_short' };
	if (digits.length > 15) return { ok: false, reason: 'too_long' };
	if (!isE164(candidate)) return { ok: false, reason: 'invalid' };

	return { ok: true, e164: candidate };
}

/** A message a person can act on, for each failure mode. */
export function phoneErrorMessage(reason: Exclude<PhoneResult, { ok: true }>['reason']): string {
	switch (reason) {
		case 'empty':
			return 'Enter a phone number.';
		case 'invalid_dial':
			return 'Choose a country code.';
		case 'too_short':
			return 'That number looks too short.';
		case 'too_long':
			return 'That number looks too long.';
		default:
			return 'Enter a valid phone number, for example 0712 345 678.';
	}
}

/** Splits a stored E.164 number back into a dial code and national part. */
export function splitE164(value: string | null): { dial: string; national: string } {
	if (!value || !isE164(value)) return { dial: DEFAULT_DIAL, national: '' };

	// Longest dial code first, so +1 does not shadow +254.
	const codes = [...new Set(DIAL_CODES.map((c) => c.dial))].sort((a, b) => b.length - a.length);
	for (const dial of codes) {
		if (value.startsWith(dial)) return { dial, national: value.slice(dial.length) };
	}
	return { dial: DEFAULT_DIAL, national: value.replace(/^\+/, '') };
}

/** Renders E.164 with light spacing for display. */
export function formatPhone(value: string | null): string {
	if (!value) return '';
	const { dial, national } = splitE164(value);
	if (!national) return value;
	const grouped = national.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
	return `${dial} ${grouped}`;
}
