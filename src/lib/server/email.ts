/**
 * Email delivery.
 *
 * Notifications are persisted by the database transaction that caused them
 * (see queue_notification in migration 0005). This module drains the pending
 * delivery rows afterwards. Consequences of that split, all deliberate:
 *
 *   - A time-off request is never lost because an email provider is down.
 *   - A delivery that fails is retryable, and carries its attempt count and
 *     last error.
 *   - A row moves to 'sent' only after the provider accepts it, so a retry
 *     cannot send the same message twice.
 *
 * With no RESEND_API_KEY configured, the development adapter logs the message
 * and marks the delivery 'failed' with an explicit reason. It does not record
 * a success for mail that was never sent.
 */
import { Resend } from 'resend';
import { getConfig, hasEmailProvider } from './env';
import { createServiceClient } from './supabase';

export interface OutboundEmail {
	to: string;
	subject: string;
	text: string;
}

export interface SendResult {
	ok: boolean;
	providerMessageId?: string;
	error?: string;
}

export interface EmailAdapter {
	readonly name: string;
	readonly isRealDelivery: boolean;
	send(message: OutboundEmail): Promise<SendResult>;
}

/** Sends through Resend. */
function resendAdapter(apiKey: string, from: string): EmailAdapter {
	const client = new Resend(apiKey);
	return {
		name: 'resend',
		isRealDelivery: true,
		async send(message) {
			try {
				const { data, error } = await client.emails.send({
					from,
					to: message.to,
					subject: message.subject,
					text: message.text
				});
				if (error) return { ok: false, error: error.message };
				return { ok: true, providerMessageId: data?.id };
			} catch (err) {
				return { ok: false, error: (err as Error).message };
			}
		}
	};
}

/**
 * Development adapter. Logs and reports failure, so nothing in the UI or the
 * delivery log claims an email was delivered when no provider exists.
 */
function devAdapter(): EmailAdapter {
	return {
		name: 'development-log',
		isRealDelivery: false,
		async send(message) {
			console.info(
				`[email:not-sent] RESEND_API_KEY is not configured.\n` +
					`  to:      ${message.to}\n` +
					`  subject: ${message.subject}\n` +
					`  body:    ${message.text.replace(/\n/g, '\n           ')}`
			);
			return { ok: false, error: 'No email provider configured (development adapter).' };
		}
	};
}

export function getEmailAdapter(): EmailAdapter {
	if (!hasEmailProvider()) return devAdapter();
	const { resendApiKey, emailFrom } = getConfig();
	return resendAdapter(resendApiKey!, emailFrom);
}

/** Highest number of attempts before a delivery is left alone. */
const MAX_ATTEMPTS = 5;

/**
 * Attempts pending (and previously failed) deliveries.
 *
 * Called opportunistically after an action that queues notifications. Kept
 * small and bounded so it never delays a user's request noticeably.
 */
export async function flushPendingEmails(limit = 20): Promise<{
	attempted: number;
	sent: number;
	failed: number;
	adapter: string;
}> {
	const adapter = getEmailAdapter();
	const service = createServiceClient();

	const { data: pending, error } = await service
		.from('notification_deliveries')
		.select('id, notification_id, attempts, notifications(title, body, recipient_user_id)')
		.neq('status', 'sent')
		.lt('attempts', MAX_ATTEMPTS)
		.order('created_at', { ascending: true })
		.limit(limit);

	if (error || !pending || pending.length === 0) {
		return { attempted: 0, sent: 0, failed: 0, adapter: adapter.name };
	}

	let sent = 0;
	let failed = 0;

	for (const row of pending) {
		const notification = row.notifications as unknown as {
			title: string;
			body: string;
			recipient_user_id: string;
		} | null;
		if (!notification) continue;

		// Resolve the recipient's address from auth, which the service role
		// may read and ordinary users may not.
		const { data: userResult } = await service.auth.admin.getUserById(
			notification.recipient_user_id
		);
		const to = userResult?.user?.email;

		if (!to) {
			await service
				.from('notification_deliveries')
				.update({
					status: 'failed',
					attempts: row.attempts + 1,
					last_attempt_at: new Date().toISOString(),
					last_error: 'Recipient has no email address'
				})
				.eq('id', row.id);
			failed++;
			continue;
		}

		const result = await adapter.send({
			to,
			subject: notification.title,
			text: `${notification.body}\n\n-- Shiftly`
		});

		await service
			.from('notification_deliveries')
			.update({
				status: result.ok ? 'sent' : 'failed',
				attempts: row.attempts + 1,
				last_attempt_at: new Date().toISOString(),
				provider_message_id: result.providerMessageId ?? null,
				last_error: result.ok ? null : (result.error ?? 'Unknown error')
			})
			.eq('id', row.id);

		if (result.ok) sent++;
		else failed++;
	}

	return { attempted: pending.length, sent, failed, adapter: adapter.name };
}

/**
 * Fire-and-forget flush. Never allowed to fail the request that triggered it:
 * the user's action already succeeded and is durable.
 */
export function flushPendingEmailsInBackground(): void {
	void flushPendingEmails().catch((err) => {
		console.error('[email] flush failed:', (err as Error).message);
	});
}

/**
 * A one-off email that is not tied to a notification row -- currently only
 * invitation links, which are addressed to people who have no account yet.
 */
export async function sendDirectEmail(message: OutboundEmail): Promise<SendResult> {
	return getEmailAdapter().send(message);
}
