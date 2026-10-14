import type { Session, User } from '@supabase/supabase-js';
import type { Db } from '$lib/server/supabase';
import type { OrgContext } from '$lib/server/context';

declare global {
	namespace App {
		interface Error {
			code?: string;
		}

		interface Locals {
			/** Request-scoped Supabase client carrying the user's session. */
			supabase: Db;
			/** Validates the session against the auth server before trusting it. */
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			session: Session | null;
			user: User | null;
			/** Resolved active organization, membership and settings. */
			org: OrgContext | null;
			/** True when required environment variables are present. */
			configured: boolean;
		}

		interface PageData {
			session?: Session | null;
		}
	}
}

export {};
