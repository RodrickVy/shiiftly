<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { form, data }: PageProps = $props();
	let pending = $state(false);

	const signupHref = $derived(
		data.next ? `/signup?next=${encodeURIComponent(data.next)}` : '/signup'
	);
</script>

<svelte:head><title>Sign in — Shiftly</title></svelte:head>

<AuthShell title="Sign in" subtitle="Welcome back.">
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
					autocomplete="username"
					inputmode="email"
					required
					aria-invalid={invalid}
					aria-describedby={describedBy}
					value={form?.values?.email ?? ''}
				/>
			{/snippet}
		</Field>

		<Field label="Password" name="password" error={form?.errors?.password} required>
			{#snippet children({ id, describedBy, invalid })}
				<input
					{id}
					name="password"
					type="password"
					class="input"
					autocomplete="current-password"
					required
					aria-invalid={invalid}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<div class="mb-4 text-right">
			<a href="/forgot-password" class="text-sm" style="color: var(--color-brand-600)">
				Forgot your password?
			</a>
		</div>

		<SubmitButton {pending} pendingLabel="Signing in..." size="btn-lg" fullWidth>
			Sign in
		</SubmitButton>
	</form>

	{#snippet footer()}
		New here? <a href={signupHref} style="color: var(--color-brand-600)">Create an account</a>
	{/snippet}
</AuthShell>
