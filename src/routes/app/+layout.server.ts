import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org || !locals.user) throw redirect(303, '/onboarding/organization');

	// Unread notification count drives the badge in the navigation.
	const { count } = await locals.supabase
		.from('notifications')
		.select('id', { count: 'exact', head: true })
		.eq('recipient_user_id', locals.user.id)
		.is('read_at', null);

	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name, email, avatar_url')
		.eq('id', locals.user.id)
		.maybeSingle();

	return {
		unreadCount: count ?? 0,
		profile: {
			fullName: profile?.full_name ?? locals.user.email ?? 'You',
			email: profile?.email ?? locals.user.email ?? '',
			avatarUrl: profile?.avatar_url ?? null
		},
		settings: {
			qrClockingEnabled: org.settings.qr_clocking_enabled,
			directClockingEnabled: org.settings.direct_clocking_enabled,
			breakMode: org.settings.break_mode,
			employeeEarningsVisible: org.settings.employee_earnings_visible
		}
	};
};
