<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	let pending = $state(false);
</script>

<svelte:head><title>Reset your password — Shiftly</title></svelte:head>

<AuthShell
	title="Reset your password"
	subtitle="We will email you a link to choose a new one."
>
	{#if form?.sent}
		<Alert tone="ok" title="Check your email">
			If an account exists for that address, a reset link is on its way.
		</Alert>
		<a href="/login" class="btn btn-secondary mt-5 w-full">Back to sign in</a>
	{:else}
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

			<Field label="Email" name="email" error={form?.errors?.email} required>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="email"
						type="email"
						class="input"
						autocomplete="email"
						inputmode="email"
						required
						aria-invalid={invalid}
						aria-describedby={describedBy}
						value={form?.values?.email ?? ''}
					/>
				{/snippet}
			</Field>

			<SubmitButton {pending} pendingLabel="Sending..." size="btn-lg" fullWidth>
				Send reset link
			</SubmitButton>
		</form>
	{/if}

	{#snippet footer()}
		<a href="/login" style="color: var(--color-brand-600)">Back to sign in</a>
	{/snippet}
</AuthShell>
