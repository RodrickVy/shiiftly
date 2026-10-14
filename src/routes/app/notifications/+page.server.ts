import { fail, redirect } from '@sveltejs/kit';
import { formError } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';
import type { Notification } from '$lib/types/database';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');

	// RLS restricts this to the caller's own notifications.
	const { data } = await locals.supabase
		.from('notifications')
		.select('*')
		.order('created_at', { ascending: false })
		.limit(100);

	return { notifications: (data ?? []) as Notification[] };
};

export const actions: Actions = {
	markRead: async ({ request, locals }) => {
		if (!locals.user) throw redirect(303, '/login');

		const id = String((await request.formData()).get('id') ?? '');
		const query = locals.supabase
			.from('notifications')
			.update({ read_at: new Date().toISOString() })
			.is('read_at', null);

		const { error } = id ? await query.eq('id', id) : await query;
		if (error) return fail(500, formError('Those notifications could not be updated.'));
		return { success: true as const };
	}
};
