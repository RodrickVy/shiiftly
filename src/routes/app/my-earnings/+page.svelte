<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import DateRangePicker from '$lib/components/DateRangePicker.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import { formatMoney, minutesToHours } from '$lib/domain/earnings';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	function dayLabel(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>My earnings — Shiftly</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">My earnings</h1>
		<p class="hint">An estimate from your recorded hours. Not a payslip.</p>
	</header>

	<div class="mb-4"><DateRangePicker from={data.from} to={data.to} /></div>

	{#if !data.hasRate}
		<div class="mb-4">
			<Alert tone="info" title="No pay rate set">
				Your organization has not recorded an hourly rate for you, so no estimate can be shown.
				Your hours are still being recorded.
			</Alert>
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<StatCard
			label="Payable hours"
			value={minutesToHours(data.estimate.payableMinutes)}
			hint={formatDuration(data.estimate.payableMinutes)}
		/>
		<StatCard
			label="Hourly rate"
			value={data.currentRate
				? formatMoney(data.currentRate.hourlyRateCents, data.currentRate.currencyCode)
				: '—'}
			hint="Currently in force"
		/>
		<StatCard
			label="Estimated gross"
			value={formatMoney(data.estimate.grossCents, data.estimate.currencyCode)}
			tone="ok"
			hint="Before any deductions"
		/>
	</div>

	<div class="mt-4">
		<Alert tone="warn" title="This is an estimate">
			It multiplies your recorded payable hours by the rate that applied on each day. It does not
			include overtime, taxes, statutory deductions or benefits, and it is not a confirmation of
			what you will be paid.
		</Alert>
	</div>

	{#if data.estimate.unratedMinutes > 0}
		<div class="mt-4">
			<Alert tone="info">
				{formatDuration(data.estimate.unratedMinutes)} of your hours fall outside any recorded
				pay rate and are excluded from the estimate above.
			</Alert>
		</div>
	{/if}

	{#if data.estimate.segments.length > 1}
		<div class="mt-4">
			<Card title="Rate breakdown" subtitle="Your rate changed during this period">
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Rate</th>
							<th scope="col">Hours</th>
							<th scope="col">Subtotal</th>
						</tr>
					</thead>
					<tbody>
						{#each data.estimate.segments as segment (segment.hourlyRateCents)}
							<tr>
								<td data-label="Rate">
									{formatMoney(segment.hourlyRateCents, data.estimate.currencyCode)} / hour
								</td>
								<td data-label="Hours" class="tnum">{minutesToHours(segment.payableMinutes)}</td>
								<td data-label="Subtotal" class="tnum font-semibold">
									{formatMoney(segment.grossCents, data.estimate.currencyCode)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Card>
		</div>
	{/if}

	<div class="mt-4">
		<Card title="Shifts in this period" padded={false}>
			{#if data.shifts.length === 0}
				<EmptyState title="No completed shifts" description="Try a wider date range." />
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Day</th>
							<th scope="col">Payable</th>
						</tr>
					</thead>
					<tbody>
						{#each data.shifts as shift (shift.id)}
							<tr>
								<td data-label="Day">{dayLabel(shift.startedAt)}</td>
								<td data-label="Payable" class="tnum">{formatDuration(shift.payableMinutes)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Card>
	</div>

	{#if data.rateHistory.length > 1}
		<div class="mt-4">
			<Card title="Rate history">
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.rateHistory as rate (rate.effectiveFrom)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="text-sm">
								{rate.effectiveFrom} – {rate.effectiveUntil ?? 'now'}
							</span>
							<span class="tnum text-sm font-semibold">
								{formatMoney(rate.hourlyRateCents, rate.currencyCode)}
							</span>
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}
</div>
