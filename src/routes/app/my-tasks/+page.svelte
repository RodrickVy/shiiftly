<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state('');

	const priorityTone: Record<string, string> = {
		high: 'badge-danger',
		medium: 'badge-warn',
		low: 'badge-muted'
	};

	function dueLabel(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}

	const isOverdue = (iso: string | null) => Boolean(iso && new Date(iso) < new Date());
</script>

<svelte:head><title>My tasks — Shiftly</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">My tasks</h1>
		<p class="hint">Work assigned to you. Completing a task does not clock you out.</p>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}

	<Card title="To do">
		{#if data.open.length === 0}
			<EmptyState title="Nothing assigned" description="Tasks your manager assigns will appear here." />
		{:else}
			<ul class="-my-2 divide-y" style="border-color: var(--border)">
				{#each data.open as task (task.id)}
					<li class="py-3">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium">{task.title}</p>
								{#if task.description}
									<p class="hint !mt-0.5 whitespace-pre-line">{task.description}</p>
								{/if}
								<div class="mt-1.5 flex flex-wrap items-center gap-2">
									<span class="badge {priorityTone[task.priority]}">{task.priority}</span>
									{#if task.status === 'in_progress'}
										<span class="badge badge-info">In progress</span>
									{/if}
									{#if task.dueAt}
										<span class="badge {isOverdue(task.dueAt) ? 'badge-danger' : 'badge-muted'}">
											{isOverdue(task.dueAt) ? 'Overdue' : 'Due'} {dueLabel(task.dueAt)}
										</span>
									{/if}
								</div>
							</div>
						</div>

						<div class="mt-3 flex flex-wrap gap-2">
							{#if task.status === 'todo'}
								<form
									method="POST"
									action="?/updateStatus"
									use:enhance={() => {
										pending = task.id;
										return async ({ update }) => {
											await update();
											pending = '';
										};
									}}
								>
									<input type="hidden" name="taskId" value={task.id} />
									<input type="hidden" name="status" value="in_progress" />
									<button type="submit" class="btn btn-secondary" disabled={pending === task.id}>
										Start
									</button>
								</form>
							{:else}
								<form
									method="POST"
									action="?/updateStatus"
									use:enhance={() => {
										pending = task.id;
										return async ({ update }) => {
											await update();
											pending = '';
										};
									}}
								>
									<input type="hidden" name="taskId" value={task.id} />
									<input type="hidden" name="status" value="todo" />
									<button type="submit" class="btn btn-ghost" disabled={pending === task.id}>
										Pause
									</button>
								</form>
							{/if}

							<form
								method="POST"
								action="?/updateStatus"
								use:enhance={() => {
									pending = task.id;
									return async ({ update }) => {
										await update();
										pending = '';
									};
								}}
							>
								<input type="hidden" name="taskId" value={task.id} />
								<input type="hidden" name="status" value="completed" />
								<button type="submit" class="btn btn-primary" disabled={pending === task.id}>
									Mark complete
								</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	{#if data.done.length > 0}
		<div class="mt-4">
			<Card title="Finished">
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.done as task (task.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="min-w-0 truncate text-sm" style="color: var(--text-muted)">
								{task.title}
							</span>
							<span class="badge {task.status === 'completed' ? 'badge-ok' : 'badge-muted'}">
								{task.status === 'completed' ? 'Completed' : 'Cancelled'}
							</span>
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/if}
</div>
