import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { formError, formFailure, fullNameSchema, parseForm, phoneSchema } from '$lib/schemas';
import { ACTIVE_ORG_COOKIE } from '$lib/server/context';
import type { Actions, PageServerLoad } from './$types';

const profileSchema = z.object({
	fullName: fullNameSchema,
	phone: z.union([phoneSchema, z.literal('')]).optional()
});

export const load: PageServerLoad = async ({ locals }) => {
	const org = locals.org;
	if (!org || !locals.user) throw redirect(303, '/onboarding/organization');

	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('full_name, email, phone')
		.eq('id', locals.user.id)
		.maybeSingle();

	return {
		profile: {
			fullName: profile?.full_name ?? '',
			email: profile?.email ?? locals.user.email ?? '',
			phone: profile?.phone ?? ''
		},
		employment: {
			role: org.membership.role,
			jobTitle: org.membership.job_title,
			department: org.membership.department,
			employeeCode: org.membership.employee_code,
			startDate: org.membership.start_date,
			joinedAt: org.membership.joined_at
		},
		organization: {
			name: org.organization.name,
			timezone: org.organization.timezone,
			currency: org.organization.currency_code
		},
		memberships: org.memberships
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		if (!locals.user) throw redirect(303, '/login');

		const parsed = parseForm(profileSchema, await request.formData());
		if (!parsed.ok) return fail(400, formFailure(parsed.errors, parsed.values));

		// Employment details (job title, rate, role) are a manager's to set;
		// this only touches the person's own profile.
		const { error } = await locals.supabase
			.from('profiles')
			.update({
				full_name: parsed.data.fullName,
				phone: parsed.data.phone || null
			})
			.eq('id', locals.user.id);

		if (error) return fail(500, formError('Your profile could not be saved.'));
		return { saved: true as const };
	},

	switchOrganization: async ({ request, locals, cookies }) => {
		if (!locals.org) throw redirect(303, '/login');

		const organizationId = String((await request.formData()).get('organizationId') ?? '');

		// Only an organization the user actually belongs to.
		const allowed = locals.org.memberships.some((m) => m.organizationId === organizationId);
		if (!allowed) return fail(403, formError('You are not a member of that organization.'));

		cookies.set(ACTIVE_ORG_COOKIE, organizationId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});

		throw redirect(303, '/app');
	}
};
