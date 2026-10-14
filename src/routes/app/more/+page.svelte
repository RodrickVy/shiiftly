<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/components/icons';

	const manage: Array<{ href: string; label: string; icon: IconName; hint: string }> = [
		{ href: '/app/attendance', label: 'Attendance', icon: 'calendar', hint: 'Review and correct recorded hours' },
		{ href: '/app/timesheets', label: 'Timesheets', icon: 'timesheet', hint: 'Approve hours for a period' },
		{ href: '/app/tasks', label: 'Tasks', icon: 'task', hint: 'Assign work and track progress' },
		{ href: '/app/payroll', label: 'Earnings', icon: 'money', hint: 'Estimated pay and CSV export' },
		{ href: '/app/invitations', label: 'Invitations', icon: 'invite', hint: 'Invite people to join' },
		{ href: '/app/settings', label: 'Settings', icon: 'settings', hint: 'Breaks, clocking and notifications' }
	];

	const mine: Array<{ href: string; label: string; icon: IconName; hint: string }> = [
		{ href: '/app/home', label: 'My home', icon: 'home', hint: 'Clock in and out yourself' },
		{ href: '/app/my-attendance', label: 'My attendance', icon: 'calendar', hint: 'Your own hours' },
		{ href: '/app/my-tasks', label: 'My tasks', icon: 'task', hint: 'Work assigned to you' },
		{ href: '/app/profile', label: 'Profile', icon: 'user', hint: 'Your details' },
		{ href: '/app/notifications', label: 'Notifications', icon: 'bell', hint: 'Requests and decisions' }
	];
</script>

<svelte:head><title>More — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-5">
	<h1 class="mb-4 text-xl font-bold">More</h1>

	<Card title="Manage" padded={false}>
		<ul class="divide-y" style="border-color: var(--border)">
			{#each manage as item (item.href)}
				<li>
					<a href={item.href} class="flex items-center gap-3 px-4 py-3 no-underline sm:px-5" style="color: var(--text)">
						<span style="color: var(--text-muted)"><Icon name={item.icon} size={20} /></span>
						<span class="min-w-0 flex-1">
							<span class="block font-medium">{item.label}</span>
							<span class="hint !mt-0 block">{item.hint}</span>
						</span>
						<span style="color: var(--text-muted)"><Icon name="chevron" size={16} /></span>
					</a>
				</li>
			{/each}
		</ul>
	</Card>

	<div class="mt-4">
		<Card title="My work" padded={false}>
			<ul class="divide-y" style="border-color: var(--border)">
				{#each mine as item (item.href)}
					<li>
						<a href={item.href} class="flex items-center gap-3 px-4 py-3 no-underline sm:px-5" style="color: var(--text)">
							<span style="color: var(--text-muted)"><Icon name={item.icon} size={20} /></span>
							<span class="min-w-0 flex-1">
								<span class="block font-medium">{item.label}</span>
								<span class="hint !mt-0 block">{item.hint}</span>
							</span>
							<span style="color: var(--text-muted)"><Icon name="chevron" size={16} /></span>
						</a>
					</li>
				{/each}
			</ul>
		</Card>
	</div>

	<form method="POST" action="/auth/signout" class="mt-4">
		<button type="submit" class="btn btn-secondary w-full">Sign out</button>
	</form>
</div>
