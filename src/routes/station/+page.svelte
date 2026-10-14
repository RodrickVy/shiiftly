<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let now = $state(new Date());
	let container = $state<HTMLDivElement | null>(null);
	let isFullscreen = $state(false);

	$effect(() => {
		const id = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(id);
	});

	// When the local day rolls over the code must be replaced, not relabelled.
	const expired = $derived(data.qr ? new Date(data.qr.expiresAt) <= now : false);
	$effect(() => {
		if (expired) void invalidateAll();
	});

	const time = $derived(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(now)
	);

	const date = $derived(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(now)
	);

	async function toggleFullscreen() {
		if (!document.fullscreenElement) await container?.requestFullscreen?.().catch(() => {});
		else await document.exitFullscreen().catch(() => {});
	}

	$effect(() => {
		const onChange = () => (isFullscreen = Boolean(document.fullscreenElement));
		document.addEventListener('fullscreenchange', onChange);
		return () => document.removeEventListener('fullscreenchange', onChange);
	});
</script>

<svelte:head><title>{data.stationName} — Shiftly</title></svelte:head>

<div
	bind:this={container}
	class="flex min-h-dvh flex-col items-center justify-center px-5 py-6"
	style="background: var(--surface)"
>
	<div class="absolute top-3 right-3 flex gap-2">
		<button type="button" class="btn btn-ghost" onclick={toggleFullscreen}>
			<Icon name="expand" size={20} />
			<span class="hidden sm:inline">{isFullscreen ? 'Exit' : 'Fullscreen'}</span>
		</button>
		{#if !isFullscreen}
			{#if data.isStation}
				<form method="POST" action="/auth/signout">
					<button type="submit" class="btn btn-ghost">Sign out</button>
				</form>
			{:else}
				<a href="/app/station" class="btn btn-ghost">Manage</a>
			{/if}
		{/if}
	</div>

	{#if data.disabled}
		<div class="max-w-md text-center">
			<Alert tone="danger" title="This station is disabled">
				A manager has turned this device off. It will start working again as soon as the
				station is re-enabled.
			</Alert>
		</div>
	{:else if data.qr}
		<p class="text-center text-lg font-medium" style="color: var(--text-muted)">
			{data.organizationName}
		</p>
		<h1 class="text-center text-3xl font-bold sm:text-4xl">{data.stationName}</h1>

		<p class="mt-1 text-center" style="color: var(--text-muted)">{date}</p>
		<p class="tnum text-center text-5xl font-bold sm:text-6xl">{time}</p>

		<img
			src={data.qr.dataUrl}
			alt="Scan to clock in or out"
			class="mt-6 h-auto w-[min(70vh,80vw)] max-w-lg rounded-2xl border bg-white p-4"
			style="border-color: var(--border)"
		/>

		<p class="mt-5 text-center text-xl font-semibold">Scan to clock in or out</p>
		<p class="mt-1 text-center" style="color: var(--text-muted)">
			Open your phone camera and point it at the code.
		</p>

		{#if expired}
			<p class="badge badge-danger mt-4">Code expired &mdash; loading today's code</p>
		{:else}
			<p class="badge badge-ok mt-4">Valid today</p>
		{/if}
	{/if}
</div>
