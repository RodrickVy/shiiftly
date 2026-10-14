<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { LEAVE_TYPES } from '$lib/schemas';
	import { inclusiveDayCount } from '$lib/domain/time';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let showRequest = $state(false);
	let pending = $state(false);
	let startDate = $state('');
	let endDate = $state('');

	// Keep the end date from falling behind the start date.
	$effect(() => {
		if (startDate && (!endDate || endDate < startDate)) endDate = startDate;
	});

	const dayCount = $derived(
		startDate && endDate && endDate >= startDate ? inclusiveDayCount(startDate, endDate) : 0
	);

	const statusTone: Record<string, string> = {
		pending: 'badge-warn',
		approved: 'badge-ok',
		rejected: 'badge-danger',
		cancelled: 'badge-muted'
	};

	const plural = (n: number) => (n === 1 ? 'day' : 'days');
</script>

<svelte:head><title>My time off — Shiftly</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-5">
	<header class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold">My time off</h1>
			<p class="hint">Request leave and track its status.</p>
		</div>
		<button type="button" class="btn btn-primary" onclick={() => (showRequest = true)}>
			<Icon name="plus" size={18} />
			Request time off
		</button>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.success}
		<div class="mb-4">
			<Alert tone="ok" title="Request submitted">
				Your managers have been notified. The decision will appear here.
			</Alert>
		</div>
	{/if}
	{#if form?.cancelled}
		<div class="mb-4"><Alert tone="ok">That request has been cancelled.</Alert></div>
	{/if}

	<Card padded={false}>
		{#if data.requests.length === 0}
			<EmptyState title="No requests yet" description="Ask for leave without a phone call.">
				<button type="button" class="btn btn-primary" onclick={() => (showRequest = true)}>
					Request time off
				</button>
			</EmptyState>
		{:else}
			<ul class="divide-y" style="border-color: var(--border)">
				{#each data.requests as request (request.id)}
					{@const days = inclusiveDayCount(request.start_date, request.end_date)}
					<li class="px-4 py-3 sm:px-5">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-medium">{request.leave_type}</p>
								<p class="hint !mt-0">
									{request.start_date}
									{#if request.end_date !== request.start_date}&ndash; {request.end_date}{/if}
									&middot; {days}
									{plural(days)}
								</p>
								{#if request.reason}
									<p class="hint">{request.reason}</p>
								{/if}
								{#if request.manager_comment}
									<p class="hint">
										<strong>Manager:</strong>
										{request.manager_comment}
									</p>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-2">
								<span class="badge {statusTone[request.status]}">{request.status}</span>
								{#if request.status === 'pending'}
									<form
										method="POST"
										action="?/cancel"
										use:enhance={() => {
											pending = true;
											return async ({ update }) => {
												await update();
												pending = false;
											};
										}}
									>
										<input type="hidden" name="requestId" value={request.id} />
										<button
											type="submit"
											class="btn btn-ghost !min-h-0 !px-2 !py-1 text-sm"
											disabled={pending}
										>
											Cancel
										</button>
									</form>
								{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<p class="hint mt-3">
		Changing an approved request needs a manager. Cancel and submit a new one, or speak to them.
	</p>
</div>

<Modal bind:open={showRequest} title="Request time off">
	<form
		method="POST"
		action="?/create"
		id="time-off-form"
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update();
				pending = false;
				showRequest = false;
			};
		}}
	>
		<Field label="Leave type" name="leaveType" error={form?.errors?.leaveType} required>
			{#snippet children({ id, describedBy })}
				<select {id} name="leaveType" class="input" aria-describedby={describedBy}>
					{#each LEAVE_TYPES as type (type)}
						<option value={type}>{type}</option>
					{/each}
				</select>
			{/snippet}
		</Field>

		<div class="grid gap-x-4 sm:grid-cols-2">
			<Field label="First day" name="startDate" error={form?.errors?.startDate} required>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="startDate"
						type="date"
						class="input"
						required
						bind:value={startDate}
						aria-invalid={invalid}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>

			<Field label="Last day" name="endDate" error={form?.errors?.endDate} required>
				{#snippet children({ id, describedBy, invalid })}
					<input
						{id}
						name="endDate"
						type="date"
						class="input"
						required
						min={startDate}
						bind:value={endDate}
						aria-invalid={invalid}
						aria-describedby={describedBy}
					/>
				{/snippet}
			</Field>
		</div>

		{#if dayCount > 0}
			<p class="hint !mt-0 mb-4">{dayCount} {plural(dayCount)} requested.</p>
		{/if}

		<Field label="Reason" name="reason" hint="Optional." error={form?.errors?.reason}>
			{#snippet children({ id, describedBy })}
				<textarea
					{id}
					name="reason"
					class="input"
					rows="3"
					maxlength="1000"
					aria-describedby={describedBy}
				></textarea>
			{/snippet}
		</Field>
	</form>

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (showRequest = false)}>
			Cancel
		</button>
		<SubmitButton {pending} form="time-off-form" pendingLabel="Submitting...">
			Submit request
		</SubmitButton>
	{/snippet}
</Modal>
