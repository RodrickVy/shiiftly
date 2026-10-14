<script lang="ts">
	import { goto } from '$app/navigation';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let status = $state<'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error'>(
		'idle'
	);
	let errorMessage = $state('');
	let manualCode = $state('');
	let showManual = $state(false);

	/**
	 * Only ever follow a code that points at this origin's clock route. A QR
	 * code is untrusted input: without this check a sticker in the car park
	 * could send staff to any site it liked.
	 */
	function clockPathFrom(decoded: string): string | null {
		const direct = decoded.trim();

		try {
			const url = new URL(direct, window.location.origin);
			if (url.origin !== window.location.origin) return null;
			const match = url.pathname.match(/^\/clock\/([A-Za-z0-9_-]+)\/?$/);
			return match ? `/clock/${match[1]}` : null;
		} catch {
			return null;
		}
	}

	$effect(() => {
		if (!video) return;

		let scanner: { destroy: () => void; start: () => Promise<void> } | null = null;
		let cancelled = false;

		(async () => {
			status = 'starting';
			try {
				const { default: QrScanner } = await import('qr-scanner');
				const workerPath = (await import('qr-scanner/qr-scanner-worker.min.js?url')).default;
				QrScanner.WORKER_PATH = workerPath;

				if (!(await QrScanner.hasCamera())) {
					status = 'unavailable';
					return;
				}

				const instance = new QrScanner(
					video!,
					(result: { data: string }) => {
						const path = clockPathFrom(result.data);
						if (!path) {
							errorMessage = 'That code is not a Shiftly station code.';
							return;
						}
						instance.stop();
						void goto(path);
					},
					{
						preferredCamera: 'environment',
						highlightScanRegion: true,
						highlightCodeOutline: true,
						maxScansPerSecond: 5
					}
				);

				scanner = instance as unknown as { destroy: () => void; start: () => Promise<void> };
				if (cancelled) return;

				await instance.start();
				status = 'scanning';
			} catch (err) {
				const message = (err as Error)?.message ?? '';
				if (/permission|denied|NotAllowed/i.test(message)) {
					status = 'denied';
				} else {
					status = 'error';
					errorMessage = message || 'The camera could not be started.';
				}
			}
		})();

		return () => {
			cancelled = true;
			scanner?.destroy();
		};
	});

	function submitManual(event: SubmitEvent) {
		event.preventDefault();
		const path = clockPathFrom(manualCode);
		if (!path) {
			errorMessage = 'That does not look like a station code or link.';
			return;
		}
		void goto(path);
	}
</script>

<svelte:head><title>Scan station code — Shiftly</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-5">
	<header class="mb-4 text-center">
		<h1 class="text-xl font-bold">Scan to clock in or out</h1>
		<p class="hint">Point your camera at the station code.</p>
	</header>

	<div
		class="relative overflow-hidden rounded-2xl"
		style="background: #000; aspect-ratio: 1 / 1"
	>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} class="h-full w-full object-cover" playsinline muted></video>

		{#if status === 'starting'}
			<div class="absolute inset-0 grid place-items-center text-white">
				<p class="text-sm">Starting the camera...</p>
			</div>
		{/if}
	</div>

	{#if status === 'denied'}
		<div class="mt-4">
			<Alert tone="warn" title="Camera permission is needed">
				Allow camera access in your browser settings, then reload this page. You can also enter
				the code by hand below.
			</Alert>
		</div>
	{:else if status === 'unavailable'}
		<div class="mt-4">
			<Alert tone="warn" title="No camera found">
				This device has no camera available. Enter the station code by hand instead.
			</Alert>
		</div>
	{:else if status === 'error'}
		<div class="mt-4"><Alert tone="danger" title="The camera failed">{errorMessage}</Alert></div>
	{:else if errorMessage}
		<div class="mt-4"><Alert tone="danger">{errorMessage}</Alert></div>
	{/if}

	<p class="hint mt-4 text-center">
		Your phone's own camera app works too — it will open the same link.
	</p>

	<div class="mt-4">
		{#if showManual}
			<form onsubmit={submitManual} class="card px-4 py-4">
				<label class="label" for="manual-code">Station link or code</label>
				<input
					id="manual-code"
					class="input"
					bind:value={manualCode}
					placeholder="https://.../clock/..."
					autocomplete="off"
				/>
				<button type="submit" class="btn btn-primary mt-3 w-full">Continue</button>
			</form>
		{:else}
			<button type="button" class="btn btn-ghost w-full" onclick={() => (showManual = true)}>
				<Icon name="more" size={18} />
				Enter the code by hand
			</button>
		{/if}
	</div>

	<p class="hint mt-4 text-center">{data.organizationName}</p>
</div>
