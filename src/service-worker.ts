/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Service worker.
 *
 * Deliberately conservative. It precaches the app shell and static assets so
 * the interface loads quickly on a slow connection, and serves them from
 * cache when the network is unavailable.
 *
 * It does NOT cache or queue any attendance data. Clock-in and clock-out must
 * reach the server to be real: a cached "success" or a replayed request would
 * invent a timestamp, which is exactly what the specification forbids. Offline
 * attendance capture is a deliberate future feature, not an accident of
 * caching.
 */

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `shiftly-${version}`;
// Built assets are content-hashed; static files are versioned by `version`.
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;

	// Only ever touch plain GETs for our own origin.
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// Never serve navigation or API responses from cache: attendance state,
	// shift timers and approvals must reflect the server right now.
	if (request.mode === 'navigate') return;
	if (url.pathname.startsWith('/clock/') || url.pathname.startsWith('/app/')) return;

	const isPrecached = PRECACHE.includes(url.pathname);

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			if (isPrecached) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			try {
				const response = await fetch(request);
				// Opaque and error responses are not worth storing.
				if (response.ok && response.type === 'basic') {
					cache.put(request, response.clone());
				}
				return response;
			} catch (error) {
				const cached = await cache.match(request);
				if (cached) return cached;
				throw error;
			}
		})()
	);
});
