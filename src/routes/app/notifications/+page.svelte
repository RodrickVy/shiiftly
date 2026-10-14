<script lang="ts">
	import { enhance } from '$app/forms';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let pending = $state(false);

	const unread = $derived(data.notifications.filter((n) => !n.read_at).length);

	function when(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>Notifications — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Notifications</h1>
			<p class="hint">{unread} unread</p>
		</div>
		{#if unread > 0}
			<form
				method="POST"
				action="?/markRead"
				use:enhance={() => {
					pending = true;
					return async ({ update }) => {
						await update();
						pending = false;
					};
				}}
			>
				<button type="submit" class="btn btn-secondary" disabled={pending}>
					Mark all as read
				</button>
			</form>
		{/if}
	</header>

	<Card padded={false}>
		{#if data.notifications.length === 0}
			<EmptyState
				title="Nothing here yet"
				description="Leave requests and decisions will show up here."
			/>
		{:else}
			<ul class="divide-y" style="border-color: var(--border)">
				{#each data.notifications as notification (notification.id)}
					<li
						class="px-4 py-3 sm:px-5"
						style={notification.read_at ? '' : 'background: var(--info-surface)'}
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium">
									{#if !notification.read_at}
										<span
											class="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
											style="background: var(--info)"
											aria-label="Unread"
										></span>
									{/if}
									{notification.title}
								</p>
								<p class="hint !mt-0.5">{notification.body}</p>
								{#if notification.link}
									<a
										href={notification.link}
										class="mt-1 inline-block text-sm"
										style="color: var(--color-brand-600)">Open</a
									>
								{/if}
							</div>
							<span class="hint !mt-0 shrink-0">{when(notification.created_at)}</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</div>
