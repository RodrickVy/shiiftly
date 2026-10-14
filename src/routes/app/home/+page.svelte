<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ShiftTimer from '$lib/components/ShiftTimer.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);

	const firstName = $derived((data.profile?.fullName ?? '').split(' ')[0] || 'there');

	const greeting = $derived.by(() => {
		const hour = new Date().getHours();
		if (hour < 12) return 'Good morning';
		if (hour < 18) return 'Good afternoon';
		return 'Good evening';
	});

	function clockTime(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}

	function dayLabel(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(iso));
	}

	const enhanceForm = () => {
		pending = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = false;
		};
	};
</script>

<svelte:head><title>Home — Shiftly</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">{greeting}, {firstName}</h1>
		<p class="hint">{data.org?.name}</p>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}

	<!-- Attendance card -->
	<section class="card px-5 py-6">
		<div class="mb-4 flex justify-center">
			<StatusBadge state={data.state} />
		</div>

		{#if data.shift}
			<ShiftTimer
				startedAt={data.shift.startedAt}
				serverNow={data.serverNow}
				pausedSince={data.shift.onBreakSince}
				pausedTotalSeconds={data.completedBreakSeconds}
				label={data.shift.onBreakSince ? 'Worked before this break' : 'Working time'}
			/>

			<p class="hint mt-1 text-center">
				Started {clockTime(data.shift.startedAt)}{data.shift.stationName
					? ` at ${data.shift.stationName}`
					: ''}
			</p>

			{#if data.projected}
				<p class="hint text-center">
					Payable so far: {formatDuration(data.projected.payable)}
					{#if data.projected.unpaidBreak > 0}
						(after {formatDuration(data.projected.unpaidBreak)} unpaid break)
					{/if}
				</p>
			{/if}

			<div class="mt-5 flex flex-col gap-2">
				{#if data.breakMode === 'manual'}
					<form method="POST" action="?/break" use:enhance={enhanceForm}>
						<input
							type="hidden"
							name="intent"
							value={data.shift.onBreakSince ? 'end' : 'start'}
						/>
						<SubmitButton
							{pending}
							variant="secondary"
							size="btn-lg"
							fullWidth
							pendingLabel="Saving..."
						>
							{data.shift.onBreakSince ? 'End break' : 'Start break'}
						</SubmitButton>
					</form>
				{/if}

				{#if !data.shift.onBreakSince}
					{#if data.directEnabled}
						<form method="POST" action="?/clock" use:enhance={enhanceForm}>
							<input type="hidden" name="intent" value="clock_out" />
							<input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
							<SubmitButton {pending} size="btn-lg" fullWidth pendingLabel="Clocking out...">
								Clock out
							</SubmitButton>
						</form>
					{:else if data.qrEnabled}
						<a href="/app/scan" class="btn btn-primary btn-lg w-full">
							<Icon name="scan" size={20} />
							Scan to clock out
						</a>
					{/if}
				{/if}

				<a href="/app/shift" class="btn btn-ghost w-full">Shift details</a>
			</div>
		{:else}
			<p class="text-center" style="color: var(--text-muted)">
				{data.state === 'shift_completed'
					? 'Your shift today is complete.'
					: 'You are not clocked in.'}
			</p>

			{#if data.todayPayableMinutes > 0}
				<p class="mt-1 text-center text-2xl font-bold">
					{formatDuration(data.todayPayableMinutes)}
				</p>
				<p class="hint !mt-0 text-center">recorded today</p>
			{/if}

			<div class="mt-5 flex flex-col gap-2">
				{#if data.directEnabled}
					<form method="POST" action="?/clock" use:enhance={enhanceForm}>
						<input type="hidden" name="intent" value="clock_in" />
						<input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
						<SubmitButton {pending} size="btn-lg" fullWidth pendingLabel="Clocking in...">
							Clock in
						</SubmitButton>
					</form>
				{/if}
				{#if data.qrEnabled}
					<a
						href="/app/scan"
						class="btn {data.directEnabled ? 'btn-secondary' : 'btn-primary'} btn-lg w-full"
					>
						<Icon name="scan" size={20} />
						Scan station code
					</a>
				{/if}
				{#if !data.directEnabled && !data.qrEnabled}
					<Alert tone="warn">
						Clocking is switched off for your organization. Speak to your manager.
					</Alert>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Today's tasks -->
	<div class="mt-4">
		<Card title="Today's tasks">
			{#snippet actions()}
				<a href="/app/my-tasks" class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm">View all</a>
			{/snippet}
			{#if data.tasks.length === 0}
				<p class="hint !mt-0">Nothing assigned to you right now.</p>
			{:else}
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.tasks as task (task.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{task.title}</p>
								{#if task.due_at}
									<p class="hint !mt-0">Due {dayLabel(task.due_at)}</p>
								{/if}
							</div>
							<span
								class="badge shrink-0 {task.priority === 'high'
									? 'badge-danger'
									: task.priority === 'medium'
										? 'badge-warn'
										: 'badge-muted'}"
							>
								{task.priority}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</div>

	<!-- Upcoming time off -->
	{#if data.upcomingTimeOff.length > 0}
		<div class="mt-4">
			<Card title="Approved time off">
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.upcomingTimeOff as leave (leave.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="text-sm font-medium">{leave.leave_type}</span>
							<span class="hint !mt-0">
								{leave.start_date}{leave.end_date !== leave.start_date
									? ` – ${leave.end_date}`
									: ''}
							</span>
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}

	<!-- Recent shifts -->
	<div class="mt-4">
		<Card title="Recent shifts">
			{#snippet actions()}
				<a href="/app/my-attendance" class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm">
					View all
				</a>
			{/snippet}
			{#if data.history.length === 0}
				<p class="hint !mt-0">No completed shifts yet.</p>
			{:else}
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.history as shift (shift.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<div class="min-w-0">
								<p class="text-sm font-medium">{dayLabel(shift.started_at)}</p>
								<p class="hint !mt-0">
									{clockTime(shift.started_at)}
									{#if shift.ended_at}– {clockTime(shift.ended_at)}{/if}
								</p>
							</div>
							<span class="tnum shrink-0 text-sm font-semibold">
								{shift.payable_minutes !== null ? formatDuration(shift.payable_minutes) : '—'}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</div>
</div>
