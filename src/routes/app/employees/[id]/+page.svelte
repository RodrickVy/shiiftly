<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import { formatMoney } from '$lib/domain/earnings';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state('');
	let showTask = $state(false);

	const priorityTone: Record<string, string> = {
		high: 'badge-danger',
		medium: 'badge-warn',
		low: 'badge-muted'
	};

	const enhanceFor = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = '';
		};
	};

	function dayLabel(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(iso));
	}

	function clockTime(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.org?.timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}

	const statusTone: Record<string, string> = {
		pending: 'badge-warn',
		approved: 'badge-ok',
		rejected: 'badge-danger',
		cancelled: 'badge-muted',
		todo: 'badge-muted',
		in_progress: 'badge-info',
		completed: 'badge-ok'
	};
</script>

<svelte:head><title>{data.membership.name} — Shiftly</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-5">
	<nav class="mb-3">
		<a href="/app/employees" class="text-sm" style="color: var(--color-brand-600)">
			&larr; All employees
		</a>
	</nav>

	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">{data.membership.name}</h1>
			<p class="hint">
				{data.membership.email}
				{#if data.membership.phone}&middot; {data.membership.phone}{/if}
			</p>
		</div>
		<div class="flex items-center gap-2">
			<span class="badge badge-info capitalize">{data.membership.role}</span>
			<span class="badge {data.membership.status === 'active' ? 'badge-ok' : 'badge-muted'}">
				{data.membership.status}
			</span>
		</div>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.saved}
		<div class="mb-4"><Alert tone="ok">Employment details saved.</Alert></div>
	{/if}
	{#if form?.rateSaved}
		<div class="mb-4"><Alert tone="ok">Pay rate saved. Previous rates are kept.</Alert></div>
	{/if}
	{#if form?.roleSaved}
		<div class="mb-4"><Alert tone="ok">Role updated.</Alert></div>
	{/if}
	{#if form?.noteAdded}
		<div class="mb-4"><Alert tone="ok">Note added.</Alert></div>
	{/if}
	{#if form?.taskAssigned}
		<div class="mb-4"><Alert tone="ok">Task created and assigned.</Alert></div>
	{/if}

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<StatCard label="Completed shifts" value={data.totals.shifts} />
		<StatCard label="Payable hours" value={formatDuration(data.totals.payableMinutes)} tone="ok" />
		<StatCard label="Joined" value={data.membership.joinedAt.slice(0, 10)} />
	</div>

	<!-- Employment -->
	<div class="mt-4">
		<Card title="Employment">
			<form method="POST" action="?/updateEmployment" use:enhance={enhanceFor('employment')}>
				<div class="grid gap-x-4 sm:grid-cols-2">
					<Field label="Job title" name="jobTitle" error={form?.errors?.jobTitle}>
						{#snippet children({ id, describedBy })}
							<input
								{id}
								name="jobTitle"
								class="input"
								maxlength="80"
								aria-describedby={describedBy}
								value={data.membership.jobTitle ?? ''}
							/>
						{/snippet}
					</Field>

					<Field label="Department" name="department" error={form?.errors?.department}>
						{#snippet children({ id, describedBy })}
							<input
								{id}
								name="department"
								class="input"
								maxlength="80"
								aria-describedby={describedBy}
								value={data.membership.department ?? ''}
							/>
						{/snippet}
					</Field>

					<Field
						label="Employee ID"
						name="employeeCode"
						hint="Your own reference, if you use one."
						error={form?.errors?.employeeCode}
					>
						{#snippet children({ id, describedBy })}
							<input
								{id}
								name="employeeCode"
								class="input"
								maxlength="40"
								aria-describedby={describedBy}
								value={data.membership.employeeCode ?? ''}
							/>
						{/snippet}
					</Field>

					<Field label="Start date" name="startDate" error={form?.errors?.startDate}>
						{#snippet children({ id, describedBy })}
							<input
								{id}
								name="startDate"
								type="date"
								class="input"
								aria-describedby={describedBy}
								value={data.membership.startDate ?? ''}
							/>
						{/snippet}
					</Field>
				</div>

				<SubmitButton pending={pending === 'employment'} pendingLabel="Saving...">
					Save details
				</SubmitButton>
			</form>
		</Card>
	</div>

	<!-- Role -->
	{#if data.canSetRole}
		<div class="mt-4">
			<Card title="Role" subtitle="Only the owner can change this">
				<form
					method="POST"
					action="?/setRole"
					class="flex flex-wrap items-end gap-2"
					use:enhance={enhanceFor('role')}
				>
					<div class="min-w-40">
						<label class="label" for="role-select">Role</label>
						<select id="role-select" name="role" class="input">
							<option value="employee" selected={data.membership.role === 'employee'}>
								Employee
							</option>
							<option value="manager" selected={data.membership.role === 'manager'}>
								Manager
							</option>
							<option value="owner" selected={data.membership.role === 'owner'}>Owner</option>
						</select>
					</div>
					<SubmitButton pending={pending === 'role'} variant="secondary" pendingLabel="Saving...">
						Update role
					</SubmitButton>
				</form>
				<p class="hint">
					Managers see everyone's attendance and approve requests. Owners can also change roles
					and pay.
				</p>
			</Card>
		</div>
	{/if}

	<!-- Pay -->
	{#if data.canSeePay}
		<div class="mt-4">
			<Card title="Pay rate" subtitle="Restricted to the owner">
				<form method="POST" action="?/setPayRate" use:enhance={enhanceFor('pay')}>
					<div class="grid gap-x-4 sm:grid-cols-2">
						<Field
							label="Hourly rate ({data.currency})"
							name="hourlyRate"
							error={form?.errors?.hourlyRate}
							required
						>
							{#snippet children({ id, describedBy, invalid })}
								<input
									{id}
									name="hourlyRate"
									class="input tnum"
									inputmode="decimal"
									placeholder="250.00"
									required
									aria-invalid={invalid}
									aria-describedby={describedBy}
								/>
							{/snippet}
						</Field>

						<Field
							label="Effective from"
							name="effectiveFrom"
							hint="Earlier shifts keep the rate that applied then."
							error={form?.errors?.effectiveFrom}
							required
						>
							{#snippet children({ id, describedBy, invalid })}
								<input
									{id}
									name="effectiveFrom"
									type="date"
									class="input"
									required
									value={data.defaultRateDate}
									aria-invalid={invalid}
									aria-describedby={describedBy}
								/>
							{/snippet}
						</Field>
					</div>

					<SubmitButton pending={pending === 'pay'} pendingLabel="Saving...">
						Set pay rate
					</SubmitButton>
				</form>

				{#if data.payRates && data.payRates.length > 0}
					<h3 class="mt-5 mb-2 text-sm font-semibold">Rate history</h3>
					<ul class="-my-1 divide-y" style="border-color: var(--border)">
						{#each data.payRates as rate (rate.id)}
							<li class="flex items-center justify-between gap-3 py-2">
								<span class="text-sm">
									{rate.effective_from} &ndash; {rate.effective_until ?? 'now'}
								</span>
								<span class="tnum text-sm font-semibold">
									{formatMoney(Math.round(Number(rate.hourly_rate) * 100), rate.currency_code)}
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="hint mt-3">No rate recorded yet, so no earnings estimate can be shown.</p>
				{/if}
			</Card>
		</div>
	{/if}

	<!-- Attendance -->
	<div class="mt-4">
		<Card title="Recent attendance" padded={false}>
			{#snippet actions()}
				<a
					href="/app/attendance?employee={data.membership.id}"
					class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
				>
					Full history
				</a>
			{/snippet}
			{#if data.shifts.length === 0}
				<p class="hint px-4 py-4 sm:px-5">No shifts recorded.</p>
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Day</th>
							<th scope="col">Start</th>
							<th scope="col">End</th>
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
								<td data-label="Payable" class="tnum font-semibold">
									{shift.payableMinutes !== null ? formatDuration(shift.payableMinutes) : '—'}
								</td>
								<td data-label="Status">
									{#if shift.status === 'active'}
										<span class="badge badge-ok">On shift</span>
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

	<!-- Tasks -->
	<div class="mt-4">
		<Card title="Tasks">
			{#snippet actions()}
				<button type="button" class="btn btn-primary !min-h-0 !px-3 !py-1.5 text-sm" onclick={() => (showTask = true)}>
					Assign a task
				</button>
			{/snippet}

			{#if data.tasks.length === 0}
				<p class="hint !mt-0">Nothing assigned to {data.membership.name} yet.</p>
			{:else}
				<ul class="-my-2 divide-y" style="border-color: var(--border)">
					{#each data.tasks as task (task.id)}
						<li class="flex flex-wrap items-center justify-between gap-3 py-2.5">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{task.title}</p>
								<div class="mt-1 flex flex-wrap gap-1.5">
									<span class="badge {priorityTone[task.priority] ?? 'badge-muted'}">
										{task.priority}
									</span>
									<span class="badge {statusTone[task.status] ?? 'badge-muted'}">
										{task.status.replace('_', ' ')}
									</span>
									{#if task.dueAt}
										<span class="badge badge-muted">Due {dayLabel(task.dueAt)}</span>
									{/if}
								</div>
							</div>

							{#if task.status !== 'completed' && task.status !== 'cancelled'}
								<form
									method="POST"
									action="?/updateTaskStatus"
									use:enhance={enhanceFor(task.id)}
								>
									<input type="hidden" name="taskId" value={task.id} />
									<input type="hidden" name="status" value="completed" />
									<button
										type="submit"
										class="btn btn-secondary !min-h-0 shrink-0 !px-3 !py-1.5 text-sm"
										disabled={pending === task.id}
									>
										Complete
									</button>
								</form>
							{:else}
								<form
									method="POST"
									action="?/updateTaskStatus"
									use:enhance={enhanceFor(task.id)}
								>
									<input type="hidden" name="taskId" value={task.id} />
									<input type="hidden" name="status" value="todo" />
									<button
										type="submit"
										class="btn btn-ghost !min-h-0 shrink-0 !px-3 !py-1.5 text-sm"
										disabled={pending === task.id}
									>
										Reopen
									</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</div>

	<!-- Notes -->
	<div class="mt-4">
		<Card title="Notes" subtitle="Only managers can see these">
			<form method="POST" action="?/addNote" use:enhance={enhanceFor('note')}>
				<label class="label" for="note-body">Add a note</label>
				<textarea
					id="note-body"
					name="body"
					class="input"
					rows="3"
					maxlength="4000"
					placeholder="Trained on the till. Asked about Fridays off from March."
					aria-invalid={Boolean(form?.errors?.body)}
				></textarea>
				{#if form?.errors?.body}
					<p class="hint" style="color: var(--danger)">{form.errors.body.join(' ')}</p>
				{:else}
					<p class="hint">
						{data.membership.name} cannot see these. Keep them factual &mdash; they are a
						record about a person.
					</p>
				{/if}
				<div class="mt-2">
					<SubmitButton pending={pending === 'note'} pendingLabel="Saving...">
						Add note
					</SubmitButton>
				</div>
			</form>

			{#if data.notes.length > 0}
				<ul class="mt-5 divide-y border-t" style="border-color: var(--border)">
					{#each data.notes as note (note.id)}
						<li class="flex items-start justify-between gap-3 py-3">
							<div class="min-w-0">
								<p class="text-sm whitespace-pre-line">{note.body}</p>
								<p class="hint !mt-1">
									{note.authorName} &middot; {dayLabel(note.createdAt)}
								</p>
							</div>
							<form
								method="POST"
								action="?/deleteNote"
								use:enhance={enhanceFor(note.id)}
							>
								<input type="hidden" name="noteId" value={note.id} />
								<button
									type="submit"
									class="btn btn-ghost !min-h-0 shrink-0 !px-2 !py-1 text-sm"
									style="color: var(--danger)"
									disabled={pending === note.id}
									aria-label="Delete note"
								>
									Delete
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</div>

	<!-- Time off -->
	<div class="mt-4">
		<Card title="Time off">
			{#if data.timeOff.length === 0}
				<p class="hint !mt-0">No requests.</p>
			{:else}
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.timeOff as request (request.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{request.leave_type}</p>
								<p class="hint !mt-0">
									{request.start_date}
									{#if request.end_date !== request.start_date}&ndash; {request.end_date}{/if}
								</p>
							</div>
							<span class="badge {statusTone[request.status]}">{request.status}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>
	</div>
</div>

<Modal bind:open={showTask} title="Assign a task to {data.membership.name}">
	<form
		method="POST"
		action="?/assignTask"
		id="assign-task-form"
		use:enhance={() => {
			pending = 'assign';
			return async ({ update }) => {
				await update();
				pending = '';
				showTask = false;
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
				<textarea {id} name="description" class="input" rows="3" maxlength="2000" aria-describedby={describedBy}
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

			<Field label="Due date" name="dueAt" hint="Optional." error={form?.errors?.dueAt}>
				{#snippet children({ id, describedBy })}
					<input {id} name="dueAt" type="date" class="input" aria-describedby={describedBy} />
				{/snippet}
			</Field>
		</div>
	</form>

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (showTask = false)}>Cancel</button>
		<SubmitButton pending={pending === 'assign'} form="assign-task-form" pendingLabel="Assigning...">
			Create and assign
		</SubmitButton>
	{/snippet}
</Modal>
