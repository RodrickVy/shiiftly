<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import PhoneField from '$lib/components/ui/PhoneField.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { form, data }: PageProps = $props();
	let pending = $state(false);

	const loginHref = $derived(data.next ? `/login?next=${encodeURIComponent(data.next)}` : '/login');
</script>

<svelte:head><title>Create your account — Shiftly</title></svelte:head>

{#if form?.checkEmail}
	<AuthShell title="Check your email" subtitle="One more step.">
		<Alert tone="ok" title="Confirmation sent">
			We sent a confirmation link to <strong>{form.email}</strong>. Open it to activate your
			account, then sign in.
		</Alert>
		<a href="/login" class="btn btn-secondary mt-5 w-full">Back to sign in</a>
	</AuthShell>
{:else}
	<AuthShell title="Create your account" subtitle="Set up your team in a few minutes.">
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

			<Field label="Full name" name="fullName" error={form?.errors?.fullName} required>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="fullName"
						type="text"
						class="input"
						autocomplete="name"
						required
						aria-invalid={invalid}
						aria-describedby={describedBy}
						value={form?.values?.fullName ?? ''}
					/>
				{/snippet}
			</Field>

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

			<PhoneField
				required
				hint="We use this to reach you about shifts. Local format is fine."
				error={form?.errors?.phoneNumber}
				dial={form?.values?.phoneDial ?? '+254'}
				value={form?.values?.phoneNumber ?? ''}
			/>

			<Field
				label="Password"
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

			<SubmitButton {pending} pendingLabel="Creating account..." size="btn-lg" fullWidth>
				Create account
			</SubmitButton>
		</form>

		{#snippet footer()}
			Already have an account?
			<a href={loginHref} style="color: var(--color-brand-600)">Sign in</a>
		{/snippet}
	</AuthShell>
{/if}
