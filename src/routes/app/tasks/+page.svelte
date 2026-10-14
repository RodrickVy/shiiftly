<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let showCreate = $state(false);
	let editingAssignees = $state<null | (typeof data.tasks)[number]>(null);
	let pending = $state('');

	const priorityTone: Record<string, string> = {
		high: 'badge-danger',
		medium: 'badge-warn',
		low: 'badge-muted'
	};
	const statusTone: Record<string, string> = {
		todo: 'badge-muted',
		in_progress: 'badge-info',
		completed: 'badge-ok',
		cancelled: 'badge-muted'
	};

	const tabs = $derived([
		{ value: 'open', label: `Open (${data.counts.open})` },
		{ value: 'completed', label: `Completed (${data.counts.completed})` },
		{ value: 'all', label: 'All' }
	]);

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

	const enhanceFor = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = '';
		};
	};
</script>

<svelte:head><title>Tasks — Shiftly</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Tasks</h1>
			<p class="hint">Assign work and see how it is going.</p>
		</div>
		<button type="button" class="btn btn-primary" onclick={() => (showCreate = true)}>
			<Icon name="plus" size={18} />
			New task
		</button>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.created}
		<div class="mb-4"><Alert tone="ok">Task created.</Alert></div>
	{/if}
	{#if form?.assigned}
		<div class="mb-4"><Alert tone="ok">Assignees updated.</Alert></div>
	{/if}

	<div class="mb-4 flex flex-wrap gap-2">
		{#each tabs as tab (tab.value)}
			<a
				href="/app/tasks?status={tab.value}"
				class="btn {data.statusFilter === tab.value ? 'btn-primary' : 'btn-secondary'}"
			>
				{tab.label}
			</a>
		{/each}
	</div>

	<Card padded={false}>
		{#if data.tasks.length === 0}
			<EmptyState title="No tasks" description="Create one and assign it to your team.">
				<button type="button" class="btn btn-primary" onclick={() => (showCreate = true)}>
					New task
				</button>
			</EmptyState>
		{:else}
			<ul class="divide-y" style="border-color: var(--border)">
				{#each data.tasks as task (task.id)}
					<li class="px-4 py-3 sm:px-5">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium">{task.title}</p>
								{#if task.description}
									<p class="hint !mt-0.5 whitespace-pre-line">{task.description}</p>
								{/if}
								<div class="mt-1.5 flex flex-wrap items-center gap-2">
									<span class="badge {priorityTone[task.priority]}">{task.priority}</span>
									<span class="badge {statusTone[task.status]}">
										{task.status.replace('_', ' ')}
									</span>
									{#if task.dueAt}
										<span class="badge badge-muted">Due {dueLabel(task.dueAt)}</span>
									{/if}
								</div>
								<p class="hint">
									{task.assignees.length > 0
										? `Assigned to ${task.assignees.join(', ')}`
										: 'Not assigned to anyone'}
								</p>
							</div>

							<div class="flex shrink-0 flex-wrap items-center gap-1">
								<button
									type="button"
									class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
									onclick={() => (editingAssignees = task)}
								>
									Assign
								</button>

								{#if task.status !== 'completed' && task.status !== 'cancelled'}
									<form method="POST" action="?/setStatus" use:enhance={enhanceFor(task.id)}>
										<input type="hidden" name="taskId" value={task.id} />
										<input type="hidden" name="status" value="completed" />
										<button
											type="submit"
											class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
											disabled={pending === task.id}
										>
											Complete
										</button>
									</form>
								{:else}
									<form method="POST" action="?/setStatus" use:enhance={enhanceFor(task.id)}>
										<input type="hidden" name="taskId" value={task.id} />
										<input type="hidden" name="status" value="todo" />
										<button
											type="submit"
											class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
											disabled={pending === task.id}
										>
											Reopen
										</button>
									</form>
								{/if}

								<form method="POST" action="?/delete" use:enhance={enhanceFor(task.id)}>
									<input type="hidden" name="taskId" value={task.id} />
									<button
										type="submit"
										class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
										style="color: var(--danger)"
										disabled={pending === task.id}
									>
										Delete
									</button>
								</form>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<p class="hint mt-3">Completing a task never clocks someone out.</p>
</div>

<!-- Create -->
<Modal bind:open={showCreate} title="New task">
	<form
		method="POST"
		action="?/create"
		id="task-form"
		use:enhance={() => {
			pending = 'create';
			return async ({ update }) => {
				await update();
				pending = '';
				showCreate = false;
			};
		}}
	>
		<Field label="Title" name="title" error={form?.errors?.title} required>
			{#snippet children({ id, describedBy, invalid })}
				<input
					{id}
					name="title"
					class="input"
					required
					maxlength="160"
					placeholder="Restock the fridge"
					aria-invalid={invalid}
					aria-describedby={describedBy}
				/>
			{/snippet}
		</Field>

		<Field label="Description" name="description" error={form?.errors?.description}>
			{#snippet children({ id, describedBy })}
				<textarea
					{id}
					name="description"
					class="input"
					rows="3"
					maxlength="2000"
					aria-describedby={describedBy}
				></textarea>
			{/snippet}
		</Field>

		<div class="grid gap-x-4 sm:grid-cols-2">
			<Field label="Priority" name="priority" error={form?.errors?.priority}>
				{#snippet children({ id, describedBy })}
					<select {id} name="priority" class="input" aria-describedby={describedBy}>
						<option value="low">Low</option>
						<option value="medium" selected>Medium</option>
						<option value="high">High</option>
					</select>
				{/snippet}
			</Field>

			<Field label="Due" name="dueAt" hint="Optional." error={form?.errors?.dueAt}>
				{#snippet children({ id, describedBy })}
					<input
						{id}
						name="dueAt"
						type="datetime-local"
						class="input"
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
		</div>

		<fieldset class="mb-4">
			<legend class="label">Assign to</legend>
			{#if data.employees.length === 0}
				<p class="hint !mt-0">Invite people first.</p>
			{:else}
				<div class="max-h-48 overflow-y-auto rounded-lg border" style="border-color: var(--border)">
					{#each data.employees as employee (employee.id)}
						<label class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
							<input type="checkbox" name="assignees[]" value={employee.id} class="h-4 w-4" />
							{employee.name}
						</label>
					{/each}
				</div>
			{/if}
		</fieldset>
	</form>

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (showCreate = false)}>
			Cancel
		</button>
		<SubmitButton pending={pending === 'create'} form="task-form" pendingLabel="Creating...">
			Create task
		</SubmitButton>
	{/snippet}
</Modal>

<!-- Assignees -->
<Modal
	open={editingAssignees !== null}
	title="Assign task"
	onclose={() => (editingAssignees = null)}
>
	{#if editingAssignees}
		<form
			method="POST"
			action="?/assign"
			id="assign-form"
			use:enhance={() => {
				pending = 'assign';
				return async ({ update }) => {
					await update();
					pending = '';
					editingAssignees = null;
				};
			}}
		>
			<input type="hidden" name="taskId" value={editingAssignees.id} />
			<p class="!mt-0 mb-3 text-sm font-medium">{editingAssignees.title}</p>

			<div class="max-h-64 overflow-y-auto rounded-lg border" style="border-color: var(--border)">
				{#each data.employees as employee (employee.id)}
					<label class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
						<input
							type="checkbox"
							name="assignees[]"
							value={employee.id}
							class="h-4 w-4"
							checked={editingAssignees.assigneeIds.includes(employee.id)}
						/>
						{employee.name}
					</label>
				{/each}
			</div>
			<p class="hint">Unchecking everyone leaves the task unassigned.</p>
		</form>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (editingAssignees = null)}>
			Cancel
		</button>
		<SubmitButton pending={pending === 'assign'} form="assign-form" pendingLabel="Saving...">
			Save assignees
		</SubmitButton>
	{/snippet}
</Modal>
