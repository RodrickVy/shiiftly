<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);
</script>

<svelte:head><title>Profile — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">Profile</h1>
		<p class="hint">Your details and your place in {data.organization.name}.</p>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.saved}
		<div class="mb-4"><Alert tone="ok">Your profile has been saved.</Alert></div>
	{/if}

	<Card title="Your details">
		<form
			method="POST"
			action="?/updateProfile"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update();
					pending = false;
				};
			}}
		>
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
						value={form?.values?.fullName ?? data.profile.fullName}
					/>
				{/snippet}
			</Field>

			<Field
				label="Phone number"
				name="phone"
				hint="International format, e.g. +254712345678."
				error={form?.errors?.phone}
			>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="phone"
						type="tel"
						class="input"
						autocomplete="tel"
						inputmode="tel"
						placeholder="+254712345678"
						aria-invalid={invalid}
						aria-describedby={describedBy}
						value={form?.values?.phone ?? data.profile.phone}
					/>
				{/snippet}
			</Field>

			<Field label="Email" name="email" hint="Contact your manager to change this.">
				{#snippet children({ id })}
					<input {id} type="email" class="input" value={data.profile.email} readonly disabled />
				{/snippet}
			</Field>

			<SubmitButton {pending} pendingLabel="Saving...">Save changes</SubmitButton>
		</form>
	</Card>

	<div class="mt-4">
		<Card title="Employment" subtitle="Set by your organization">
			<dl class="grid grid-cols-2 gap-3 text-sm">
				<div>
					<dt class="hint !mt-0">Role</dt>
					<dd class="font-medium capitalize">{data.employment.role}</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Job title</dt>
					<dd class="font-medium">{data.employment.jobTitle ?? '—'}</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Department</dt>
					<dd class="font-medium">{data.employment.department ?? '—'}</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Employee ID</dt>
					<dd class="font-medium">{data.employment.employeeCode ?? '—'}</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Start date</dt>
					<dd class="font-medium">{data.employment.startDate ?? '—'}</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Joined Shiftly</dt>
					<dd class="font-medium">{data.employment.joinedAt.slice(0, 10)}</dd>
				</div>
			</dl>
		</Card>
	</div>

	{#if data.memberships.length > 1}
		<div class="mt-4">
			<Card title="Switch organization">
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.memberships as membership (membership.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{membership.organizationName}</p>
								<p class="hint !mt-0 capitalize">{membership.role}</p>
							</div>
							{#if membership.organizationId === data.org?.id}
								<span class="badge badge-ok">Current</span>
							{:else}
								<form method="POST" action="?/switchOrganization">
									<input
										type="hidden"
										name="organizationId"
										value={membership.organizationId}
									/>
									<button type="submit" class="btn btn-secondary !min-h-0 !px-3 !py-1.5 text-sm">
										Switch
									</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}

	<div class="mt-4">
		<Card title="Account">
			<p class="hint !mt-0">
				Signed in as {data.profile.email}.
			</p>
			<div class="mt-3 flex flex-wrap gap-2">
				<a href="/forgot-password" class="btn btn-secondary">Change password</a>
				<form method="POST" action="/auth/signout">
					<button type="submit" class="btn btn-ghost">Sign out</button>
				</form>
			</div>
		</Card>
	</div>
</div>
