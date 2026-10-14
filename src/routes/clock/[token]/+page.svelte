<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { formatDuration, formatTimer } from '$lib/domain/attendance';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state(false);
	let now = $state(Date.now());

	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});

	const elapsed = $derived(
		data.shift ? Math.floor((now - new Date(data.shift.startedAt).getTime()) / 1000) : 0
	);

	function clockTime(iso: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		}).format(new Date(iso));
	}
</script>

<svelte:head><title>Clock in or out — Shiftly</title></svelte:head>

<div class="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
	<main class="card w-full max-w-md px-5 py-6">
		{#if form?.success}
			<!-- Confirmed by the server, never optimistically -->
			<div class="text-center">
				<div
					class="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
					style="background: var(--ok-surface); color: var(--ok)"
				>
					<Icon name="check" size={34} />
				</div>
				<h1 class="mt-4 text-xl font-bold">
					{form.intent === 'clock_in' ? 'You are clocked in' : 'You are clocked out'}
				</h1>

				{#if form.intent === 'clock_in' && form.startedAt}
					<p class="hint">Shift started at {clockTime(form.startedAt)}.</p>
					<a href="/app/shift" class="btn btn-primary btn-lg mt-5 w-full">View my shift</a>
				{:else if form.endedAt}
					<p class="hint">Shift ended at {clockTime(form.endedAt)}.</p>
					{#if form.payableMinutes !== null}
						<p class="mt-3 text-2xl font-bold">{formatDuration(form.payableMinutes)}</p>
						<p class="hint !mt-0">payable time recorded</p>
					{/if}
					<a href="/app/home" class="btn btn-primary btn-lg mt-5 w-full">Done</a>
				{/if}
			</div>
		{:else if !data.valid}
			<div class="text-center">
				<div
					class="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
					style="background: var(--danger-surface); color: var(--danger)"
				>
					<Icon name="close" size={34} />
				</div>
				<h1 class="mt-4 text-xl font-bold">This code is not valid</h1>
				<p class="hint">
					Station codes change every day. Ask your manager to show today's code, then scan
					again.
				</p>
				<a href="/app" class="btn btn-secondary mt-5 w-full">Go to Shiftly</a>
			</div>
		{:else if data.notAMember}
			<div class="text-center">
				<h1 class="text-xl font-bold">You are not a member of {data.station?.organizationName}</h1>
				<p class="hint">
					Ask a manager there to send you an invitation link, then scan this code again.
				</p>
				<a href="/app" class="btn btn-secondary mt-5 w-full">Go to Shiftly</a>
			</div>
		{:else}
			<header class="text-center">
				<p class="hint !mt-0">{data.station?.organizationName}</p>
				<h1 class="text-lg font-semibold">{data.station?.name}</h1>
			</header>

			{#if form?.errors?._form}
				<div class="mt-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
			{/if}

			{#if data.action === null && data.shift?.onBreakSince}
				<div class="mt-4">
					<Alert tone="warn" title="You are on a break">
						End your break before clocking out.
					</Alert>
				</div>
				<a href="/app/shift" class="btn btn-primary btn-lg mt-4 w-full">Go to my shift</a>
			{:else if data.action === 'clock_out' && data.shift}
				<div class="mt-5 text-center">
					<p class="hint !mt-0">Working since {clockTime(data.shift.startedAt)}</p>
					<p class="tnum text-4xl font-bold">{formatTimer(elapsed)}</p>
				</div>

				<form
					method="POST"
					class="mt-6"
					use:enhance={() => {
						pending = true;
						return async ({ update }) => {
							await update();
							pending = false;
						};
					}}
				>
					<input type="hidden" name="intent" value="clock_out" />
					<input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
					<SubmitButton {pending} pendingLabel="Clocking out..." size="btn-lg" fullWidth>
						Clock out
					</SubmitButton>
				</form>
			{:else}
				<p class="mt-5 text-center" style="color: var(--text-muted)">
					Ready to start your shift?
				</p>

				<form
					method="POST"
					class="mt-4"
					use:enhance={() => {
						pending = true;
						return async ({ update }) => {
							await update();
							pending = false;
						};
					}}
				>
					<input type="hidden" name="intent" value="clock_in" />
					<input type="hidden" name="idempotencyKey" value={data.idempotencyKey} />
					<SubmitButton {pending} pendingLabel="Clocking in..." size="btn-lg" fullWidth>
						Clock in
					</SubmitButton>
				</form>
			{/if}

			<p class="hint mt-4 text-center">
				Your start and end times come from the server clock, not your phone.
			</p>
		{/if}
	</main>
</div>
