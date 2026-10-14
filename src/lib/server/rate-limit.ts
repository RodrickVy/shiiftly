/**
 * Rate limiting for authentication and other abusable endpoints.
 *
 * In-memory and therefore per-instance: on a serverless platform each cold
 * instance keeps its own counters, so this raises the cost of credential
 * stuffing and invitation/QR token guessing without being a hard guarantee.
 * Supabase Auth applies its own limits underneath, and a shared store
 * (Redis/Upstash) is the natural upgrade.
 *
 * Documented rather than silently approximated, because a limiter that
 * quietly does less than it appears to is worse than none.
 */

interface Bucket {
	count: number;
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Evicts expired buckets so the map cannot grow without bound. */
function sweep(now: number): void {
	if (buckets.size < 5000) return;
	for (const [key, bucket] of buckets) {
		if (bucket.resetAt <= now) buckets.delete(key);
	}
}

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
	const now = Date.now();
	sweep(now);

	const existing = buckets.get(key);
	if (!existing || existing.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
		return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
	}

	existing.count++;
	if (existing.count > limit) {
		return {
			allowed: false,
			remaining: 0,
			retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
		};
	}

	return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/**
 * A caller identity for limiting. Prefers the authenticated user; falls back
 * to the forwarded client address.
 */
export function limiterKey(
	scope: string,
	parts: { userId?: string | null; ip?: string | null; extra?: string }
): string {
	const who = parts.userId ?? parts.ip ?? 'anonymous';
	return `${scope}:${who}${parts.extra ? `:${parts.extra}` : ''}`;
}

/** Clears all counters. Test helper. */
export function resetRateLimits(): void {
	buckets.clear();
}
