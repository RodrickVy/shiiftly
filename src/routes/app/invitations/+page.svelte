<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let showCreate = $state(false);
	let pending = $state(false);
	let copied = $state(false);
	let role = $state<'employee' | 'manager'>('employee');
	let email = $state('');

	async function copyLink(link: string) {
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	}

	const badgeTone: Record<string, string> = {
		active: 'badge-ok',
		expired: 'badge-muted',
		revoked: 'badge-danger',
		used: 'badge-info'
	};

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>Invitations — Shiftly</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Invitations</h1>
			<p class="hint">Share a link so your team can join without you creating accounts.</p>
		</div>
		<button type="button" class="btn btn-primary" onclick={() => (showCreate = true)}>
			<Icon name="plus" size={18} />
			New invitation
		</button>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}

	{#if form?.created}
		<div class="mb-4">
			<Card title="Invitation link ready">
				<p class="hint !mt-0">
					Copy this now — for security it is not shown again. Creating another invitation is
					free.
				</p>
				<div class="mt-3 flex flex-col gap-2 sm:flex-row">
					<input class="input font-mono text-xs" readonly value={form.link} />
					<button type="button" class="btn btn-secondary shrink-0" onclick={() => copyLink(form.link)}>
						{copied ? 'Copied' : 'Copy link'}
					</button>
					<a href="/app/invitations/{form.invitationId}" class="btn btn-primary shrink-0">
						<Icon name="scan" size={18} />
						Show QR code
					</a>
				</div>

				{#if form.emailed === 'sent'}
					<p class="mt-3"><span class="badge badge-ok">Emailed to the invitee</span></p>
				{:else if form.emailed === 'failed'}
					<div class="mt-3">
						<Alert tone="warn" title="The email was not sent">
							The invitation itself is valid — share the link above directly.
							{#if !data.emailConfigured}
								No email provider is configured on this deployment.
							{/if}
						</Alert>
					</div>
				{/if}
			</Card>
		</div>
	{/if}

	{#if form?.revoked}
		<div class="mb-4"><Alert tone="ok">That invitation can no longer be used.</Alert></div>
	{/if}

	{#if !data.emailConfigured}
		<div class="mb-4">
			<Alert tone="info" title="Email delivery is not configured">
				Invitation links still work — copy and share them yourself. Set RESEND_API_KEY to send
				them by email.
			</Alert>
		</div>
	{/if}

	<Card padded={false}>
		{#if data.invitations.length === 0}
			<EmptyState
				title="No invitations yet"
				description="Create a link and send it to your team however you normally reach them."
			>
				<button type="button" class="btn btn-primary" onclick={() => (showCreate = true)}>
					Create an invitation
				</button>
			</EmptyState>
		{:else}
			<table class="data-table">
				<thead>
					<tr>
						<th scope="col">For</th>
						<th scope="col">Role</th>
						<th scope="col">Uses</th>
						<th scope="col">Expires</th>
						<th scope="col">Status</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.invitations as invitation (invitation.id)}
						<tr>
							<td data-label="For">
								{invitation.invitedEmail ?? 'Anyone with the link'}
							</td>
							<td data-label="Role"><span class="capitalize">{invitation.role}</span></td>
							<td data-label="Uses">{invitation.useCount} / {invitation.maxUses}</td>
							<td data-label="Expires">{formatDate(invitation.expiresAt)}</td>
							<td data-label="Status">
								<span class="badge {badgeTone[invitation.status]}">{invitation.status}</span>
							</td>
							<td data-label="">
								{#if invitation.status === 'active'}
								<div class="flex flex-wrap justify-end gap-1">
									<a
										href="/app/invitations/{invitation.id}"
										class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
									>
										QR code
									</a>
									<form
										method="POST"
										action="?/revoke"
										use:enhance={() => {
											pending = true;
											return async ({ update }) => {
												await update();
												pending = false;
											};
										}}
									>
										<input type="hidden" name="invitationId" value={invitation.id} />
										<button
											type="submit"
											class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
											style="color: var(--danger)"
											disabled={pending}
										>
											Revoke
										</button>
									</form>
								</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</Card>
</div>

<Modal bind:open={showCreate} title="New invitation">
	<form
		method="POST"
		action="?/create"
		id="invite-form"
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update({ reset: false });
				pending = false;
				showCreate = false;
			};
		}}
	>
		<Field label="Role" name="role" error={form?.errors?.role} required>
			{#snippet children({ id, describedBy })}
				<select {id} name="role" class="input" bind:value={role} aria-describedby={describedBy}>
					<option value="employee">Employee</option>
					{#if data.canInviteManagers}
						<option value="manager">Manager</option>
					{/if}
				</select>
			{/snippet}
		</Field>

		{#if role === 'manager'}
			<div class="mb-4">
				<Alert tone="warn">
					Managers can see everyone's attendance and approve requests.
				</Alert>
			</div>
		{/if}

		<Field
			label="Email address"
			name="email"
			hint="Leave blank for a link anyone on your team can use."
			error={form?.errors?.email}
		>
			{#snippet children({ id, describedBy, invalid })}
				<input
					{id}
					name="email"
					type="email"
					class="input"
					bind:value={email}
					inputmode="email"
					aria-invalid={invalid}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<div class="grid gap-x-4 sm:grid-cols-2">
			<Field
				label="Maximum uses"
				name="maxUses"
				hint={email ? 'Locked to 1 for a personal invitation.' : 'How many people may join.'}
				error={form?.errors?.maxUses}
			>
				{#snippet children({ id, describedBy })}
					<input
						{id}
						name="maxUses"
						type="number"
						min="1"
						max="500"
						class="input"
						value={email ? 1 : 25}
						readonly={Boolean(email)}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<Field label="Expires in (days)" name="expiresInDays" error={form?.errors?.expiresInDays}>
				{#snippet children({ id, describedBy })}
					<input
						{id}
						name="expiresInDays"
						type="number"
						min="1"
						max="90"
						class="input"
						value="7"
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
		</div>
	</form>

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (showCreate = false)}>
			Cancel
		</button>
		<SubmitButton {pending} form="invite-form" pendingLabel="Creating...">
			Create invitation
		</SubmitButton>
	{/snippet}
</Modal>
