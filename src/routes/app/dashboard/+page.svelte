<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { formatDuration, formatTimer } from '$lib/domain/attendance';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const driftMs = $derived(Date.now() - new Date(data.serverNow).getTime());
	let tick = $state(Date.now());

	$effect(() => {
		const id = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(id);
	});

	function elapsedSeconds(startedAt: string, pausedSince: string | null): number {
		const correctedNow = tick - driftMs;
		const gross = Math.floor((correctedNow - new Date(startedAt).getTime()) / 1000);
		const paused = pausedSince
			? Math.floor((correctedNow - new Date(pausedSince).getTime()) / 1000)
			: 0;
		return Math.max(0, gross - Math.max(0, paused));
	}

	function clockTime(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}

	const activityLabels: Record<string, string> = {
		'organization.created': 'Organization created',
		'invitation.accepted': 'Someone joined the team',
		'membership.role_changed': 'A role was changed',
		'membership.status_changed': 'A membership was activated or deactivated',
		'time_off.approved': 'Time off approved',
		'time_off.rejected': 'Time off rejected',
		'pay_rate.set': 'A pay rate was set'
	};
</script>

<svelte:head><title>Dashboard — Shiftly</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">Dashboard</h1>
		<p class="hint">
			{new Intl.DateTimeFormat('en-GB', {
				timeZone: data.org?.timezone,
				weekday: 'long',
				day: 'numeric',
				month: 'long'
			}).format(new Date())}
		</p>
	</header>

	<!-- Overview -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
		<StatCard label="On shift" value={data.stats.clockedIn} tone="ok" />
		<StatCard label="On break" value={data.stats.onBreak} tone="warn" />
		<StatCard label="Not clocked in" value={data.stats.notClockedIn} />
		<StatCard label="Team members" value={data.stats.activeEmployees} href="/app/employees" />
		<StatCard
			label="Leave requests"
			value={data.stats.pendingTimeOff}
			tone={data.stats.pendingTimeOff > 0 ? 'info' : 'default'}
			href="/app/time-off"
		/>
		<StatCard
			label="Hours today"
			value={formatDuration(data.stats.minutesToday)}
			hint="Includes open shifts"
		/>
	</div>

	<div class="mt-4 grid gap-4 lg:grid-cols-2">
		<!-- Who is on shift -->
		<Card title="On shift now" subtitle="Live, from server timestamps">
			{#snippet actions()}
				<a href="/app/attendance" class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm">Attendance</a>
			{/snippet}

			{#if data.onShift.length === 0}
				<EmptyState title="Nobody is clocked in" description="Open the station so your team can scan in.">
					<a href="/app/station" class="btn btn-primary">
						<Icon name="station" size={18} />
						Open station
					</a>
				</EmptyState>
			{:else}
				<ul class="-my-2 divide-y" style="border-color: var(--border)">
					{#each data.onShift as entry (entry.shiftId)}
						<li class="flex items-center justify-between gap-3 py-2.5">
							<div class="min-w-0">
								<a
									href="/app/employees/{entry.membershipId}"
									class="truncate text-sm font-medium no-underline"
									style="color: var(--text)"
								>
									{entry.name}
								</a>
								<p class="hint !mt-0 truncate">
									Since {clockTime(entry.startedAt)}{entry.stationName
										? ` · ${entry.stationName}`
										: ''}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-3">
								<StatusBadge state={entry.state} />
								<span class="tnum w-20 text-right text-sm font-semibold">
									{formatTimer(elapsedSeconds(entry.startedAt, entry.onBreakSince))}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<!-- Pending approvals -->
		<Card title="Waiting for you">
			{#if data.pendingRequests.length === 0 && data.stats.pendingTimesheets === 0}
				<p class="hint !mt-0">Nothing needs your attention.</p>
			{:else}
				{#if data.stats.pendingTimesheets > 0}
					<a
						href="/app/timesheets"
						class="mb-2 flex items-center justify-between gap-3 rounded-lg px-3 py-2 no-underline"
						style="background: var(--info-surface); color: var(--info)"
					>
						<span class="text-sm font-medium">
							{data.stats.pendingTimesheets} timesheet{data.stats.pendingTimesheets === 1
								? ''
								: 's'} to review
						</span>
						<Icon name="chevron" size={16} />
					</a>
				{/if}

				{#if data.pendingRequests.length > 0}
					<ul class="-my-2 divide-y" style="border-color: var(--border)">
						{#each data.pendingRequests as request (request.id)}
							<li class="flex items-center justify-between gap-3 py-2.5">
								<div class="min-w-0">
									<p class="truncate text-sm font-medium">{request.name}</p>
									<p class="hint !mt-0 truncate">
										{request.leaveType} · {request.startDate}
										{#if request.endDate !== request.startDate}– {request.endDate}{/if}
									</p>
								</div>
								<a href="/app/time-off" class="btn btn-secondary !min-h-0 shrink-0 !px-3 !py-1.5 text-sm">
									Review
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</Card>

		<!-- Completed today -->
		<Card title="Completed today">
			{#if data.completedToday.length === 0}
				<p class="hint !mt-0">No shifts finished yet today.</p>
			{:else}
				<ul class="-my-2 divide-y" style="border-color: var(--border)">
					{#each data.completedToday as shift (shift.id)}
						<li class="flex items-center justify-between gap-3 py-2.5">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{shift.name}</p>
								<p class="hint !mt-0">
									{clockTime(shift.startedAt)}
									{#if shift.endedAt}– {clockTime(shift.endedAt)}{/if}
								</p>
							</div>
							<span class="tnum shrink-0 text-sm font-semibold">
								{shift.payableMinutes !== null ? formatDuration(shift.payableMinutes) : '—'}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<!-- Not clocked in -->
		<Card title="Not clocked in" subtitle="No schedule is configured, so this is not an absence list">
			{#if data.notClockedIn.length === 0}
				<p class="hint !mt-0">Everyone is on shift.</p>
			{:else}
				<ul class="-my-2 divide-y" style="border-color: var(--border)">
					{#each data.notClockedIn as member (member.id)}
						<li class="flex items-center justify-between gap-3 py-2.5">
							<div class="min-w-0">
								<a
									href="/app/employees/{member.id}"
									class="truncate text-sm font-medium no-underline"
									style="color: var(--text)">{member.name}</a
								>
								{#if member.jobTitle}<p class="hint !mt-0 truncate">{member.jobTitle}</p>{/if}
							</div>
							<StatusBadge state="not_clocked_in" />
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<!-- Upcoming leave -->
		{#if data.upcomingLeave.length > 0}
			<Card title="Approved absences">
				<ul class="-my-2 divide-y" style="border-color: var(--border)">
					{#each data.upcomingLeave as leave (leave.id)}
						<li class="flex items-center justify-between gap-3 py-2.5">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{leave.name}</p>
								<p class="hint !mt-0">{leave.leaveType}</p>
							</div>
							<span class="hint !mt-0 shrink-0">
								{leave.startDate}{leave.endDate !== leave.startDate ? ` – ${leave.endDate}` : ''}
							</span>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}

		<!-- Activity -->
		{#if data.activity.length > 0}
			<Card title="Recent activity">
				<ul class="-my-2 divide-y" style="border-color: var(--border)">
					{#each data.activity as entry (entry.id)}
						<li class="flex items-center justify-between gap-3 py-2.5">
							<span class="min-w-0 truncate text-sm">
								{activityLabels[entry.action] ?? entry.action}
							</span>
							<span class="hint !mt-0 shrink-0">
								{new Intl.DateTimeFormat('en-GB', {
									timeZone: data.org?.timezone,
									day: 'numeric',
									month: 'short',
									hour: '2-digit',
									minute: '2-digit',
									hour12: false
								}).format(new Date(entry.created_at))}
							</span>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	</div>
</div>
