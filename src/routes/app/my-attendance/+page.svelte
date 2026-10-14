<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import DateRangePicker from '$lib/components/DateRangePicker.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const tz = $derived(data.org?.timezone);

	function dayLabel(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(iso));
	}

	function clockTime(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: tz,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}

	const statusTone: Record<string, string> = {
		draft: 'badge-muted',
		pending: 'badge-warn',
		approved: 'badge-ok',
		rejected: 'badge-danger'
	};
</script>

<svelte:head><title>My attendance — Shiftly</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">My attendance</h1>
		<p class="hint">Only you and your managers can see these records.</p>
	</header>

	<div class="mb-4"><DateRangePicker from={data.from} to={data.to} /></div>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<StatCard label="Shifts" value={data.totals.shifts} />
		<StatCard label="Gross hours" value={formatDuration(data.totals.grossMinutes)} />
		<StatCard label="Unpaid breaks" value={formatDuration(data.totals.breakMinutes)} />
		<StatCard label="Payable hours" value={formatDuration(data.totals.payableMinutes)} tone="ok" />
	</div>

	{#if data.timesheets.length > 0}
		<div class="mt-4">
			<Card title="Timesheets">
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.timesheets as sheet (sheet.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<div class="min-w-0">
								<p class="text-sm font-medium">{sheet.period_start} – {sheet.period_end}</p>
								<p class="hint !mt-0">{formatDuration(sheet.payable_minutes)} payable</p>
							</div>
							<span class="badge {statusTone[sheet.status]}">{sheet.status}</span>
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}

	<div class="mt-4">
		<Card title="Shift history" padded={false}>
			{#if data.shifts.length === 0}
				<EmptyState
					title="No shifts in this range"
					description="Try a wider date range, or clock in to record your first shift."
				/>
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Day</th>
							<th scope="col">Start</th>
							<th scope="col">End</th>
							<th scope="col">Gross</th>
							<th scope="col">Break</th>
							<th scope="col">Payable</th>
							<th scope="col">Status</th>
						</tr>
					</thead>
					<tbody>
						{#each data.shifts as shift (shift.id)}
							<tr>
								<td data-label="Day">{dayLabel(shift.startedAt)}</td>
								<td data-label="Start" class="tnum">{clockTime(shift.startedAt)}</td>
								<td data-label="End" class="tnum">
									{shift.endedAt ? clockTime(shift.endedAt) : '—'}
								</td>
								<td data-label="Gross" class="tnum">
									{shift.grossMinutes !== null ? formatDuration(shift.grossMinutes) : '—'}
								</td>
								<td data-label="Break" class="tnum">
									{shift.unpaidBreakMinutes ? formatDuration(shift.unpaidBreakMinutes) : '—'}
								</td>
								<td data-label="Payable" class="tnum font-semibold">
									{shift.payableMinutes !== null ? formatDuration(shift.payableMinutes) : '—'}
								</td>
								<td data-label="Status">
									{#if shift.status === 'active'}
										<span class="badge badge-ok">In progress</span>
									{:else if shift.status === 'flagged'}
										<span class="badge badge-warn">Needs review</span>
									{:else}
										<span class="badge badge-muted">Complete</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Card>
	</div>

	{#if data.totals.incomplete > 0}
		<p class="hint mt-3">
			{data.totals.incomplete} shift{data.totals.incomplete === 1 ? '' : 's'} need attention — ask
			your manager to correct the record.
		</p>
	{/if}
</div>
