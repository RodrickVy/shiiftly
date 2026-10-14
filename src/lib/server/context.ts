/**
 * Organization context for a request.
 *
 * A user may belong to several organizations. Exactly one is "active" per
 * request, chosen by a cookie and always re-validated against the database --
 * a tampered cookie naming an organization the user does not belong to simply
 * falls back to one they do.
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { Db } from './supabase';
import type {
	MembershipRole,
	Organization,
	OrganizationMembership,
	OrganizationSettings
} from '$lib/types/database';

export const ACTIVE_ORG_COOKIE = 'shiftly_org';

export interface MembershipSummary {
	id: string;
	organizationId: string;
	organizationName: string;
	role: MembershipRole;
}

export interface OrgContext {
	membership: OrganizationMembership;
	organization: Organization;
	settings: OrganizationSettings;
	/** Every organization this user can switch to. */
	memberships: MembershipSummary[];
	isManager: boolean;
	isOwner: boolean;
}

/**
 * Resolves the active organization, or null when the user has no active
 * membership anywhere (a freshly signed-up owner, before onboarding).
 */
export async function loadOrgContext(
	supabase: Db,
	event: RequestEvent,
	userId: string
): Promise<OrgContext | null> {
	const { data: rows, error } = await supabase
		.from('organization_memberships')
		.select('*, organizations(*)')
		.eq('user_id', userId)
		.eq('status', 'active')
		.order('joined_at', { ascending: true });

	if (error || !rows || rows.length === 0) return null;

	type Row = OrganizationMembership & { organizations: Organization | null };
	const memberships = rows as unknown as Row[];
	const usable = memberships.filter((m) => m.organizations !== null);
	if (usable.length === 0) return null;

	const requested = event.cookies.get(ACTIVE_ORG_COOKIE);
	const active = usable.find((m) => m.organization_id === requested) ?? usable[0];

	const { data: settings } = await supabase
		.from('organization_settings')
		.select('*')
		.eq('organization_id', active.organization_id)
		.single();

	const { organizations, ...membership } = active;

	return {
		membership: membership as OrganizationMembership,
		organization: organizations as Organization,
		// Settings are created with the organization; fall back to the
		// schema defaults rather than failing the whole request.
		settings: (settings as OrganizationSettings | null) ?? defaultSettings(active.organization_id),
		memberships: usable.map((m) => ({
			id: m.id,
			organizationId: m.organization_id,
			organizationName: m.organizations!.name,
			role: m.role
		})),
		isManager: active.role === 'owner' || active.role === 'manager',
		isOwner: active.role === 'owner'
	};
}

function defaultSettings(organizationId: string): OrganizationSettings {
	return {
		organization_id: organizationId,
		qr_clocking_enabled: true,
		direct_clocking_enabled: true,
		break_mode: 'none',
		automatic_break_minutes: 30,
		automatic_break_threshold_minutes: 360,
		minimum_shift_minutes: null,
		timesheet_approval_required: true,
		allow_manager_corrections: true,
		employee_earnings_visible: true,
		notify_managers_on_time_off: true,
		notify_employee_on_decision: true,
		updated_at: new Date().toISOString()
	};
}
