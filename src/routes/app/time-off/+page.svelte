<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { inclusiveDayCount } from '$lib/domain/time';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state(false);
	let deciding = $state<null | { request: (typeof data.requests)[number]; decision: 'approved' | 'rejected' }>(
		null
	);

	const statusTone: Record<string, string> = {
		pending: 'badge-warn',
		approved: 'badge-ok',
		rejected: 'badge-danger',
		cancelled: 'badge-muted'
	};

	const tabs = [
		{ value: 'pending', label: 'Pending' },
		{ value: 'approved', label: 'Approved' },
		{ value: 'rejected', label: 'Rejected' },
		{ value: 'all', label: 'All' }
	];

	const plural = (n: number) => (n === 1 ? 'day' : 'days');
</script>

<svelte:head><title>Time off — Shiftly</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">Time off</h1>
		<p class="hint">
			{data.pendingCount} request{data.pendingCount === 1 ? '' : 's'} waiting for a decision
		</p>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.reviewed}
		<div class="mb-4">
			<Alert tone="ok">
				Request {form.reviewed}. The employee has been notified.
			</Alert>
		</div>
	{/if}

	<div class="mb-4 flex flex-wrap gap-2">
		{#each tabs as tab (tab.value)}
			<a
				href="/app/time-off?status={tab.value}"
				class="btn {data.statusFilter === tab.value ? 'btn-primary' : 'btn-secondary'}"
			>
				{tab.label}
			</a>
		{/each}
	</div>

	<Card padded={false}>
		{#if data.requests.length === 0}
			<EmptyState
				title="Nothing here"
				description={data.statusFilter === 'pending'
					? 'No requests are waiting for a decision.'
					: 'No requests match this filter.'}
			/>
		{:else}
			<ul class="divide-y" style="border-color: var(--border)">
				{#each data.requests as request (request.id)}
					{@const days = inclusiveDayCount(request.startDate, request.endDate)}
					<li class="px-4 py-3 sm:px-5">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<a
									href="/app/employees/{request.membershipId}"
									class="font-medium no-underline"
									style="color: var(--text)">{request.name}</a
								>
								<p class="hint !mt-0">
									{request.leaveType} &middot; {request.startDate}
									{#if request.endDate !== request.startDate}&ndash; {request.endDate}{/if}
									&middot; {days}
									{plural(days)}
								</p>
								{#if request.reason}
									<p class="hint">{request.reason}</p>
								{/if}
								{#if request.managerComment}
									<p class="hint"><strong>Comment:</strong> {request.managerComment}</p>
								{/if}
							</div>

							<div class="flex shrink-0 flex-wrap items-center gap-2">
								<span class="badge {statusTone[request.status]}">{request.status}</span>

								{#if request.status === 'pending'}
									{#if request.isOwnRequest && !data.isOwner}
										<span class="hint !mt-0">Your own request</span>
									{:else}
										<button
											type="button"
											class="btn btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
											onclick={() => (deciding = { request, decision: 'rejected' })}
										>
											Reject
										</button>
										<button
											type="button"
											class="btn btn-primary !min-h-0 !px-3 !py-1.5 text-sm"
											onclick={() => (deciding = { request, decision: 'approved' })}
										>
											Approve
										</button>
									{/if}
								{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>

	<p class="hint mt-3">
		Leave balances and statutory entitlements are not tracked in this version.
	</p>
</div>

<Modal
	open={deciding !== null}
	title={deciding?.decision === 'approved' ? 'Approve request' : 'Reject request'}
	onclose={() => (deciding = null)}
>
	{#if deciding}
		<form
			method="POST"
			action="?/review"
			id="review-form"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update();
					pending = false;
					deciding = null;
				};
			}}
		>
			<input type="hidden" name="requestId" value={deciding.request.id} />
			<input type="hidden" name="decision" value={deciding.decision} />

			<p class="!mt-0 mb-4 text-sm">
				{deciding.request.name} &middot; {deciding.request.leaveType} &middot;
				{deciding.request.startDate}
				{#if deciding.request.endDate !== deciding.request.startDate}
					&ndash; {deciding.request.endDate}
				{/if}
			</p>

			<label class="label" for="comment">Comment</label>
			<textarea
				id="comment"
				name="comment"
				class="input"
				rows="3"
				maxlength="1000"
				placeholder={deciding.decision === 'approved'
					? 'Optional note for the employee'
					: 'Explain why, so they know what to do next'}
			></textarea>
			<p class="hint">The employee sees this with the decision.</p>
		</form>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-secondary" onclick={() => (deciding = null)}>
			Cancel
		</button>
		<SubmitButton
			{pending}
			form="review-form"
			variant={deciding?.decision === 'approved' ? 'primary' : 'danger'}
			pendingLabel="Saving..."
		>
			{deciding?.decision === 'approved' ? 'Approve' : 'Reject'}
		</SubmitButton>
	{/snippet}
</Modal>
