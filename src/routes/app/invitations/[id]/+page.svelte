<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let copied = $state(false);
	let container = $state<HTMLDivElement | null>(null);
	let isFullscreen = $state(false);

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(data.link);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	}

	async function toggleFullscreen() {
		if (!document.fullscreenElement) await container?.requestFullscreen?.().catch(() => {});
		else await document.exitFullscreen().catch(() => {});
	}

	$effect(() => {
		const onChange = () => (isFullscreen = Boolean(document.fullscreenElement));
		document.addEventListener('fullscreenchange', onChange);
		return () => document.removeEventListener('fullscreenchange', onChange);
	});

	const problem = $derived(
		{
			revoked: 'This invitation has been revoked, so the code no longer works.',
			expired: 'This invitation has expired. Create a new one to get a working code.',
			used: 'This invitation has reached its usage limit.',
			active: ''
		}[data.status]
	);

	const remaining = $derived(data.invitation.maxUses - data.invitation.useCount);

	function expiryLabel(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>Invitation code — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-5">
	<nav class="mb-3 flex items-center justify-between gap-2 print:hidden">
		<a href="/app/invitations" class="text-sm" style="color: var(--color-brand-600)">
			&larr; All invitations
		</a>
		<div class="flex gap-2">
			<button type="button" class="btn btn-ghost" onclick={() => window.print()}>
				Print
			</button>
			{#if data.qrDataUrl}
				<button type="button" class="btn btn-secondary" onclick={toggleFullscreen}>
					<Icon name="expand" size={18} />
					{isFullscreen ? 'Exit' : 'Fullscreen'}
				</button>
			{/if}
		</div>
	</nav>

	{#if problem}
		<div class="mb-4 print:hidden"><Alert tone="danger" title="This code is not usable">{problem}</Alert></div>
	{/if}

	<div
		bind:this={container}
		class="card flex flex-col items-center px-5 py-7 text-center"
		style="background: var(--surface)"
	>
		<p class="hint !mt-0">Join the team at</p>
		<h1 class="text-2xl font-bold sm:text-3xl">{data.organizationName}</h1>

		{#if data.qrDataUrl}
			<img
				src={data.qrDataUrl}
				alt="Scan to join {data.organizationName} on Shiftly"
				class="mt-5 h-auto w-[min(60vh,80vw)] max-w-sm rounded-2xl border bg-white p-4"
				style="border-color: var(--border)"
			/>

			<p class="mt-5 text-lg font-semibold">Scan to sign up</p>
			<p class="hint !mt-1 max-w-sm">
				Point your phone camera at the code. You will create your account and join
				{data.organizationName} automatically.
			</p>

			<p class="mt-4 text-sm" style="color: var(--text-muted)">
				Joining as <strong class="capitalize">{data.invitation.role}</strong>
				{#if data.invitation.invitedEmail}
					&middot; for {data.invitation.invitedEmail}
				{/if}
			</p>
			<p class="hint !mt-1">
				{remaining} of {data.invitation.maxUses} use{data.invitation.maxUses === 1 ? '' : 's'} left
				&middot; expires {expiryLabel(data.invitation.expiresAt)}
			</p>
		{:else}
			<div
				class="mt-6 flex h-56 w-56 items-center justify-center rounded-2xl border"
				style="border-color: var(--border); background: var(--surface-sunken); color: var(--text-muted)"
			>
				<span class="text-sm">No code &mdash; {data.status}</span>
			</div>
		{/if}
	</div>

	{#if data.qrDataUrl}
		<div class="mt-4 print:hidden">
			<p class="label">Or share the link</p>
			<div class="flex flex-col gap-2 sm:flex-row">
				<input class="input font-mono text-xs" readonly value={data.link} />
				<button type="button" class="btn btn-primary shrink-0" onclick={copyLink}>
					{copied ? 'Copied' : 'Copy link'}
				</button>
			</div>
			<p class="hint">
				Anyone with this code can join as
				<strong class="capitalize">{data.invitation.role}</strong>. Revoke it from the
				invitations list if it gets out.
			</p>
		</div>
	{/if}
</div>

<style>
	/* A printed invitation should be the code and nothing else. */
	@media print {
		:global(body) {
			background: #fff;
		}
		.card {
			border: none;
			box-shadow: none;
		}
	}
</style>
