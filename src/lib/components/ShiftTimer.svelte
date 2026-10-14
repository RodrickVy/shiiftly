<script lang="ts">
	/**
	 * Live shift timer.
	 *
	 * Counts from the server-recorded start instant, not from when the page
	 * loaded, so it survives a refresh, a locked phone and a reconnection --
	 * all it ever does is re-read the wall clock and subtract.
	 *
	 * The device clock can be wrong, so the offset between this browser and
	 * the server (measured once, server-side, at render) is applied before
	 * displaying. Without that a phone set ten minutes fast would show ten
	 * extra minutes of work.
	 */
	import { formatTimer } from '$lib/domain/attendance';

	let {
		startedAt,
		serverNow,
		pausedSince = null,
		pausedTotalSeconds = 0,
		label = 'Elapsed'
	}: {
		startedAt: string;
		/** The server's clock at render time, for drift correction. */
		serverNow: string;
		/** When the current break began, if one is in progress. */
		pausedSince?: string | null;
		/** Seconds already spent on completed breaks. */
		pausedTotalSeconds?: number;
		label?: string;
	} = $props();

	// Positive when this device's clock runs ahead of the server's. Recomputed
	// whenever a fresh server timestamp arrives, taking the moment of receipt
	// as the reference point.
	const driftMs = $derived(Date.now() - new Date(serverNow).getTime());

	let tick = $state(Date.now());

	$effect(() => {
		const id = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const seconds = $derived.by(() => {
		const correctedNow = tick - driftMs;
		const gross = Math.floor((correctedNow - new Date(startedAt).getTime()) / 1000);
		const onBreakNow = pausedSince
			? Math.floor((correctedNow - new Date(pausedSince).getTime()) / 1000)
			: 0;
		return Math.max(0, gross - pausedTotalSeconds - Math.max(0, onBreakNow));
	});
</script>

<div class="text-center">
	<p class="hint !mt-0">{label}</p>
	<p class="tnum text-4xl font-bold sm:text-5xl" aria-live="off">{formatTimer(seconds)}</p>
	{#if pausedSince}
		<p class="hint !mt-0">Paused while you are on a break</p>
	{/if}
</div>
