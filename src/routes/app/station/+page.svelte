<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let showAdd = $state(false);
	let pending = $state(false);
	let now = $state(new Date());

	// A visible clock reassures whoever is watching the screen that it is live.
	$effect(() => {
		const id = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(id);
	});

	const localTime = $derived(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false
		}).format(now)
	);

	const localDateLabel = $derived(
		new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(now)
	);

	// The code is valid until the next local midnight; refresh when it passes.
	const expired = $derived(data.qr ? new Date(data.qr.expiresAt) <= now : false);
	$effect(() => {
		if (expired) void invalidateAll();
	});

	function timeAt(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>Clocking station — Shiftly</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-5">
	<header class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Clocking station</h1>
			<p class="hint">Staff scan this code to clock in or out.</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if data.selected}
				<a href="/app/station/display/{data.selected.id}" class="btn btn-secondary">
					<Icon name="expand" size={18} />
					Fullscreen
				</a>
			{/if}
			<button type="button" class="btn btn-primary" onclick={() => (showAdd = true)}>
				<Icon name="plus" size={18} />
				Add station
			</button>
		</div>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}

	{#if !data.qrEnabled}
		<div class="mb-4">
			<Alert tone="warn" title="QR clocking is switched off">
				Staff cannot clock in by scanning until you enable it in
				<a href="/app/settings" class="underline">Settings</a>.
			</Alert>
		</div>
	{/if}

	{#if data.stations.filter((s) => s.is_active).length > 1}
		<div class="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Stations">
			{#each data.stations.filter((s) => s.is_active) as station (station.id)}
				<a
					href="/app/station?station={station.id}"
					class="btn {data.selected?.id === station.id ? 'btn-primary' : 'btn-secondary'}"
					role="tab"
					aria-selected={data.selected?.id === station.id}
				>
					{station.name}
				</a>
			{/each}
		</div>
	{/if}

	{#if !data.selected}
		<Card>
			<EmptyState
				title="No active station yet"
				description="A station is the screen your team scans. Most businesses have one, at the entrance."
			>
				<button type="button" class="btn btn-primary" onclick={() => (showAdd = true)}>
					Add your first station
				</button>
			</EmptyState>
		</Card>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<!-- The code itself -->
			<section class="card px-5 py-6 text-center">
				<p class="hint !mt-0">{data.org?.name}</p>
				<h2 class="text-lg font-semibold">{data.selected.name}</h2>
				<p class="hint">{localDateLabel}</p>
				<p class="tnum mt-1 text-3xl font-bold">{localTime}</p>

				{#if data.qr}
					<div class="mt-5 flex justify-center">
						<img
							src={data.qr.dataUrl}
							alt="QR code for clocking in and out at {data.selected.name}"
							class="h-auto w-full max-w-xs rounded-xl border bg-white p-3"
							style="border-color: var(--border)"
						/>
					</div>

					<div class="mt-4 flex flex-col items-center gap-2">
						{#if expired}
							<span class="badge badge-danger">Expired — refreshing</span>
						{:else}
							<span class="badge badge-ok">Valid today only</span>
						{/if}
						<p class="hint !mt-0">
							This code stops working at midnight {data.timezone.replace(/_/g, ' ')}.
						</p>
					</div>
				{/if}

				<p class="hint mx-auto mt-5 max-w-sm">
					Scanning records attendance conveniently. It is not proof that someone was present:
					a code on a screen can be photographed and shared.
				</p>
			</section>

			<!-- Activity -->
			<div class="flex flex-col gap-4">
				<Card title="Recent scans" subtitle="At this station">
					{#if data.recentScans.length === 0}
						<p class="hint !mt-0">No scans yet today.</p>
					{:else}
						<ul class="-my-1 divide-y" style="border-color: var(--border)">
							{#each data.recentScans as scan (scan.id)}
								<li class="flex items-center justify-between gap-3 py-2">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">{scan.name}</p>
										<p class="hint !mt-0">
											{scan.eventType === 'clock_in' ? 'Clocked in' : 'Clocked out'}
										</p>
									</div>
									<span class="tnum shrink-0 text-sm" style="color: var(--text-muted)">
										{timeAt(scan.occurredAt)}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</Card>

				<Card title="Station">
					<p class="text-sm font-medium">{data.selected.name}</p>
					<p class="hint !mt-0">Active</p>
					<form
						method="POST"
						action="?/deactivateStation"
						class="mt-3"
						use:enhance={() => {
							pending = true;
							return async ({ update }) => {
								await update();
								pending = false;
							};
						}}
					>
						<input type="hidden" name="stationId" value={data.selected.id} />
						<SubmitButton {pending} variant="secondary" pendingLabel="Deactivating...">
							Deactivate station
						</SubmitButton>
					</form>
					<p class="hint">
						Deactivating stops new scans. Recorded attendance is kept.
					</p>
				</Card>
			</div>
		</div>
	{/if}
</div>

<Modal bind:open={showAdd} title="Add a clocking station">
	<form
		method="POST"
		action="?/createStation"
		id="add-station-form"
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update();
				pending = false;
				showAdd = false;
			};
		}}
	>
		<Field
			label="Station name"
			name="name"
			hint="Where the screen will be, e.g. Front entrance or Workshop door."
			error={form?.errors?.name}
			required
		>
			{#snippet children({ id, describedBy, invalid })}
				<input
					{id}
					name="name"
					type="text"
					class="input"
					required
					maxlength="80"
					aria-invalid={invalid}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>
	</form>

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (showAdd = false)}>
			Cancel
		</button>
		<button type="submit" form="add-station-form" class="btn btn-primary" disabled={pending}>
			Add station
		</button>
	{/snippet}
</Modal>
