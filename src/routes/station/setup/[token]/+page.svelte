<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);

	const problem = $derived(
		{
			invalid: 'This setup link is not valid. Ask for a new one from the Station page.',
			claimed: 'This station is already set up on another device.',
			disabled: 'This station has been disabled.',
			open: ''
		}[data.preview.state]
	);
</script>

<svelte:head><title>Set up this device — Shiftly</title></svelte:head>

{#if data.preview.state !== 'open'}
	<AuthShell title="Cannot set up this device">
		<Alert tone="danger">{problem}</Alert>
		<a href="/" class="btn btn-secondary mt-5 w-full">Go to Shiftly</a>
	</AuthShell>
{:else}
	<AuthShell
		title="Set up {data.preview.name}"
		subtitle="This device will show the clocking code for {data.preview.organizationName}."
	>
		<div class="mb-4">
			<Alert tone="info" title="This device will be limited">
				It can display the clocking code and nothing else &mdash; no employee records, no
				attendance, no settings. Staff still clock in from their own phones.
			</Alert>
		</div>

		<form
			method="POST"
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

			<Field
				label="Device name"
				name="displayName"
				hint="How this screen appears in your station list."
				error={form?.errors?.displayName}
				required
			>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="displayName"
						class="input"
						required
						maxlength="80"
						aria-invalid={invalid}
						aria-describedby={describedBy}
						value={form?.values?.displayName ?? data.preview.name}
					/>
				{/snippet}
			</Field>

			<Field
				label="Description"
				name="description"
				hint="Optional. Where this screen lives, e.g. by the main entrance."
				error={form?.errors?.description}
			>
				{#snippet children({ id, describedBy })}
					<input
						{id}
						name="description"
						class="input"
						maxlength="200"
						aria-describedby={describedBy}
						value={form?.values?.description ?? data.preview.description ?? ''}
					/>
				{/snippet}
			</Field>

			<Field
				label="Sign-in email for this device"
				name="email"
				hint="Not a personal address. Something like frontdoor@yourbusiness.com."
				error={form?.errors?.email}
				required
			>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="email"
						type="email"
						class="input"
						inputmode="email"
						autocomplete="off"
						required
						aria-invalid={invalid}
						aria-describedby={describedBy}
						value={form?.values?.email ?? ''}
					/>
				{/snippet}
			</Field>

			<Field
				label="Password"
				name="password"
				hint="At least 10 characters. Keep it where your managers can find it."
				error={form?.errors?.password}
				required
			>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="password"
						type="password"
						class="input"
						autocomplete="new-password"
						minlength="10"
						required
						aria-invalid={invalid}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<Field
				label="Confirm password"
				name="confirmPassword"
				error={form?.errors?.confirmPassword}
				required
			>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="confirmPassword"
						type="password"
						class="input"
						autocomplete="new-password"
						required
						aria-invalid={invalid}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<SubmitButton {pending} pendingLabel="Setting up..." size="btn-lg" fullWidth>
				Set up this device
			</SubmitButton>
		</form>
	</AuthShell>
{/if}
