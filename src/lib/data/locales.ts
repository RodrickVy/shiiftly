/**
 * Country, timezone and currency reference data.
 *
 * Nothing here is hardcoded to a single market: the country list sets sensible
 * defaults, but every organization picks its own timezone and currency, and
 * the full IANA list comes from the runtime rather than a baked-in table.
 */

export interface Country {
	code: string;
	name: string;
	timezone: string;
	currency: string;
}

/**
 * Common markets first, then the rest alphabetically. The default timezone is
 * the country's most populous zone; the user can always change it.
 */
export const COUNTRIES: Country[] = [
	{ code: 'KE', name: 'Kenya', timezone: 'Africa/Nairobi', currency: 'KES' },
	{ code: 'NG', name: 'Nigeria', timezone: 'Africa/Lagos', currency: 'NGN' },
	{ code: 'ZA', name: 'South Africa', timezone: 'Africa/Johannesburg', currency: 'ZAR' },
	{ code: 'GH', name: 'Ghana', timezone: 'Africa/Accra', currency: 'GHS' },
	{ code: 'TZ', name: 'Tanzania', timezone: 'Africa/Dar_es_Salaam', currency: 'TZS' },
	{ code: 'UG', name: 'Uganda', timezone: 'Africa/Kampala', currency: 'UGX' },
	{ code: 'RW', name: 'Rwanda', timezone: 'Africa/Kigali', currency: 'RWF' },
	{ code: 'ET', name: 'Ethiopia', timezone: 'Africa/Addis_Ababa', currency: 'ETB' },
	{ code: 'EG', name: 'Egypt', timezone: 'Africa/Cairo', currency: 'EGP' },
	{ code: 'MA', name: 'Morocco', timezone: 'Africa/Casablanca', currency: 'MAD' },
	{ code: 'SN', name: 'Senegal', timezone: 'Africa/Dakar', currency: 'XOF' },
	{ code: 'CI', name: "Côte d'Ivoire", timezone: 'Africa/Abidjan', currency: 'XOF' },
	{ code: 'CM', name: 'Cameroon', timezone: 'Africa/Douala', currency: 'XAF' },
	{ code: 'ZM', name: 'Zambia', timezone: 'Africa/Lusaka', currency: 'ZMW' },
	{ code: 'ZW', name: 'Zimbabwe', timezone: 'Africa/Harare', currency: 'ZWG' },
	{ code: 'BW', name: 'Botswana', timezone: 'Africa/Gaborone', currency: 'BWP' },
	{ code: 'NA', name: 'Namibia', timezone: 'Africa/Windhoek', currency: 'NAD' },
	{ code: 'MW', name: 'Malawi', timezone: 'Africa/Blantyre', currency: 'MWK' },
	{ code: 'MZ', name: 'Mozambique', timezone: 'Africa/Maputo', currency: 'MZN' },
	{ code: 'AO', name: 'Angola', timezone: 'Africa/Luanda', currency: 'AOA' },
	{ code: 'AE', name: 'United Arab Emirates', timezone: 'Asia/Dubai', currency: 'AED' },
	{ code: 'AU', name: 'Australia', timezone: 'Australia/Sydney', currency: 'AUD' },
	{ code: 'BR', name: 'Brazil', timezone: 'America/Sao_Paulo', currency: 'BRL' },
	{ code: 'CA', name: 'Canada', timezone: 'America/Toronto', currency: 'CAD' },
	{ code: 'DE', name: 'Germany', timezone: 'Europe/Berlin', currency: 'EUR' },
	{ code: 'ES', name: 'Spain', timezone: 'Europe/Madrid', currency: 'EUR' },
	{ code: 'FR', name: 'France', timezone: 'Europe/Paris', currency: 'EUR' },
	{ code: 'GB', name: 'United Kingdom', timezone: 'Europe/London', currency: 'GBP' },
	{ code: 'IN', name: 'India', timezone: 'Asia/Kolkata', currency: 'INR' },
	{ code: 'IE', name: 'Ireland', timezone: 'Europe/Dublin', currency: 'EUR' },
	{ code: 'NL', name: 'Netherlands', timezone: 'Europe/Amsterdam', currency: 'EUR' },
	{ code: 'PH', name: 'Philippines', timezone: 'Asia/Manila', currency: 'PHP' },
	{ code: 'PK', name: 'Pakistan', timezone: 'Asia/Karachi', currency: 'PKR' },
	{ code: 'PT', name: 'Portugal', timezone: 'Europe/Lisbon', currency: 'EUR' },
	{ code: 'SA', name: 'Saudi Arabia', timezone: 'Asia/Riyadh', currency: 'SAR' },
	{ code: 'SG', name: 'Singapore', timezone: 'Asia/Singapore', currency: 'SGD' },
	{ code: 'US', name: 'United States', timezone: 'America/New_York', currency: 'USD' }
];

export const CURRENCIES = [
	'AED', 'AOA', 'AUD', 'BRL', 'BWP', 'CAD', 'EGP', 'ETB', 'EUR', 'GBP', 'GHS', 'INR', 'KES',
	'MAD', 'MWK', 'MZN', 'NAD', 'NGN', 'PHP', 'PKR', 'RWF', 'SAR', 'SGD', 'TZS', 'UGX', 'USD',
	'XAF', 'XOF', 'ZAR', 'ZMW', 'ZWG'
] as const;

export const INDUSTRIES = [
	'Retail',
	'Restaurant or café',
	'Warehouse',
	'Manufacturing',
	'Cleaning services',
	'Security services',
	'Construction',
	'Healthcare',
	'Hospitality',
	'Office or professional services',
	'Education',
	'Logistics and transport',
	'Other'
] as const;

export const WEEKDAYS = [
	{ value: 0, label: 'Sunday' },
	{ value: 1, label: 'Monday' },
	{ value: 2, label: 'Tuesday' },
	{ value: 3, label: 'Wednesday' },
	{ value: 4, label: 'Thursday' },
	{ value: 5, label: 'Friday' },
	{ value: 6, label: 'Saturday' }
];

/** Every IANA zone the runtime knows, for the timezone picker. */
export function allTimeZones(): string[] {
	const supported = (
		Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
	).supportedValuesOf;

	if (typeof supported === 'function') {
		try {
			return supported('timeZone');
		} catch {
			/* fall through to the country defaults */
		}
	}
	return [...new Set(COUNTRIES.map((c) => c.timezone))].sort();
}

export function countryByCode(code: string): Country | undefined {
	return COUNTRIES.find((c) => c.code === code.toUpperCase());
}
