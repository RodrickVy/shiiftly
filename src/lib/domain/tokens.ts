/**
 * Station QR tokens.
 *
 * A station's token for a given organization-local day is *derived*, not
 * stored: HMAC(secret, "<station>:<date>"). That means the server can
 * regenerate today's token on demand -- no nightly job -- while the database
 * only ever holds its SHA-256 hash. A database leak therefore does not hand
 * anyone a working clock-in code.
 *
 * Rotating QR_TOKEN_SECRET invalidates every outstanding code, which is the
 * intended behaviour for a secret rotation.
 *
 * Security note, deliberately repeated in the UI: a code that is valid for a
 * whole day can be photographed and shared. This is a convenience mechanism,
 * not proof that someone stood in the building.
 */

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
	const view = new Uint8Array(bytes);
	let binary = '';
	for (const byte of view) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** SHA-256 of a token, hex encoded. This is what the database stores. */
export async function hashToken(raw: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
	return toHex(digest);
}

/**
 * The raw token for a station on an organization-local date.
 * Deterministic, so the same day always yields the same code.
 */
export async function deriveStationToken(
	secret: string,
	stationId: string,
	localDate: string
): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${stationId}:${localDate}`));
	return toBase64Url(signature);
}

/** A cryptographically random token, used for invitation links. */
export function randomToken(byteLength = 32): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes.buffer);
}

/**
 * Constant-time string comparison, for the rare places we compare a secret
 * value in application code rather than by indexed hash lookup.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Shape of what a station QR code encodes: an absolute URL to the clock page. */
export function stationClockUrl(origin: string, rawToken: string): string {
	return `${origin.replace(/\/$/, '')}/clock/${rawToken}`;
}
