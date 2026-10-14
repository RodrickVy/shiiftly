/**
 * Supabase clients.
 *
 * Two clients, with a deliberate split:
 *
 *   createRequestClient  -- carries the signed-in user's session. Every query
 *                           it makes is subject to RLS. This is the default,
 *                           and almost all data access goes through it.
 *
 *   createServiceClient  -- bypasses RLS. Used only where a request must read
 *                           or write something the user legitimately cannot
 *                           see yet (validating an invitation before they are
 *                           a member) or infrastructure rows (email delivery
 *                           state). Never reachable from the browser.
 *
 * The service-role key is imported from $env/dynamic/private, which SvelteKit
 * refuses to bundle into client code.
 */
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { getConfig } from './env';
import type { Database } from '$lib/types/database';

export type Db = SupabaseClient<Database>;

/**
 * A client bound to this request's cookies, so token refreshes are written
 * back to the response.
 */
export function createRequestClient(event: RequestEvent): Db {
	const config = getConfig();

	return createServerClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					event.cookies.set(name, value, {
						...options,
						path: options?.path ?? '/',
						httpOnly: true,
						sameSite: 'lax',
						secure: !event.url.hostname.match(/^(localhost|127\.0\.0\.1|\[::1\])$/)
					});
				}
			}
		}
	});
}

/**
 * An RLS-bypassing client. Call this only after the caller's authority has
 * already been established in server code, and keep its use narrow.
 */
export function createServiceClient(): Db {
	const config = getConfig();

	return createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
		auth: {
			autoRefreshToken: false,
			persistSession: false,
			detectSessionInUrl: false
		}
	});
}
