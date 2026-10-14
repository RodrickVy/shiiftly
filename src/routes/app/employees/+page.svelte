<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state('');

	const roleTone: Record<string, string> = {
		owner: 'badge-info',
		manager: 'badge-info',
		employee: 'badge-muted'
	};

	function joined(iso: string): string {
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
			<p class="hint">{data.employees.length} shown</p>
		</div>
		<a href="/app/invitations" class="btn btn-primary">
			<Icon name="invite" size={18} />
			Invite employee
		</a>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}

	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2">
		<div class="min-w-48 flex-1">
			<label class="label" for="q">Search</label>
			<input
				id="q"
				name="q"
				type="search"
				class="input"
				placeholder="Name, email, job title"
				value={data.filters.q}
			/>
		</div>
		<div>
			<label class="label" for="status">Status</label>
			<select id="status" name="status" class="input">
				<option value="active" selected={data.filters.status === 'active'}>Active</option>
				<option value="inactive" selected={data.filters.status === 'inactive'}>Inactive</option>
				<option value="all" selected={data.filters.status === 'all'}>All</option>
			</select>
		</div>
		<div>
			<label class="label" for="role">Role</label>
			<select id="role" name="role" class="input">
				<option value="all" selected={data.filters.role === 'all'}>All roles</option>
				<option value="owner" selected={data.filters.role === 'owner'}>Owner</option>
				<option value="manager" selected={data.filters.role === 'manager'}>Manager</option>
				<option value="employee" selected={data.filters.role === 'employee'}>Employee</option>
			</select>
		</div>
		<button type="submit" class="btn btn-secondary">Apply</button>
	</form>

	<Card padded={false}>
		{#if data.employees.length === 0}
			<EmptyState
				title="No employees match"
				description="Try clearing the filters, or invite someone to join."
			>
				<a href="/app/invitations" class="btn btn-primary">Invite employee</a>
			</EmptyState>
		{:else}
			<table class="data-table">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Contact</th>
						<th scope="col">Role</th>
						<th scope="col">Employment</th>
						<th scope="col">Now</th>
						<th scope="col">Joined</th>
						<th scope="col"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each data.employees as employee (employee.id)}
						<tr>
							<td data-label="Name">
								<a
									href="/app/employees/{employee.id}"
									class="font-medium no-underline"
									style="color: var(--text)">{employee.name}</a
								>
								{#if employee.jobTitle}
									<span class="hint !mt-0 block">{employee.jobTitle}</span>
								{/if}
							</td>
							<td data-label="Contact">
								<span class="block text-sm">{employee.email}</span>
								{#if employee.phone}<span class="hint !mt-0 block">{employee.phone}</span>{/if}
							</td>
							<td data-label="Role">
								<span class="badge {roleTone[employee.role]} capitalize">{employee.role}</span>
							</td>
							<td data-label="Employment">
								<span class="badge {employee.status === 'active' ? 'badge-ok' : 'badge-muted'}">
									{employee.status}
								</span>
							</td>
							<td data-label="Now"><StatusBadge state={employee.attendance} /></td>
							<td data-label="Joined">{joined(employee.joinedAt)}</td>
							<td data-label="">
								<div class="flex flex-wrap justify-end gap-1">
									<a
										href="/app/employees/{employee.id}"
										class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
									>
										View
									</a>
									{#if employee.status === 'active'}
										<form
											method="POST"
											action="?/setStatus"
											use:enhance={() => {
												pending = employee.id;
												return async ({ update }) => {
													await update();
													pending = '';
												};
											}}
										>
											<input type="hidden" name="membershipId" value={employee.id} />
											<input type="hidden" name="status" value="inactive" />
											<button
												type="submit"
												class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
												style="color: var(--danger)"
												disabled={pending === employee.id}
											>
												Deactivate
											</button>
										</form>
									{:else}
										<form
											method="POST"
											action="?/setStatus"
											use:enhance={() => {
												pending = employee.id;
												return async ({ update }) => {
													await update();
													pending = '';
												};
											}}
										>
											<input type="hidden" name="membershipId" value={employee.id} />
											<input type="hidden" name="status" value="active" />
											<button
												type="submit"
												class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
												disabled={pending === employee.id}
											>
												Reactivate
											</button>
										</form>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</Card>

	<p class="hint mt-3">
		Deactivating someone stops them clocking in but keeps every attendance and pay record.
	</p>
</div>
