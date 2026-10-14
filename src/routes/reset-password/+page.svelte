<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { form, data }: PageProps = $props();
	let pending = $state(false);
</script>

<svelte:head><title>Choose a new password — Shiftly</title></svelte:head>

<AuthShell title="Choose a new password">
	{#if !data.hasSession}
		<Alert tone="danger" title="This link is no longer valid">
			Reset links expire after a short time and can only be used once.
		</Alert>
		<a href="/forgot-password" class="btn btn-primary mt-5 w-full">Request a new link</a>
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

			<Field
				label="New password"
				name="password"
				hint="At least 10 characters."
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
				label="Confirm new password"
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

			<SubmitButton {pending} pendingLabel="Saving..." size="btn-lg" fullWidth>
				Save new password
			</SubmitButton>
		</form>
	{/if}
</AuthShell>
