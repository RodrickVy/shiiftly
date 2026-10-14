<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import PhoneField from '$lib/components/ui/PhoneField.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);

	const next = $derived(encodeURIComponent(page.url.pathname));

	const problem = $derived(
		{
			invalid: 'This invitation link is not valid. Check that you copied all of it.',
			expired: 'This invitation has expired. Ask your manager for a new link.',
			revoked: 'This invitation has been revoked.',
			exhausted: 'This invitation has already been used.'
		}[data.preview.state as 'invalid' | 'expired' | 'revoked' | 'exhausted']
	);
</script>

<svelte:head><title>Join your team — Shiftly</title></svelte:head>

{#if data.preview.state !== 'valid'}
	<AuthShell title="This invitation cannot be used">
		<Alert tone="danger">{problem}</Alert>
		<a href="/" class="btn btn-secondary mt-5 w-full">Go to Shiftly</a>
	</AuthShell>
{:else if !data.signedIn}
	<AuthShell
		title="Join {data.preview.organizationName}"
		subtitle="You have been invited as {data.preview.role === 'manager' ? 'a manager' : 'an employee'}."
	>
		{#if data.preview.boundEmail}
			<div class="mb-4">
				<Alert tone="info">
					This invitation is for <strong>{data.preview.boundEmail}</strong>. Use that address
					when you sign up.
				</Alert>
			</div>
		{/if}

		<p class="hint !mt-0">Create an account or sign in, and you will be added automatically.</p>

		<div class="mt-5 flex flex-col gap-2">
			<a href="/signup?next={next}" class="btn btn-primary btn-lg w-full">Create my account</a>
			<a href="/login?next={next}" class="btn btn-secondary w-full">I already have an account</a>
		</div>
	</AuthShell>
{:else}
	<AuthShell
		title="Join {data.preview.organizationName}"
		subtitle="You have been invited as {data.preview.role === 'manager' ? 'a manager' : 'an employee'}."
	>
		{#if data.preview.boundEmail && data.currentEmail && data.preview.boundEmail.toLowerCase() !== data.currentEmail.toLowerCase()}
			<div class="mb-4">
				<Alert tone="warn" title="Signed in as a different address">
					This invitation was sent to <strong>{data.preview.boundEmail}</strong>, but you are
					signed in as <strong>{data.currentEmail}</strong>. Sign in with the invited address
					to accept it.
				</Alert>
			</div>
		{/if}

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
				label="Your full name"
				name="fullName"
				hint="This is how you appear on attendance lists."
				error={form?.errors?.fullName}
				required
			>
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

			<PhoneField
				required
				hint="Your manager uses this to reach you about shifts."
				error={form?.errors?.phoneNumber}
				dial={form?.values?.phoneDial ?? '+254'}
				value={form?.values?.phoneNumber ?? ''}
			/>

			<SubmitButton {pending} pendingLabel="Joining..." size="btn-lg" fullWidth>
				Join {data.preview.organizationName}
			</SubmitButton>
		</form>

		<p class="hint mt-4">
			Your role is set by the invitation and cannot be changed here.
		</p>
	</AuthShell>
{/if}
