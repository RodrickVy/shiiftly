<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { formatPhone } from '$lib/domain/phone';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state('');
	let copied = $state(false);
	let showLink = $state(false);
	// Role chosen per request, defaulting to employee.
	let roleFor = $state<Record<string, 'employee' | 'manager'>>({});

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(data.joinLink);
			copied = true;
			setTimeout(() => (copied = false), 2500);
		} catch {
			copied = false;
		}
	}

	const enhanceFor = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = '';
		};
	};

	const roleTone: Record<string, string> = {
		owner: 'badge-info',
		manager: 'badge-info',
		employee: 'badge-muted'
	};

	function when(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>Employees — Shiftly</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Employees</h1>
			<p class="hint">
				{data.team.filter((e) => e.status === 'active').length} active
				{#if data.requests.length > 0}
					&middot; {data.requests.length} waiting
				{/if}
			</p>
		</div>
		<button type="button" class="btn btn-primary" onclick={() => (showLink = true)}>
			<Icon name="invite" size={18} />
			Join link
		</button>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.reviewed}
		<div class="mb-4">
			<Alert tone="ok">
				{form.reviewed === 'accept' ? 'Accepted. They can clock in now.' : 'Request rejected.'}
			</Alert>
		</div>
	{/if}
	{#if form?.rotated}
		<div class="mb-4">
			<Alert tone="ok">New join link created. The previous one no longer works.</Alert>
		</div>
	{/if}

	<div class="mb-4 flex flex-wrap gap-2">
		<a href="/app/employees?tab=team" class="btn {data.tab === 'team' ? 'btn-primary' : 'btn-secondary'}">
			Team ({data.team.length})
		</a>
		<a
			href="/app/employees?tab=requests"
			class="btn {data.tab === 'requests' ? 'btn-primary' : 'btn-secondary'}"
		>
			Requests ({data.requests.length})
		</a>
	</div>

	{#if data.tab === 'requests'}
		<Card padded={false}>
			{#if data.requests.length === 0}
				<EmptyState
					title="No one is waiting"
					description="Share your join link and requests will appear here for you to accept."
				>
					<button type="button" class="btn btn-primary" onclick={() => (showLink = true)}>
						Show join link
					</button>
				</EmptyState>
			{:else}
				<ul class="divide-y" style="border-color: var(--border)">
					{#each data.requests as person (person.id)}
						<li class="px-4 py-4 sm:px-5">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="font-medium">{person.name}</p>
									<p class="hint !mt-0">{person.email}</p>
									{#if person.phone}
										<p class="hint !mt-0">{formatPhone(person.phone)}</p>
									{/if}
									<p class="hint">Asked to join {when(person.requestedAt)}</p>
								</div>

								<div class="flex shrink-0 flex-wrap items-center gap-2">
									<form
										method="POST"
										action="?/review"
										class="flex items-center gap-2"
										use:enhance={enhanceFor(person.id)}
									>
										<input type="hidden" name="membershipId" value={person.id} />
										<input type="hidden" name="decision" value="accept" />

										<label class="sr-only" for="role-{person.id}">Role</label>
										<select
											id="role-{person.id}"
											name="role"
											class="input !w-auto !py-1.5 text-sm"
											bind:value={
												() => roleFor[person.id] ?? 'employee',
												(v) => (roleFor[person.id] = v)
											}
										>
											<option value="employee">as Employee</option>
											{#if data.isOwner}
												<option value="manager">as Manager</option>
											{/if}
										</select>

										<button
											type="submit"
											class="btn btn-primary !min-h-0 !px-3 !py-1.5 text-sm"
											disabled={pending === person.id}
										>
											Accept
										</button>
									</form>

									<form method="POST" action="?/review" use:enhance={enhanceFor(person.id)}>
										<input type="hidden" name="membershipId" value={person.id} />
										<input type="hidden" name="decision" value="reject" />
										<button
											type="submit"
											class="btn btn-ghost !min-h-0 !px-3 !py-1.5 text-sm"
											style="color: var(--danger)"
											disabled={pending === person.id}
										>
											Reject
										</button>
									</form>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	{:else}
		<form method="GET" class="mb-4 flex flex-wrap items-end gap-2">
			<input type="hidden" name="tab" value="team" />
			<div class="min-w-48 flex-1">
				<label class="label" for="q">Search</label>
				<input
					id="q"
					name="q"
					type="search"
					class="input"
					placeholder="Name, email, job title"
					value={data.search}
				/>
			</div>
			<button type="submit" class="btn btn-secondary">Search</button>
		</form>

		<Card padded={false}>
			{#if data.team.length === 0}
				<EmptyState
					title="No one on the team yet"
					description="Share your join link; people who sign up will appear under Requests."
				>
					<button type="button" class="btn btn-primary" onclick={() => (showLink = true)}>
						Show join link
					</button>
				</EmptyState>
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Contact</th>
							<th scope="col">Role</th>
							<th scope="col">Status</th>
							<th scope="col">Now</th>
							<th scope="col">Joined</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.team as person (person.id)}
							<tr>
								<td data-label="Name">
									<a
										href="/app/employees/{person.id}"
										class="font-medium no-underline"
										style="color: var(--text)">{person.name}</a
									>
									{#if person.jobTitle}
										<span class="hint !mt-0 block">{person.jobTitle}</span>
									{/if}
								</td>
								<td data-label="Contact">
									<span class="block text-sm">{person.email}</span>
									{#if person.phone}
										<span class="hint !mt-0 block">{formatPhone(person.phone)}</span>
									{/if}
								</td>
								<td data-label="Role">
									{#if data.isOwner && person.role !== 'owner'}
										<form
											method="POST"
											action="?/setRole"
											use:enhance={enhanceFor(person.id)}
										>
											<input type="hidden" name="membershipId" value={person.id} />
											<select
												name="role"
												class="input !w-auto !py-1 text-sm"
												value={person.role}
												onchange={(e) => e.currentTarget.form?.requestSubmit()}
												aria-label="Role for {person.name}"
											>
												<option value="employee">Employee</option>
												<option value="manager">Manager</option>
												<option value="owner">Owner</option>
											</select>
										</form>
									{:else}
										<span class="badge {roleTone[person.role]} capitalize">{person.role}</span>
									{/if}
								</td>
								<td data-label="Status">
									<span class="badge {person.status === 'active' ? 'badge-ok' : 'badge-muted'}">
										{person.status}
									</span>
								</td>
								<td data-label="Now"><StatusBadge state={person.attendance} /></td>
								<td data-label="Joined">{when(person.joinedAt)}</td>
								<td data-label="">
									<div class="flex flex-wrap justify-end gap-1">
										<a
											href="/app/employees/{person.id}"
											class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
										>
											View
										</a>
										<form
											method="POST"
											action="?/setStatus"
											use:enhance={enhanceFor(person.id)}
										>
											<input type="hidden" name="membershipId" value={person.id} />
											<input
												type="hidden"
												name="status"
												value={person.status === 'active' ? 'inactive' : 'active'}
											/>
											<button
												type="submit"
												class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
												style={person.status === 'active' ? 'color: var(--danger)' : ''}
												disabled={pending === person.id}
											>
												{person.status === 'active' ? 'Deactivate' : 'Reactivate'}
											</button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Card>

		<p class="hint mt-3">
			Deactivating someone stops them clocking in but keeps every attendance record.
		</p>
	{/if}
</div>

<Modal bind:open={showLink} title="Join link">
	<p class="hint !mt-0">
		Anyone with this link can ask to join. They create their own account, then wait for you to
		accept them &mdash; nobody gets in automatically.
	</p>

	<div class="mt-3 flex flex-col gap-2 sm:flex-row">
		<input class="input font-mono text-xs" readonly value={data.joinLink} />
		<button type="button" class="btn btn-primary shrink-0" onclick={copyLink}>
			{copied ? 'Copied' : 'Copy'}
		</button>
	</div>

	{#if !data.joinEnabled}
		<div class="mt-3">
			<Alert tone="warn">Joining is switched off, so this link will be refused.</Alert>
		</div>
	{/if}

	<div class="mt-4 flex flex-wrap gap-2">
		<form method="POST" action="?/setJoinEnabled" use:enhance={enhanceFor('toggle')}>
			<input type="hidden" name="enabled" value={String(!data.joinEnabled)} />
			<button type="submit" class="btn btn-secondary" disabled={pending === 'toggle'}>
				{data.joinEnabled ? 'Stop accepting requests' : 'Start accepting requests'}
			</button>
		</form>

		<form method="POST" action="?/rotateLink" use:enhance={enhanceFor('rotate')}>
			<button type="submit" class="btn btn-ghost" disabled={pending === 'rotate'}>
				Replace link
			</button>
		</form>
	</div>

	<p class="hint">
		Replacing the link stops the old one working &mdash; use it if the link has spread too far.
	</p>
</Modal>
