<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state('');
	let deciding = $state<
		null | { row: (typeof data.rows)[number]; decision: 'approved' | 'rejected' }
	>(null);

	const statusTone: Record<string, string> = {
		draft: 'badge-muted',
		pending: 'badge-warn',
		approved: 'badge-ok',
		rejected: 'badge-danger'
	};
</script>

<svelte:head><title>Timesheets — Shiftly</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">Timesheet review</h1>
		<p class="hint">
			Totals are recalculated from the recorded shifts each time this page loads.
		</p>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.reviewed}
		<div class="mb-4"><Alert tone="ok">Timesheet {form.reviewed}.</Alert></div>
	{/if}
	{#if form?.reopened}
		<div class="mb-4"><Alert tone="ok">Timesheet reopened for editing.</Alert></div>
	{/if}

	<div class="mb-4 flex flex-wrap items-end gap-2">
		{#each data.weekOptions as option (option.start)}
			<a
				href="/app/timesheets?from={option.start}&to={option.end}"
				class="btn {data.periodStart === option.start ? 'btn-primary' : 'btn-secondary'}"
			>
				{option.label}
			</a>
		{/each}

		<form method="GET" class="flex flex-wrap items-end gap-2">
			<div>
				<label class="label" for="from">From</label>
				<input id="from" name="from" type="date" class="input" value={data.periodStart} />
			</div>
			<div>
				<label class="label" for="to">To</label>
				<input id="to" name="to" type="date" class="input" value={data.periodEnd} />
			</div>
			<button type="submit" class="btn btn-secondary">Apply</button>
		</form>
	</div>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<StatCard label="People" value={data.rows.length} />
		<StatCard label="Payable total" value={formatDuration(data.totals.payableMinutes)} tone="ok" />
		<StatCard
			label="Awaiting approval"
			value={data.totals.pending}
			tone={data.totals.pending > 0 ? 'warn' : 'default'}
		/>
	</div>

	{#if !data.approvalRequired}
		<div class="mt-4">
			<Alert tone="info">
				Timesheet approval is switched off, so hours flow straight through to earnings. You can
				still approve a period here to lock it.
			</Alert>
		</div>
	{/if}

	<div class="mt-4">
		<Card padded={false}>
			{#if data.rows.length === 0}
				<EmptyState
					title="No completed shifts in this period"
					description="Pick a different week, or wait for shifts to be recorded."
				/>
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Employee</th>
							<th scope="col">Shifts</th>
							<th scope="col">Gross</th>
							<th scope="col">Breaks</th>
							<th scope="col">Payable</th>
							<th scope="col">Status</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as row (row.membershipId)}
							<tr>
								<td data-label="Employee">
									<a
										href="/app/employees/{row.membershipId}"
										class="font-medium no-underline"
										style="color: var(--text)">{row.name}</a
									>
								</td>
								<td data-label="Shifts">{row.shifts}</td>
								<td data-label="Gross" class="tnum">{formatDuration(row.grossMinutes)}</td>
								<td data-label="Breaks" class="tnum">{formatDuration(row.breakMinutes)}</td>
								<td data-label="Payable" class="tnum font-semibold">
									{formatDuration(row.payableMinutes)}
								</td>
								<td data-label="Status">
									<span class="badge {statusTone[row.status]}">{row.status}</span>
									{#if row.stale}
										<span class="badge badge-warn">Shifts changed</span>
									{/if}
								</td>
								<td data-label="">
									<div class="flex flex-wrap justify-end gap-1">
										{#if row.status === 'approved'}
											<form method="POST" action="?/reopen" use:enhance={() => {
												pending = row.membershipId;
												return async ({ update }) => {
													await update();
													pending = '';
												};
											}}>
												<input type="hidden" name="timesheetId" value={row.timesheetId} />
												<button
													type="submit"
													class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
													disabled={pending === row.membershipId}
												>
													Reopen
												</button>
											</form>
										{:else}
											<button
												type="button"
												class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
												onclick={() => (deciding = { row, decision: 'rejected' })}
											>
												Reject
											</button>
											<button
												type="button"
												class="btn btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
												onclick={() => (deciding = { row, decision: 'approved' })}
											>
												Approve
											</button>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Card>
	</div>

	<p class="hint mt-3">
		Approved timesheets are locked. Reopening one is recorded, and corrections to the underlying
		shifts stay in the audit log.
	</p>
</div>

<Modal
	open={deciding !== null}
	title={deciding?.decision === 'approved' ? 'Approve timesheet' : 'Reject timesheet'}
	onclose={() => (deciding = null)}
>
	{#if deciding}
		<form
			method="POST"
			action="?/review"
			id="timesheet-form"
			use:enhance={() => {
				pending = 'review';
				return async ({ update }) => {
					await update();
					pending = '';
					deciding = null;
				};
			}}
		>
			<input type="hidden" name="membershipId" value={deciding.row.membershipId} />
			<input type="hidden" name="periodStart" value={data.periodStart} />
			<input type="hidden" name="periodEnd" value={data.periodEnd} />
			<input type="hidden" name="decision" value={deciding.decision} />

			<p class="!mt-0 mb-1 text-sm font-medium">{deciding.row.name}</p>
			<p class="hint !mt-0 mb-4">
				{data.periodStart} &ndash; {data.periodEnd} &middot;
				{formatDuration(deciding.row.payableMinutes)} payable across
				{deciding.row.shifts} shift{deciding.row.shifts === 1 ? '' : 's'}
			</p>

			<label class="label" for="note">Note</label>
			<textarea id="note" name="note" class="input" rows="3" maxlength="1000"></textarea>
			<p class="hint">Visible to the employee alongside the decision.</p>
		</form>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (deciding = null)}>
			Cancel
		</button>
		<SubmitButton
			pending={pending === 'review'}
			form="timesheet-form"
			variant={deciding?.decision === 'approved' ? 'primary' : 'danger'}
			pendingLabel="Saving..."
		>
			{deciding?.decision === 'approved' ? 'Approve' : 'Reject'}
		</SubmitButton>
	{/snippet}
</Modal>
