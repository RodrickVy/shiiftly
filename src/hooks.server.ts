/**
 * Request pipeline.
 *
 * Three things happen on every request, in order:
 *
 *   1. A Supabase client bound to this request's cookies is attached.
 *   2. The session is validated against the auth server -- not merely decoded
 *      from a cookie -- before anything trusts `locals.user`.
 *   3. Routes are authorized server-side. The client is never asked whether
 *      the user may see a page.
 */
import { redirect, type Handle } from '@sveltejs/kit';
import { createRequestClient } from '$lib/server/supabase';
import { loadOrgContext } from '$lib/server/context';
import { isConfigured } from '$lib/server/env';

/** Pages reachable without signing in. */
const PUBLIC_ROUTES = [
	'/',
	'/login',
	'/signup',
	'/forgot-password',
	'/reset-password',
	'/auth/callback',
	'/auth/confirm',
	'/auth/error',
	'/setup-required'
];

/** Manager-only sections of /app. */
const MANAGER_ROUTES = [
	'/app/dashboard',
	'/app/station',
	'/app/employees',
	'/app/attendance',
	'/app/timesheets',
	'/app/tasks',
	'/app/time-off',
	'/app/payroll',
	'/app/invitations',
	'/app/settings'
];

function isPublic(pathname: string): boolean {
	if (PUBLIC_ROUTES.includes(pathname)) return true;
	// Invitation links must be openable by a signed-out visitor.
	return pathname.startsWith('/invite/');
}

function isManagerRoute(pathname: string): boolean {
	return MANAGER_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export const handle: Handle = async ({ event, resolve }) => {
	const configured = isConfigured();
	event.locals.configured = configured;

	// Without credentials there is no database to talk to. Say so plainly
	// instead of failing later with an opaque error. The landing page has no
	// database dependency, so it still renders.
	if (!configured) {
		event.locals.session = null;
		event.locals.user = null;
		event.locals.org = null;

		const alwaysAvailable = event.url.pathname === '/' || event.url.pathname === '/setup-required';
		if (!alwaysAvailable) {
			throw redirect(303, '/setup-required');
		}
		return resolve(event);
	}

	const supabase = createRequestClient(event);
	event.locals.supabase = supabase;

	/**
	 * getSession() alone reads an unverified cookie. getUser() asks the auth
	 * server, so a forged cookie cannot produce a logged-in request.
	 */
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await supabase.auth.getSession();
		if (!session) return { session: null, user: null };

		const {
			data: { user },
			error
		} = await supabase.auth.getUser();
		if (error || !user) return { session: null, user: null };

		return { session, user };
	};

	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;
	event.locals.org = user ? await loadOrgContext(supabase, event, user.id) : null;

	const { pathname } = event.url;

	if (!user && !isPublic(pathname)) {
		const next = encodeURIComponent(pathname + event.url.search);
		throw redirect(303, `/login?next=${next}`);
	}

	if (user) {
		// A signed-in user with no organization has one job: onboarding.
		const needsOnboarding = !event.locals.org;
		const onOnboarding = pathname.startsWith('/onboarding');
		const onInvite = pathname.startsWith('/invite/');

		if (needsOnboarding && pathname.startsWith('/app')) {
			throw redirect(303, '/onboarding/organization');
		}
		if (!needsOnboarding && onOnboarding && !pathname.startsWith('/onboarding/setup')) {
			throw redirect(303, event.locals.org!.isManager ? '/app/dashboard' : '/app/home');
		}
		if ((pathname === '/login' || pathname === '/signup') && !onInvite) {
			throw redirect(303, needsOnboarding ? '/onboarding/organization' : '/app');
		}

		// Role check for manager-only pages.
		if (isManagerRoute(pathname) && event.locals.org && !event.locals.org.isManager) {
			throw redirect(303, '/app/home');
		}
	}

	return resolve(event, {
		/**
		 * Supabase's auth responses carry this header; it must reach the
		 * browser for session handling to work.
		 */
		filterSerializedResponseHeaders: (name) => name === 'content-range' || name === 'x-supabase-api-version'
	});
};
