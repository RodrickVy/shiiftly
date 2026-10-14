<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { WEEKDAYS, countryByCode } from '$lib/data/locales';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state(false);
	// Seeded once from a rejected submission; the user owns them afterwards.
	let countryCode = $state(untrack(() => form?.values?.countryCode) ?? 'KE');
	let timezone = $state(untrack(() => form?.values?.timezone) ?? '');
	let currencyCode = $state(untrack(() => form?.values?.currencyCode) ?? '');

	// Picking a country fills in sensible defaults, which stay editable.
	let lastCountry = $state('');
	$effect(() => {
		if (countryCode === lastCountry) return;
		lastCountry = countryCode;
		const country = countryByCode(countryCode);
		if (!country) return;
		timezone = country.timezone;
		currencyCode = country.currency;
	});
</script>

<svelte:head><title>Create your organization — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<header class="mb-6">
		<p class="badge badge-info mb-3">Step 1 of 2</p>
		<h1 class="text-2xl font-bold">Create your organization</h1>
		<p class="hint">
			This is your workspace. Your timezone decides which calendar day a shift belongs to, so it
			is worth getting right.
		</p>
	</header>

	<form
		method="POST"
		class="card px-5 py-5 sm:px-6"
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update();
				pending = false;
			};
		}}
	>
		{#if form?.errors?._form}
			<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
		{/if}

		<Field label="Organization name" name="name" error={form?.errors?.name} required>
			{#snippet children({ id, describedBy, invalid })}
				<input
					{id}
					name="name"
					type="text"
					class="input"
					required
					placeholder="e.g. Kibera Coffee House"
					aria-invalid={invalid}
					aria-describedby={describedBy}
					value={form?.values?.name ?? ''}
				/>
			{/snippet}
		</Field>

		<Field label="Industry" name="industry" error={form?.errors?.industry}>
			{#snippet children({ id, describedBy })}
				<select {id} name="industry" class="input" aria-describedby={describedBy}>
					<option value="">Choose an industry</option>
					{#each data.industries as industry (industry)}
						<option value={industry} selected={form?.values?.industry === industry}>
							{industry}
						</option>
					{/each}
				</select>
			{/snippet}
		</Field>

		<Field label="Country" name="countryCode" error={form?.errors?.countryCode} required>
			{#snippet children({ id, describedBy })}
				<select {id} name="countryCode" class="input" bind:value={countryCode} aria-describedby={describedBy}>
					{#each data.countries as country (country.code)}
						<option value={country.code}>{country.name}</option>
					{/each}
				</select>
			{/snippet}
		</Field>

		<div class="grid gap-x-4 sm:grid-cols-2">
			<Field
				label="Timezone"
				name="timezone"
				hint="Used for daily QR codes and attendance dates."
				error={form?.errors?.timezone}
				required
			>
				{#snippet children({ id, describedBy })}
					<select {id} name="timezone" class="input" bind:value={timezone} aria-describedby={describedBy}>
						{#each data.timezones as tz (tz)}
							<option value={tz}>{tz.replace(/_/g, ' ')}</option>
						{/each}
					</select>
				{/snippet}
			</Field>

			<Field label="Currency" name="currencyCode" error={form?.errors?.currencyCode} required>
				{#snippet children({ id, describedBy })}
					<select {id} name="currencyCode" class="input" bind:value={currencyCode} aria-describedby={describedBy}>
						{#each data.currencies as currency (currency)}
							<option value={currency}>{currency}</option>
						{/each}
					</select>
				{/snippet}
			</Field>
		</div>

		<Field label="Week starts on" name="weekStartsOn" error={form?.errors?.weekStartsOn}>
			{#snippet children({ id, describedBy })}
				<select {id} name="weekStartsOn" class="input" aria-describedby={describedBy}>
					{#each WEEKDAYS as day (day.value)}
						<option value={day.value} selected={day.value === 1}>{day.label}</option>
					{/each}
				</select>
			{/snippet}
		</Field>

		<div class="mt-2 flex justify-end">
			<SubmitButton {pending} pendingLabel="Creating..." size="btn-lg">
				Create organization
			</SubmitButton>
		</div>
	</form>

	<p class="hint mt-4 text-center">
		Joining a team instead? Ask your manager for an invitation link.
	</p>
</div>
