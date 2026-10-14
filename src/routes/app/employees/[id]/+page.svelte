<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import { formatMoney } from '$lib/domain/earnings';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state('');

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

	<!-- Tasks and time off -->
	<div class="mt-4 grid gap-4 lg:grid-cols-2">
		<Card title="Assigned tasks">
			{#if data.tasks.length === 0}
				<p class="hint !mt-0">No tasks assigned.</p>
			{:else}
				<ul class="-my-1 divide-y" style="border-color: var(--border)">
					{#each data.tasks as task (task.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="min-w-0 truncate text-sm">{task.title}</span>
							<span class="badge {statusTone[task.status] ?? 'badge-muted'}">
								{task.status.replace('_', ' ')}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

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
