<script lang="ts">
	import { enhance } from '$app/forms';
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
	let pending = $state('');
	let copied = $state('');

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => (copied = ''), 2500);
		} catch {
			copied = '';
		}
	}

	const enhanceFor = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = '';
		};
	};
</script>

<svelte:head><title>Stations — Shiftly</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Clocking stations</h1>
			<p class="hint">Screens your team scans. Every station shows the same code.</p>
		</div>
		<div class="flex gap-2">
			<a href="/station" class="btn btn-secondary">
				<Icon name="expand" size={18} />
				Open display
			</a>
			<button type="button" class="btn btn-primary" onclick={() => (showAdd = true)}>
				<Icon name="plus" size={18} />
				Create station
			</button>
		</div>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}

	{#if form?.created}
		<div class="mb-4">
			<Card title="Station created">
				<p class="hint !mt-0">
					Open this link <strong>on the device</strong> that will show the code. It creates a
					sign-in for that device and nothing else.
				</p>
				<div class="mt-3 flex flex-col gap-2 sm:flex-row">
					<input class="input font-mono text-xs" readonly value={form.setupUrl} />
					<button
						type="button"
						class="btn btn-primary shrink-0"
						onclick={() => copy(form.setupUrl, 'new')}
					>
						{copied === 'new' ? 'Copied' : 'Copy link'}
					</button>
				</div>
			</Card>
		</div>
	{/if}

	{#if !data.qrEnabled}
		<div class="mb-4">
			<Alert tone="warn" title="QR clocking is switched off">
				Stations will display a code, but scanning it will be refused until you enable QR
				clocking in <a href="/app/settings" class="underline">Settings</a>.
			</Alert>
		</div>
	{/if}

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
		<Card padded={false} title="Your stations">
			{#if data.stations.length === 0}
				<EmptyState
					title="No stations yet"
					description="A station is a phone or tablet left at the door showing the code."
				>
					<button type="button" class="btn btn-primary" onclick={() => (showAdd = true)}>
						Create your first station
					</button>
				</EmptyState>
			{:else}
				<ul class="divide-y" style="border-color: var(--border)">
					{#each data.stations as station (station.id)}
						<li class="px-4 py-3 sm:px-5">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="font-medium">{station.name}</p>
									{#if station.description}
										<p class="hint !mt-0">{station.description}</p>
									{/if}
									<div class="mt-1.5 flex flex-wrap gap-2">
										<span class="badge {station.isActive ? 'badge-ok' : 'badge-muted'}">
											{station.isActive ? 'Enabled' : 'Disabled'}
										</span>
										<span class="badge {station.claimed ? 'badge-info' : 'badge-warn'}">
											{station.claimed ? 'Device linked' : 'Awaiting setup'}
										</span>
									</div>
								</div>

								<div class="flex shrink-0 flex-wrap gap-1">
									<form
										method="POST"
										action="?/setActive"
										use:enhance={enhanceFor(station.id)}
									>
										<input type="hidden" name="stationId" value={station.id} />
										<input type="hidden" name="active" value={String(!station.isActive)} />
										<button
											type="submit"
											class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
											disabled={pending === station.id}
										>
											{station.isActive ? 'Disable' : 'Enable'}
										</button>
									</form>

									{#if station.claimed}
										<form
											method="POST"
											action="?/unlink"
											use:enhance={enhanceFor(station.id)}
										>
											<input type="hidden" name="stationId" value={station.id} />
											<button
												type="submit"
												class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
												style="color: var(--danger)"
												disabled={pending === station.id}
											>
												Unlink device
											</button>
										</form>
									{/if}
								</div>
							</div>

							{#if station.setupUrl}
								<div class="mt-3 flex flex-col gap-2 sm:flex-row">
									<input class="input font-mono text-xs" readonly value={station.setupUrl} />
									<button
										type="button"
										class="btn btn-secondary shrink-0"
										onclick={() => copy(station.setupUrl ?? '', station.id)}
									>
										{copied === station.id ? 'Copied' : 'Copy setup link'}
									</button>
								</div>
								<p class="hint">Open on the device that will display the code.</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<Card title="Today's code" subtitle="Identical on every station">
			<img
				src={data.preview.dataUrl}
				alt="The clocking code currently shown on every station"
				class="mx-auto h-auto w-full max-w-[12rem] rounded-xl border bg-white p-2"
				style="border-color: var(--border)"
			/>
			<p class="hint mt-3">
				Expires at midnight {data.timezone.replace(/_/g, ' ')}, then renews automatically.
			</p>
			<p class="hint">
				A code on a screen can be photographed, so treat scanning as convenient, not as proof
				somebody was present.
			</p>
		</Card>
	</div>
</div>

<Modal bind:open={showAdd} title="Create a station">
	<form
		method="POST"
		action="?/create"
		id="station-form"
		use:enhance={() => {
			pending = 'create';
			return async ({ update }) => {
				await update({ reset: false });
				pending = '';
				showAdd = false;
			};
		}}
	>
		<Field
			label="Station name"
			name="name"
			hint="Where the screen will live, e.g. Front entrance."
			error={form?.errors?.name}
			required
		>
			{#snippet children({ id, describedBy, invalid })}
				<input
					{id}
					name="name"
					class="input"
					required
					maxlength="80"
					aria-invalid={invalid}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<Field label="Description" name="description" hint="Optional." error={form?.errors?.description}>
			{#snippet children({ id, describedBy })}
				<input {id} name="description" class="input" maxlength="200" aria-describedby={describedBy} />
			{/snippet}
		</Field>

		<p class="hint !mt-0">
			You will get a setup link to open on the device itself.
		</p>
	</form>

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (showAdd = false)}>Cancel</button>
		<SubmitButton pending={pending === 'create'} form="station-form" pendingLabel="Creating...">
			Create station
		</SubmitButton>
	{/snippet}
</Modal>
