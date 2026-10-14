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

	const enhanceForm = () => {
		pending = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = false;
		};
	};

	function clockTime(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>My shift — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">My shift</h1>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}

	{#if !data.shift}
		<Card>
			<div class="py-6 text-center">
				<p class="font-medium">You are not clocked in</p>
				{#if data.lastShift}
					<p class="hint">
						Your last shift ran {clockTime(data.lastShift.started_at)}
						{#if data.lastShift.ended_at}– {clockTime(data.lastShift.ended_at)}{/if}
						{#if data.lastShift.payable_minutes !== null}
							· {formatDuration(data.lastShift.payable_minutes)} payable
						{/if}
					</p>
				{/if}
				<a href="/app/home" class="btn btn-primary mt-5">Go to Home</a>
			</div>
		</Card>
	{:else}
		<section class="card px-5 py-6">
			<div class="mb-4 flex justify-center">
				<StatusBadge state={data.shift.onBreakSince ? 'on_break' : 'working'} />
			</div>

			<ShiftTimer
				startedAt={data.shift.startedAt}
				serverNow={data.serverNow}
				pausedSince={data.shift.onBreakSince}
				pausedTotalSeconds={data.completedBreakSeconds}
				label={data.shift.onBreakSince ? 'Worked before this break' : 'Working time'}
			/>

			<dl class="mt-5 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
				<div>
					<dt class="hint !mt-0">Clocked in</dt>
					<dd class="tnum font-semibold">{clockTime(data.shift.startedAt)}</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Station</dt>
					<dd class="truncate font-semibold">{data.shift.stationName ?? 'In app'}</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Breaks</dt>
					<dd class="font-semibold">
						{data.projected ? formatDuration(data.projected.unpaidBreak) : '—'}
					</dd>
				</div>
				<div>
					<dt class="hint !mt-0">Payable so far</dt>
					<dd class="font-semibold">
						{data.projected ? formatDuration(data.projected.payable) : '—'}
					</dd>
				</div>
			</dl>

			<div class="mt-6 flex flex-col gap-2">
				{#if data.breakMode === 'manual'}
					<form method="POST" action="?/break" use:enhance={enhanceForm}>
						<input type="hidden" name="intent" value={data.shift.onBreakSince ? 'end' : 'start'} />
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

				{#if data.shift.onBreakSince}
					<p class="hint text-center">End your break before clocking out.</p>
				{:else if data.directEnabled}
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
			</div>

			{#if data.projected && data.projected.unpaidBreak > 0}
				<p class="hint mt-4 text-center">
					Your organization's break policy deducts
					{formatDuration(data.projected.unpaidBreak)} from this shift.
				</p>
			{/if}
		</section>

		<!-- Breaks taken -->
		{#if data.shift.breaks.length > 0}
			<div class="mt-4">
				<Card title="Breaks this shift">
					<ul class="-my-1 divide-y" style="border-color: var(--border)">
						{#each data.shift.breaks as entry (entry.id)}
							<li class="flex items-center justify-between gap-3 py-2">
								<span class="text-sm">
									{clockTime(entry.startedAt)}
									{#if entry.endedAt}– {clockTime(entry.endedAt)}{:else}– in progress{/if}
								</span>
								<span class="badge {entry.endedAt ? 'badge-muted' : 'badge-warn'}">
									{entry.isPaid ? 'Paid' : 'Unpaid'}
								</span>
							</li>
						{/each}
					</ul>
				</Card>
			</div>
		{/if}

		<!-- Tasks -->
		<div class="mt-4">
			<Card title="Today's tasks">
				{#if data.tasks.length === 0}
					<p class="hint !mt-0">Nothing assigned to you.</p>
				{:else}
					<ul class="-my-2 divide-y" style="border-color: var(--border)">
						{#each data.tasks as task (task.id)}
							<li class="flex items-center justify-between gap-3 py-2.5">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{task.title}</p>
									<p class="hint !mt-0 capitalize">{task.priority} priority</p>
								</div>
								<form method="POST" action="?/updateTask" use:enhance={enhanceForm} class="shrink-0">
									<input type="hidden" name="taskId" value={task.id} />
									<input
										type="hidden"
										name="status"
										value={task.status === 'todo' ? 'in_progress' : 'completed'}
									/>
									<button type="submit" class="btn btn-secondary !min-h-0 !px-3 !py-1.5 text-sm" disabled={pending}>
										{task.status === 'todo' ? 'Start' : 'Complete'}
									</button>
								</form>
							</li>
						{/each}
					</ul>
				{/if}
				<p class="hint">Completing a task does not clock you out.</p>
			</Card>
		</div>
	{/if}
</div>
