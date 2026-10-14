<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/components/icons';
	import type { Snippet } from 'svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	interface NavItem {
		href: string;
		label: string;
		icon: IconName;
		badge?: number;
	}

	const managerNav: NavItem[] = $derived([
		{ href: '/app/dashboard', label: 'Dashboard', icon: 'dashboard' },
		{ href: '/app/station', label: 'Station', icon: 'station' },
		{ href: '/app/employees', label: 'Employees', icon: 'people' },
		{ href: '/app/attendance', label: 'Attendance', icon: 'calendar' },
		{ href: '/app/timesheets', label: 'Timesheets', icon: 'timesheet' },
		{ href: '/app/tasks', label: 'Tasks', icon: 'task' },
		{ href: '/app/time-off', label: 'Time off', icon: 'leave' },
		{ href: '/app/payroll', label: 'Earnings', icon: 'money' },
		{ href: '/app/invitations', label: 'Invitations', icon: 'invite' },
		{ href: '/app/settings', label: 'Settings', icon: 'settings' }
	]);

	const employeeNav: NavItem[] = $derived(
		[
			{ href: '/app/home', label: 'Home', icon: 'home' as IconName },
			data.settings.qrClockingEnabled
				? { href: '/app/scan', label: 'Scan', icon: 'scan' as IconName }
				: null,
			{ href: '/app/my-attendance', label: 'My attendance', icon: 'calendar' as IconName },
			{ href: '/app/my-tasks', label: 'My tasks', icon: 'task' as IconName },
			{ href: '/app/my-time-off', label: 'My time off', icon: 'leave' as IconName },
			data.settings.employeeEarningsVisible
				? { href: '/app/my-earnings', label: 'My earnings', icon: 'money' as IconName }
				: null,
			{ href: '/app/profile', label: 'Profile', icon: 'user' as IconName }
		].filter((i): i is NavItem => i !== null)
	);

	const isManager = $derived(data.org?.isManager ?? false);
	const sidebarNav = $derived(isManager ? [...managerNav, ...employeeNav] : employeeNav);

	/** Five slots at most on a phone; the rest live behind "More". */
	const mobileNav: NavItem[] = $derived(
		isManager
			? [
					{ href: '/app/dashboard', label: 'Dashboard', icon: 'dashboard' },
					{ href: '/app/station', label: 'Station', icon: 'station' },
					{ href: '/app/employees', label: 'Team', icon: 'people' },
					{ href: '/app/time-off', label: 'Requests', icon: 'leave' },
					{ href: '/app/more', label: 'More', icon: 'more' }
				]
			: [
					{ href: '/app/home', label: 'Home', icon: 'home' },
					...(data.settings.qrClockingEnabled
						? [{ href: '/app/scan', label: 'Scan', icon: 'scan' as IconName }]
						: []),
					{ href: '/app/my-tasks', label: 'Tasks', icon: 'task' },
					{ href: '/app/my-time-off', label: 'Time off', icon: 'leave' },
					{ href: '/app/profile', label: 'Profile', icon: 'user' }
				]
	);

	function isActive(href: string): boolean {
		if (href === '/app/home' || href === '/app/dashboard') return page.url.pathname === href;
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

	/** The clocking station takes over the screen, so it hides the chrome. */
	const chromeless = $derived(page.url.pathname.startsWith('/app/station/display'));
</script>

{#if chromeless}
	{@render children()}
{:else}
	<div class="min-h-dvh lg:flex">
		<!-- Desktop sidebar -->
		<aside
			class="hidden w-60 shrink-0 border-r lg:flex lg:flex-col"
			style="border-color: var(--border); background: var(--surface)"
		>
			<div class="flex items-center gap-2 px-4 py-4">
				<img src="/icon.svg" alt="" width="26" height="26" />
				<span class="font-semibold">Shiftly</span>
			</div>

			<div class="px-4 pb-3">
				<p class="hint !mt-0 truncate font-medium" style="color: var(--text)">
					{data.org?.name}
				</p>
				<p class="hint !mt-0 capitalize">{data.org?.role}</p>
			</div>

			<nav class="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main">
				{#if isManager}
					<p class="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase" style="color: var(--text-muted)">
						Manage
					</p>
					{#each managerNav as item (item.href)}
						{@render navLink(item)}
					{/each}
					<p class="px-3 pt-4 pb-1 text-xs font-semibold tracking-wide uppercase" style="color: var(--text-muted)">
						My work
					</p>
				{/if}
				{#each employeeNav as item (item.href)}
					{@render navLink(item)}
				{/each}
			</nav>

			<div class="border-t px-2 py-2" style="border-color: var(--border)">
				{@render navLink({
					href: '/app/notifications',
					label: 'Notifications',
					icon: 'bell',
					badge: data.unreadCount
				})}
				<form method="POST" action="/auth/signout">
					<button
						type="submit"
						class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium"
						style="color: var(--text-muted)"
					>
						<Icon name="close" size={18} />
						Sign out
					</button>
				</form>
			</div>
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- Mobile header -->
			<header
				class="sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-2.5 lg:hidden"
				style="border-color: var(--border); background: var(--surface)"
			>
				<div class="flex min-w-0 items-center gap-2">
					<img src="/icon.svg" alt="" width="24" height="24" />
					<span class="truncate text-sm font-semibold">{data.org?.name}</span>
				</div>
				<a
					href="/app/notifications"
					class="relative flex h-9 w-9 items-center justify-center rounded-lg"
					style="color: var(--text-muted)"
					aria-label="Notifications{data.unreadCount ? ` (${data.unreadCount} unread)` : ''}"
				>
					<Icon name="bell" size={20} />
					{#if data.unreadCount > 0}
						<span
							class="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
							style="background: var(--danger); color: #fff"
						>
							{data.unreadCount > 9 ? '9+' : data.unreadCount}
						</span>
					{/if}
				</a>
			</header>

			<main class="flex-1 pb-24 lg:pb-8">
				{@render children()}
			</main>

			<!-- Mobile bottom navigation -->
			<nav
				class="fixed inset-x-0 bottom-0 z-20 grid border-t lg:hidden"
				style="border-color: var(--border); background: var(--surface); grid-template-columns: repeat({mobileNav.length}, minmax(0, 1fr)); padding-bottom: env(safe-area-inset-bottom)"
				aria-label="Main"
			>
				{#each mobileNav as item (item.href)}
					{@const active = isActive(item.href)}
					<a
						href={item.href}
						class="flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] font-medium no-underline"
						style="color: {active ? 'var(--color-brand-600)' : 'var(--text-muted)'}"
						aria-current={active ? 'page' : undefined}
					>
						<Icon name={item.icon} size={22} />
						<span class="truncate">{item.label}</span>
					</a>
				{/each}
			</nav>
		</div>
	</div>
{/if}

{#snippet navLink(item: NavItem)}
	{@const active = isActive(item.href)}
	<a
		href={item.href}
		class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium no-underline"
		style="color: {active ? 'var(--color-brand-700)' : 'var(--text-muted)'}; background: {active
			? 'var(--info-surface)'
			: 'transparent'}"
		aria-current={active ? 'page' : undefined}
	>
		<Icon name={item.icon} size={18} />
		<span class="truncate">{item.label}</span>
		{#if item.badge}
			<span
				class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold"
				style="background: var(--danger); color: #fff">{item.badge}</span
			>
		{/if}
	</a>
{/snippet}
