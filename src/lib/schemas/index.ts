/**
 * Input validation.
 *
 * Every schema here runs on the server. Where the same shape is also checked
 * in the browser it is for the user's benefit only -- the server never trusts
 * that it happened.
 */
import { z } from 'zod';
import { isValidTimeZone } from '$lib/domain/time';

/** E.164, which is what the database CHECK constraint enforces. */
export const phoneSchema = z
	.string()
	.trim()
	.regex(/^\+[1-9]\d{6,14}$/, 'Enter a phone number in international format, e.g. +254712345678');

export const optionalPhone = z
	.union([phoneSchema, z.literal('')])
	.transform((v) => (v === '' ? null : v))
	.nullable();

export const emailSchema = z.email('Enter a valid email address').trim().toLowerCase();

export const passwordSchema = z
	.string()
	.min(10, 'Use at least 10 characters')
	.max(200, 'That password is too long');

export const fullNameSchema = z
	.string()
	.trim()
	.min(2, 'Enter your full name')
	.max(120, 'That name is too long');

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

export const signUpSchema = z
	.object({
		fullName: fullNameSchema,
		email: emailSchema,
		password: passwordSchema,
		confirmPassword: z.string()
	})
	.refine((v) => v.password === v.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

export const signInSchema = z.object({
	email: emailSchema,
	password: z.string().min(1, 'Enter your password')
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
	.object({ password: passwordSchema, confirmPassword: z.string() })
	.refine((v) => v.password === v.confirmPassword, {
		message: 'Passwords do not match',
		path: ['confirmPassword']
	});

// --------------------------------------------------------------------------
// Organization
// --------------------------------------------------------------------------

export const createOrganizationSchema = z.object({
	name: z.string().trim().min(2, 'Enter your organization name').max(120),
	industry: z.string().trim().max(80).optional().or(z.literal('')),
	countryCode: z
		.string()
		.trim()
		.length(2, 'Choose a country')
		.transform((v) => v.toUpperCase()),
	timezone: z.string().trim().refine(isValidTimeZone, 'Choose a valid timezone'),
	currencyCode: z
		.string()
		.trim()
		.length(3, 'Choose a currency')
		.transform((v) => v.toUpperCase()),
	weekStartsOn: z.coerce.number().int().min(0).max(6).default(1)
});

export const organizationSettingsSchema = z.object({
	qrClockingEnabled: z.coerce.boolean().default(false),
	directClockingEnabled: z.coerce.boolean().default(false),
	breakMode: z.enum(['automatic', 'manual', 'none']),
	automaticBreakMinutes: z.coerce.number().int().min(0).max(480),
	automaticBreakThresholdMinutes: z.coerce.number().int().min(0).max(1440),
	timesheetApprovalRequired: z.coerce.boolean().default(false),
	allowManagerCorrections: z.coerce.boolean().default(false),
	employeeEarningsVisible: z.coerce.boolean().default(false),
	notifyManagersOnTimeOff: z.coerce.boolean().default(false),
	notifyEmployeeOnDecision: z.coerce.boolean().default(false)
});

export const organizationProfileSchema = z.object({
	name: z.string().trim().min(2).max(120),
	industry: z.string().trim().max(80).optional().or(z.literal('')),
	countryCode: z.string().trim().length(2).transform((v) => v.toUpperCase()),
	timezone: z.string().trim().refine(isValidTimeZone, 'Choose a valid timezone'),
	currencyCode: z.string().trim().length(3).transform((v) => v.toUpperCase()),
	weekStartsOn: z.coerce.number().int().min(0).max(6)
});

// --------------------------------------------------------------------------
// Invitations
// --------------------------------------------------------------------------

export const createInvitationSchema = z
	.object({
		role: z.enum(['employee', 'manager']),
		email: z.union([emailSchema, z.literal('')]).optional(),
		maxUses: z.coerce.number().int().min(1).max(500).default(1),
		expiresInDays: z.coerce.number().int().min(1).max(90).default(7)
	})
	.refine((v) => !v.email || v.maxUses === 1, {
		message: 'An invitation addressed to one person can only be used once',
		path: ['maxUses']
	});

export const acceptInvitationSchema = z.object({
	fullName: fullNameSchema,
	phone: z.union([phoneSchema, z.literal('')]).optional()
});

// --------------------------------------------------------------------------
// Stations
// --------------------------------------------------------------------------

export const createStationSchema = z.object({
	name: z.string().trim().min(1, 'Give the station a name').max(80)
});

// --------------------------------------------------------------------------
// Employees
// --------------------------------------------------------------------------

export const employmentDetailsSchema = z.object({
	jobTitle: z.string().trim().max(80).optional().or(z.literal('')),
	department: z.string().trim().max(80).optional().or(z.literal('')),
	employeeCode: z.string().trim().max(40).optional().or(z.literal('')),
	startDate: z.union([z.iso.date(), z.literal('')]).optional()
});

export const payRateSchema = z.object({
	hourlyRate: z
		.string()
		.trim()
		.regex(/^\d{1,9}([.,]\d{1,2})?$/, 'Enter an amount such as 250.00'),
	effectiveFrom: z.iso.date('Choose a start date')
});

// --------------------------------------------------------------------------
// Tasks
// --------------------------------------------------------------------------

export const createTaskSchema = z.object({
	title: z.string().trim().min(1, 'Give the task a title').max(160),
	description: z.string().trim().max(2000).optional().or(z.literal('')),
	priority: z.enum(['low', 'medium', 'high']).default('medium'),
	dueAt: z.union([z.iso.datetime({ local: true }), z.iso.date(), z.literal('')]).optional(),
	assignees: z.array(z.uuid()).default([])
});

export const updateTaskStatusSchema = z.object({
	taskId: z.uuid(),
	status: z.enum(['todo', 'in_progress', 'completed', 'cancelled'])
});

// --------------------------------------------------------------------------
// Time off
// --------------------------------------------------------------------------

export const LEAVE_TYPES = [
	'Vacation',
	'Sick Leave',
	'Personal Leave',
	'Unpaid Leave',
	'Other'
] as const;

export const timeOffRequestSchema = z
	.object({
		leaveType: z.enum(LEAVE_TYPES),
		startDate: z.iso.date('Choose a start date'),
		endDate: z.iso.date('Choose an end date'),
		reason: z.string().trim().max(1000).optional().or(z.literal(''))
	})
	.refine((v) => v.endDate >= v.startDate, {
		message: 'The end date cannot be before the start date',
		path: ['endDate']
	});

export const reviewTimeOffSchema = z.object({
	requestId: z.uuid(),
	decision: z.enum(['approved', 'rejected']),
	comment: z.string().trim().max(1000).optional().or(z.literal(''))
});

// --------------------------------------------------------------------------
// Attendance corrections
// --------------------------------------------------------------------------

export const attendanceCorrectionSchema = z
	.object({
		shiftId: z.uuid(),
		startedAt: z.iso.datetime({ local: true }),
		endedAt: z.union([z.iso.datetime({ local: true }), z.literal('')]).optional(),
		reason: z.string().trim().min(3, 'Explain why this correction is needed').max(1000)
	})
	.refine((v) => !v.endedAt || v.endedAt > v.startedAt, {
		message: 'The end time must be after the start time',
		path: ['endedAt']
	});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

export type FieldErrors = Record<string, string[]>;

/** Turns a ZodError into the flat shape the form components expect. */
export function fieldErrors(error: z.ZodError): FieldErrors {
	const flat = z.flattenError(error);
	const errors: FieldErrors = { ...flat.fieldErrors } as FieldErrors;
	if (flat.formErrors.length > 0) errors._form = flat.formErrors;
	return errors;
}

/**
 * Parses FormData with a schema, returning either the typed value or the
 * errors plus the submitted values so the form can be re-rendered filled in.
 */
export function parseForm<S extends z.ZodType>(
	schema: S,
	formData: FormData
): { ok: true; data: z.output<S> } | { ok: false; errors: FieldErrors; values: Record<string, string> } {
	const raw: Record<string, unknown> = {};
	const values: Record<string, string> = {};

	for (const [key, value] of formData.entries()) {
		if (typeof value !== 'string') continue;
		if (key.endsWith('[]')) {
			const name = key.slice(0, -2);
			(raw[name] ??= [] as string[]) as string[];
			(raw[name] as string[]).push(value);
			continue;
		}
		raw[key] = value;
		// Never echo a password back into the rendered form.
		if (!/password/i.test(key)) values[key] = value;
	}

	const result = schema.safeParse(raw);
	if (result.success) return { ok: true, data: result.data };
	return { ok: false, errors: fieldErrors(result.error), values };
}

/**
 * Builds a uniformly typed failure payload.
 *
 * Form actions return several different failure branches; without this the
 * inferred `form.errors` type is a union of narrow object literals and the
 * page cannot read `errors.email` without a cast.
 */
export function formFailure(
	errors: FieldErrors,
	values: Record<string, string> = {}
): { errors: FieldErrors; values: Record<string, string> } {
	return { errors, values };
}

/** Shorthand for a single whole-form message. */
export function formError(
	message: string,
	values: Record<string, string> = {}
): { errors: FieldErrors; values: Record<string, string> } {
	return { errors: { _form: [message] }, values };
}
