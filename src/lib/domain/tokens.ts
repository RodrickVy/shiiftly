/**
 * Derived tokens.
 *
 * Every token here is computed from a stable identifier plus a server secret
 * rather than stored: the database holds only a SHA-256 hash. That means a
 * manager can redisplay a QR code tomorrow, the server can recompute today's
 * clocking code with no nightly job, and a database leak hands an attacker
 * hashes instead of working codes.
 *
 * Rotating QR_TOKEN_SECRET invalidates every outstanding token at once, which
 * is the intended behaviour for a secret rotation.
 *
 * Each kind of token is domain-separated by its prefix, so a token minted for
 * one purpose can never validate as another.
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

async function hmac(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** SHA-256 of a token, hex encoded. This is what the database stores. */
export async function hashToken(raw: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(raw)));
}

/**
 * The clocking code for an organization on a given local date.
 *
 * Organization-wide by design: every station device displays exactly the same
 * code, so staff can scan whichever screen is nearest. A scan therefore
 * identifies the organization and the day, not the screen.
 */
export async function deriveOrgDailyToken(
	secret: string,
	organizationId: string,
	localDate: string
): Promise<string> {
	return hmac(secret, `clock:${organizationId}:${localDate}`);
}

/**
 * The organization's join link token.
 *
 * Versioned so a manager can invalidate a leaked link by bumping
 * organizations.join_token_version, without disturbing anything else.
 */
export async function deriveJoinToken(
	secret: string,
	organizationId: string,
	version: number
): Promise<string> {
	return hmac(secret, `join:${organizationId}:${version}`);
}

/** The one-time setup link a device uses to become a station. */
export async function deriveStationClaimToken(
	secret: string,
	stationId: string
): Promise<string> {
	return hmac(secret, `station:${stationId}`);
}

/** A cryptographically random token. */
export function randomToken(byteLength = 32): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes.buffer);
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

const base = (origin: string) => origin.replace(/\/$/, '');

/** What a station screen's QR code encodes. */
export function clockUrl(origin: string, rawToken: string): string {
	return `${base(origin)}/clock/${rawToken}`;
}

/** What the join QR code and shareable link point at. */
export function joinUrl(origin: string, rawToken: string): string {
	return `${base(origin)}/join/${rawToken}`;
}

/** What a station's setup link points at. */
export function stationClaimUrl(origin: string, rawToken: string): string {
	return `${base(origin)}/station/setup/${rawToken}`;
}
