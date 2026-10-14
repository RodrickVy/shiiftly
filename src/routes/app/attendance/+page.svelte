<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { formatDuration } from '$lib/domain/attendance';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state(false);
	let correcting = $state<null | (typeof data.rows)[number]>(null);

	const exportHref = $derived(`/app/attendance/export?${page.url.searchParams.toString()}`);

	function dayLabel(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(iso));
	}

	function clockTime(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			timeZone: data.timezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}

	/** An instant rendered as the organization's wall time, for the form. */
	function toLocalInput(iso: string | null): string {
		if (!iso) return '';
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: data.timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).formatToParts(new Date(iso));
		const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
		return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
	}
</script>

<svelte:head><title>Attendance — Shiftly</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">Attendance</h1>
			<p class="hint">Times are shown in {data.timezone.replace(/_/g, ' ')}.</p>
		</div>
		<a href={exportHref} class="btn btn-secondary" data-sveltekit-reload>
			<Icon name="download" size={18} />
			Export CSV
		</a>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.corrected}
		<div class="mb-4">
			<Alert tone="ok" title="Correction recorded">
				The original clock events are kept, and the change is in the audit log.
			</Alert>
		</div>
	{/if}

	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2">
		<div>
			<label class="label" for="from">From</label>
			<input id="from" name="from" type="date" class="input" value={data.from} max={data.to} />
		</div>
		<div>
			<label class="label" for="to">To</label>
			<input id="to" name="to" type="date" class="input" value={data.to} min={data.from} />
		</div>
		<div class="min-w-40">
			<label class="label" for="employee">Employee</label>
			<select id="employee" name="employee" class="input">
				<option value="all">Everyone</option>
				{#each data.employees as employee (employee.id)}
					<option value={employee.id} selected={data.filters.employee === employee.id}>
						{employee.name}
					</option>
				{/each}
			</select>
		</div>
		<div>
			<label class="label" for="status">Status</label>
			<select id="status" name="status" class="input">
				<option value="all" selected={data.filters.status === 'all'}>All</option>
				<option value="active" selected={data.filters.status === 'active'}>On shift</option>
				<option value="completed" selected={data.filters.status === 'completed'}>Completed</option>
				<option value="incomplete" selected={data.filters.status === 'incomplete'}>
					Needs review
				</option>
			</select>
		</div>
		<button type="submit" class="btn btn-secondary">Apply</button>
	</form>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<StatCard label="Completed shifts" value={data.totals.shifts} />
		<StatCard label="Gross" value={formatDuration(data.totals.grossMinutes)} />
		<StatCard label="Unpaid breaks" value={formatDuration(data.totals.breakMinutes)} />
		<StatCard label="Payable" value={formatDuration(data.totals.payableMinutes)} tone="ok" />
	</div>

	{#if data.totals.incomplete > 0}
		<div class="mt-4">
			<Alert tone="warn" title="{data.totals.incomplete} shift(s) need review">
				A shift with no clock-out usually means someone forgot. Correct it so their hours are
				right.
			</Alert>
		</div>
	{/if}

	<div class="mt-4">
		<Card padded={false}>
			{#if data.rows.length === 0}
				<EmptyState title="No attendance in this range" description="Try a wider date range." />
			{:else}
				<table class="data-table">
					<thead>
						<tr>
							<th scope="col">Employee</th>
							<th scope="col">Day</th>
							<th scope="col">Start</th>
							<th scope="col">End</th>
							<th scope="col">Gross</th>
							<th scope="col">Break</th>
							<th scope="col">Payable</th>
							<th scope="col">Method</th>
							<th scope="col">Status</th>
							<th scope="col"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as row (row.id)}
							<tr>
								<td data-label="Employee">
									<a
										href="/app/employees/{row.membershipId}"
										class="font-medium no-underline"
										style="color: var(--text)">{row.name}</a
									>
								</td>
								<td data-label="Day">{dayLabel(row.startedAt)}</td>
								<td data-label="Start" class="tnum">{clockTime(row.startedAt)}</td>
								<td data-label="End" class="tnum">
									{row.endedAt ? clockTime(row.endedAt) : '—'}
								</td>
								<td data-label="Gross" class="tnum">
									{row.grossMinutes !== null ? formatDuration(row.grossMinutes) : '—'}
								</td>
								<td data-label="Break" class="tnum">
									{row.unpaidBreakMinutes ? formatDuration(row.unpaidBreakMinutes) : '—'}
								</td>
								<td data-label="Payable" class="tnum font-semibold">
									{row.payableMinutes !== null ? formatDuration(row.payableMinutes) : '—'}
								</td>
								<td data-label="Method">
									<span class="hint !mt-0">
										{row.clockInMethod}{row.stationName ? ` · ${row.stationName}` : ''}
									</span>
								</td>
								<td data-label="Status">
									{#if row.incomplete}
										<span class="badge badge-warn">Needs review</span>
									{:else if row.status === 'active'}
										<span class="badge badge-ok">On shift</span>
									{:else}
										<span class="badge badge-muted">Complete</span>
									{/if}
								</td>
								<td data-label="">
									{#if data.allowCorrections && row.status !== 'active'}
										<button
											type="button"
											class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
											onclick={() => (correcting = row)}
										>
											Correct
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</Card>
	</div>

	{#if !data.allowCorrections}
		<p class="hint mt-3">
			Attendance corrections are switched off. Enable them in
			<a href="/app/settings" style="color: var(--color-brand-600)">Settings</a>.
		</p>
	{/if}
</div>

<Modal
	open={correcting !== null}
	title="Correct attendance"
	onclose={() => (correcting = null)}
>
	{#if correcting}
		{@const shift = correcting}
		<form
			method="POST"
			action="?/correct"
			id="correct-form"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update();
					pending = false;
					correcting = null;
				};
			}}
		>
			<input type="hidden" name="shiftId" value={shift.id} />

			<p class="hint !mt-0 mb-4">
				Correcting <strong>{shift.name}</strong>&rsquo;s shift on
				{dayLabel(shift.startedAt)}. The original clock events are kept; this records an
				auditable adjustment.
			</p>

			<Field label="Start time" name="startedAt" error={form?.errors?.startedAt} required>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="startedAt"
						type="datetime-local"
						class="input"
						required
						value={toLocalInput(shift.startedAt)}
						aria-invalid={invalid}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<Field
				label="End time"
				name="endedAt"
				hint="Leave blank to reopen the shift."
				error={form?.errors?.endedAt}
			>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="endedAt"
						type="datetime-local"
						class="input"
						value={toLocalInput(shift.endedAt)}
						aria-invalid={invalid}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<Field
				label="Reason"
				name="reason"
				hint="Recorded in the audit log."
				error={form?.errors?.reason}
				required
			>
				{#snippet children({ id, describedBy, invalid })}
					<textarea
						{id}
						name="reason"
						class="input"
						rows="2"
						required
						minlength="3"
						maxlength="1000"
						placeholder="Forgot to clock out at the end of the shift"
						aria-invalid={invalid}
						aria-describedby={describedBy}
					></textarea>
				{/snippet}
			</Field>
		</form>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (correcting = null)}>
			Cancel
		</button>
		<SubmitButton {pending} form="correct-form" pendingLabel="Saving...">
			Save correction
		</SubmitButton>
	{/snippet}
</Modal>
