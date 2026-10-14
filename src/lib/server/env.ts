/**
 * Environment configuration.
 *
 * Read dynamically rather than at build time so the application can be built
 * and inspected without credentials, and so a misconfiguration surfaces as a
 * clear message instead of a stack trace on an unrelated page.
 *
 * `configurationProblems()` is what the UI uses to tell an operator exactly
 * what is missing. Nothing here invents a fallback for a missing secret: an
 * unconfigured Shiftly refuses to pretend it is working.
 */
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export interface AppConfig {
	supabaseUrl: string;
	supabaseAnonKey: string;
	supabaseServiceRoleKey: string;
	qrTokenSecret: string;
	resendApiKey: string | null;
	emailFrom: string;
	appUrl: string | null;
}

function value(v: string | undefined): string | null {
	const trimmed = (v ?? '').trim();
	return trimmed.length > 0 ? trimmed : null;
}

/** A human-readable list of what is missing, empty when fully configured. */
export function configurationProblems(): string[] {
	const problems: string[] = [];

	if (!value(publicEnv.PUBLIC_SUPABASE_URL)) {
		problems.push('PUBLIC_SUPABASE_URL is not set.');
	}
	if (!value(publicEnv.PUBLIC_SUPABASE_ANON_KEY)) {
		problems.push('PUBLIC_SUPABASE_ANON_KEY is not set.');
	}
	if (!value(env.SUPABASE_SERVICE_ROLE_KEY)) {
		problems.push('SUPABASE_SERVICE_ROLE_KEY is not set (server-side only; never expose it).');
	}

	const secret = value(env.QR_TOKEN_SECRET);
	if (!secret) {
		problems.push('QR_TOKEN_SECRET is not set.');
	} else if (secret.length < 32) {
		problems.push('QR_TOKEN_SECRET must be at least 32 characters.');
	}

	return problems;
}

export function isConfigured(): boolean {
	return configurationProblems().length === 0;
}

/** Throws if called while unconfigured; callers should check isConfigured(). */
export function getConfig(): AppConfig {
	const problems = configurationProblems();
	if (problems.length > 0) {
		throw new Error(`Shiftly is not configured:\n- ${problems.join('\n- ')}`);
	}

	return {
		supabaseUrl: value(publicEnv.PUBLIC_SUPABASE_URL)!,
		supabaseAnonKey: value(publicEnv.PUBLIC_SUPABASE_ANON_KEY)!,
		supabaseServiceRoleKey: value(env.SUPABASE_SERVICE_ROLE_KEY)!,
		qrTokenSecret: value(env.QR_TOKEN_SECRET)!,
		resendApiKey: value(env.RESEND_API_KEY),
		emailFrom: value(env.EMAIL_FROM) ?? 'Shiftly <onboarding@resend.dev>',
		appUrl: value(publicEnv.PUBLIC_APP_URL)
	};
}

/**
 * Whether real email delivery is possible. When false, the email layer uses a
 * development adapter that logs messages instead -- and says so, rather than
 * reporting a delivery that never happened.
 */
export function hasEmailProvider(): boolean {
	return value(env.RESEND_API_KEY) !== null;
}
