<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state(false);
	// Seeded from the saved policy; the radio group owns it from then on.
	let breakMode = $state<'none' | 'automatic' | 'manual'>(
		untrack(() => data.settings.break_mode)
	);

	const modes = [
		{
			value: 'none' as const,
			title: 'No break tracking',
			body: 'Payable time is the whole shift. You can turn breaks on later.'
		},
		{
			value: 'automatic' as const,
			title: 'Automatic deduction',
			body: 'Subtract a fixed unpaid break from shifts that reach a set length. Staff do nothing.'
		},
		{
			value: 'manual' as const,
			title: 'Staff record breaks',
			body: 'Staff tap Start break and End break. Time is measured from the server clock.'
		}
	];
</script>

<svelte:head><title>Set up {data.organizationName} — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<header class="mb-6">
		<p class="badge badge-info mb-3">Step 2 of 2</p>
		<h1 class="text-2xl font-bold">How should breaks work?</h1>
		<p class="hint">You can change any of this later in Settings.</p>
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

		<fieldset class="mb-5">
			<legend class="label">Break policy</legend>
			<div class="grid gap-2">
				{#each modes as mode (mode.value)}
					<label
						class="flex cursor-pointer gap-3 rounded-xl border px-4 py-3 transition-colors"
						style="border-color: {breakMode === mode.value
							? 'var(--color-brand-500)'
							: 'var(--border)'}; background: {breakMode === mode.value
							? 'var(--info-surface)'
							: 'transparent'}"
					>
						<input
							type="radio"
							name="breakMode"
							value={mode.value}
							bind:group={breakMode}
							class="mt-1 h-4 w-4 shrink-0"
						/>
						<span class="min-w-0">
							<span class="block font-medium">{mode.title}</span>
							<span class="hint !mt-0.5 block">{mode.body}</span>
						</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if breakMode === 'automatic'}
			<div class="grid gap-x-4 sm:grid-cols-2">
				<Field
					label="Unpaid break"
					name="automaticBreakMinutes"
					hint="Minutes to deduct."
					error={form?.errors?.automaticBreakMinutes}
				>
					{#snippet children({ id, describedBy })}
						<input
							{id}
							name="automaticBreakMinutes"
							type="number"
							min="0"
							max="480"
							class="input"
							aria-describedby={describedBy}
							value={data.settings.automatic_break_minutes}
						/>
					{/snippet}
				</Field>

				<Field
					label="Only for shifts of at least"
					name="automaticBreakThresholdMinutes"
					hint="Minutes worked before the deduction applies."
					error={form?.errors?.automaticBreakThresholdMinutes}
				>
					{#snippet children({ id, describedBy })}
						<input
							{id}
							name="automaticBreakThresholdMinutes"
							type="number"
							min="0"
							max="1440"
							class="input"
							aria-describedby={describedBy}
							value={data.settings.automatic_break_threshold_minutes}
						/>
					{/snippet}
				</Field>
			</div>
		{:else}
			<!-- Keep the defaults submitted so switching modes later is sane. -->
			<input type="hidden" name="automaticBreakMinutes" value={data.settings.automatic_break_minutes} />
			<input
				type="hidden"
				name="automaticBreakThresholdMinutes"
				value={data.settings.automatic_break_threshold_minutes}
			/>
		{/if}

		<hr class="my-5" style="border-color: var(--border)" />

		<Field
			label="Name your first clocking station"
			name="stationName"
			hint="The screen staff scan. Often the entrance or the counter."
			error={form?.errors?.stationName}
		>
			{#snippet children({ id, describedBy })}
				<input
					{id}
					name="stationName"
					type="text"
					class="input"
					placeholder="Main entrance"
					value="Main entrance"
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<div class="mt-2 flex justify-end">
			<SubmitButton {pending} pendingLabel="Saving..." size="btn-lg">
				Finish setup
			</SubmitButton>
		</div>
	</form>
</div>
