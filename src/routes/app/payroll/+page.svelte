<script lang="ts">
	import { page } from '$app/state';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import { formatMoney, minutesToHours } from '$lib/domain/earnings';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const exportHref = $derived(`/app/payroll/export?${page.url.searchParams.toString()}`);
</script>

<svelte:head><title>Earnings — Shiftly</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Earnings estimate</h1>
			<p class="hint">Approved payable hours multiplied by the rate in force on each day.</p>
		</div>
		<a href={exportHref} class="btn btn-secondary" data-sveltekit-reload>
			<Icon name="download" size={18} />
			Export CSV
		</a>
	</header>

	<div class="mb-4">
		<Alert tone="warn" title="This is not payroll">
			Shiftly does not calculate taxes, statutory deductions, benefits or overtime, and it never
			moves money. Treat these figures as an input to whatever you use to pay people.
		</Alert>
	</div>

	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2">
		<div>
			<label class="label" for="from">From</label>
			<input id="from" name="from" type="date" class="input" value={data.from} max={data.to} />
		</div>
		<div>
			<label class="label" for="to">To</label>
			<input id="to" name="to" type="date" class="input" value={data.to} min={data.from} />
		</div>
		<label class="flex items-center gap-2 pb-2.5 text-sm">
			<input type="checkbox" name="approved" value="1" class="h-4 w-4" checked={data.approvedOnly} />
			Approved timesheets only
		</label>
		<button type="submit" class="btn btn-secondary">Apply</button>
	</form>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<StatCard label="People" value={data.rows.length} />
		<StatCard label="Payable hours" value={formatDuration(data.totals.payableMinutes)} />
		<StatCard
			label="Estimated gross"
			value={formatMoney(data.totals.grossCents, data.currency)}
			tone="ok"
		/>
	</div>

	{#if data.totals.missingRates > 0}
		<div class="mt-4">
			<Alert tone="info">
				{data.totals.missingRates} employee(s) have no hourly rate recorded, so no estimate can
				be produced for them. Their hours are still shown.
			</Alert>
		</div>
	{/if}

	<div class="mt-4">
		<Card padded={false}>
			{#if data.rows.length === 0}
				<EmptyState
					title="Nothing to estimate"
					description={data.approvedOnly
						? 'No approved timesheets fall in this period.'
						: 'No completed shifts fall in this period.'}
				/>
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Employee</th>
							<th scope="col">Payable hours</th>
							<th scope="col">Estimated gross</th>
							<th scope="col">Timesheet</th>
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
								<td data-label="Payable hours" class="tnum">
									{minutesToHours(row.payableMinutes)}
									{#if row.unratedMinutes > 0}
										<span class="hint !mt-0 block">
											{minutesToHours(row.unratedMinutes)} without a rate
										</span>
									{/if}
								</td>
								<td data-label="Estimated gross" class="tnum font-semibold">
									{#if row.hasRate}
										{formatMoney(row.grossCents, row.currencyCode)}
									{:else}
										<span class="badge badge-muted">No rate set</span>
									{/if}
								</td>
								<td data-label="Timesheet">
									<span class="badge {row.approved ? 'badge-ok' : 'badge-warn'}">
										{row.approved ? 'Approved' : 'Not approved'}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Card>
	</div>

	{#if data.approvalRequired && !data.approvedOnly}
		<p class="hint mt-3">
			Your organization requires timesheet approval. Tick "Approved timesheets only" to see just
			the hours you have signed off.
		</p>
	{/if}
</div>
