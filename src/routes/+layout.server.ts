import type { LayoutServerLoad } from './$types';

/**
 * Exposes only what the browser needs. The full session object is not sent to
 * the client; pages that need identity get the resolved user and org context.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	return {
		signedIn: Boolean(locals.user),
		pathname: url.pathname,
		org: locals.org
			? {
					id: locals.org.organization.id,
					name: locals.org.organization.name,
					currency: locals.org.organization.currency_code,
					timezone: locals.org.organization.timezone,
					isManager: locals.org.isManager,
					isOwner: locals.org.isOwner,
					role: locals.org.membership.role,
					memberships: locals.org.memberships
				}
			: null
	};
};
