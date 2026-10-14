<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import PhoneField from '$lib/components/ui/PhoneField.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { splitE164 } from '$lib/domain/phone';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);

	const suggested = $derived(splitE164(data.suggestedPhone));
	const teamName = $derived(
		data.preview.state === 'invalid' ? '' : (data.preview.name ?? 'this team')
	);
</script>

<svelte:head><title>Join the team — Shiftly</title></svelte:head>

{#if form?.submitted || data.existingStatus === 'pending'}
	<AuthShell title="Request sent">
		<Alert tone="ok" title="Waiting for approval">
			Your request to join {teamName} has been sent. A manager will review it, and you will be
			able to clock in once you are accepted.
		</Alert>
		<p class="hint mt-4">
			You can close this page. Sign in any time to check whether you have been accepted.
		</p>
		<a href="/app" class="btn btn-secondary mt-4 w-full">Check my status</a>
	</AuthShell>
{:else if data.preview.state === 'invalid'}
	<AuthShell title="This link is not valid">
		<Alert tone="danger">
			Check that you copied the whole link, or ask your manager for a new one.
		</Alert>
		<a href="/" class="btn btn-secondary mt-5 w-full">Go to Shiftly</a>
	</AuthShell>
{:else if data.preview.state === 'closed'}
	<AuthShell title="{teamName} is not accepting new members">
		<Alert tone="warn">
			Joining has been switched off for this team. Speak to your manager.
		</Alert>
		<a href="/" class="btn btn-secondary mt-5 w-full">Go to Shiftly</a>
	</AuthShell>
{:else if data.existingStatus === 'rejected'}
	<AuthShell title="Request not accepted">
		<Alert tone="danger">
			An earlier request from this account was not accepted. Please speak to your manager.
		</Alert>
	</AuthShell>
{:else}
	<AuthShell
		title="Join {teamName}"
		subtitle={data.signedIn
			? 'Confirm your details to send your request.'
			: 'Create your account to ask to join.'}
	>
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
						value={form?.values?.fullName ?? data.suggestedName}
					/>
				{/snippet}
			</Field>

			{#if !data.signedIn}
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
			{/if}

			<PhoneField
				required
				hint="Your manager uses this to reach you about shifts."
				error={form?.errors?.phoneNumber}
				dial={form?.values?.phoneDial ?? suggested.dial}
				value={form?.values?.phoneNumber ?? suggested.national}
			/>

			{#if !data.signedIn}
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
			{/if}

			<SubmitButton {pending} pendingLabel="Sending..." size="btn-lg" fullWidth>
				{data.signedIn ? 'Ask to join' : 'Create account and ask to join'}
			</SubmitButton>
		</form>

		<p class="hint mt-4">
			A manager reviews every request. Your role is set when you are accepted.
		</p>

		{#snippet footer()}
			{#if !data.signedIn}
				Already have an account?
				<a
					href="/login?next={encodeURIComponent(page.url.pathname)}"
					style="color: var(--color-brand-600)"
				>
					Sign in
				</a>
			{/if}
		{/snippet}
	</AuthShell>
{/if}
