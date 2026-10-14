<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Field from '$lib/components/ui/Field.svelte';
	import SubmitButton from '$lib/components/ui/SubmitButton.svelte';
	import { WEEKDAYS } from '$lib/data/locales';
	import { formatDuration } from '$lib/domain/attendance';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let pending = $state('');
	// Seeded from the saved policy; the controls own it afterwards.
	let breakMode = $state<'none' | 'automatic' | 'manual'>(
		untrack(() => data.settings.break_mode)
	);
	let automaticMinutes = $state(untrack(() => data.settings.automatic_break_minutes));
	let thresholdMinutes = $state(
		untrack(() => data.settings.automatic_break_threshold_minutes)
	);

	const enhanceFor = (key: string) => () => {
		pending = key;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			pending = '';
		};
	};

	// Initial checkbox states, read once; the form owns them after that.
	const toggles = untrack(() => [
		{
			name: 'qrClockingEnabled',
			label: 'QR clock-in',
			hint: 'Staff scan a station code with their phone.',
			value: data.settings.qr_clocking_enabled
		},
		{
			name: 'directClockingEnabled',
			label: 'Clock in from the app',
			hint: 'A button in Shiftly, without scanning. Convenient, but no station check.',
			value: data.settings.direct_clocking_enabled
		},
		{
			name: 'timesheetApprovalRequired',
			label: 'Require timesheet approval',
			hint: 'Hours must be signed off before they count as approved.',
			value: data.settings.timesheet_approval_required
		},
		{
			name: 'allowManagerCorrections',
			label: 'Allow attendance corrections',
			hint: 'Managers can fix a forgotten clock-out. Every change is logged.',
			value: data.settings.allow_manager_corrections
		},
		{
			name: 'employeeEarningsVisible',
			label: 'Show earnings to employees',
			hint: 'Each person sees their own estimate only.',
			value: data.settings.employee_earnings_visible
		},
		{
			name: 'notifyManagersOnTimeOff',
			label: 'Email managers about leave requests',
			hint: 'A notification is always created in the app.',
			value: data.settings.notify_managers_on_time_off
		},
		{
			name: 'notifyEmployeeOnDecision',
			label: 'Email employees about decisions',
			hint: 'Approvals and rejections.',
			value: data.settings.notify_employee_on_decision
		}
	]);

	const modes = [
		{ value: 'none' as const, title: 'No break tracking', body: 'Payable time is the whole shift.' },
		{
			value: 'automatic' as const,
			title: 'Automatic deduction',
			body: 'Subtract a fixed unpaid break from long enough shifts.'
		},
		{
			value: 'manual' as const,
			title: 'Staff record breaks',
			body: 'Start and end break buttons, measured by the server.'
		}
	];

	const example = $derived(
		breakMode === 'automatic'
			? `An 8 hour shift becomes ${formatDuration(Math.max(480 - automaticMinutes, 0))} payable${
					480 >= thresholdMinutes ? '' : ' (below the threshold, so nothing is deducted)'
				}.`
			: ''
	);
</script>

<svelte:head><title>Settings — Shiftly</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-5">
	<header class="mb-4">
		<h1 class="text-xl font-bold">Settings</h1>
		<p class="hint">{data.organization.name}</p>
	</header>

	{#if form?.errors?._form}
		<div class="mb-4"><Alert tone="danger">{form.errors._form.join(' ')}</Alert></div>
	{/if}
	{#if form?.settingsSaved}
		<div class="mb-4">
			<Alert tone="ok" title="Settings saved">
				Changes apply from now on. Shifts already completed keep the figures recorded at the
				time.
			</Alert>
		</div>
	{/if}
	{#if form?.profileSaved}
		<div class="mb-4"><Alert tone="ok">Organization details saved.</Alert></div>
	{/if}

	<!-- Attendance and breaks -->
	<Card title="Attendance and breaks">
		<form method="POST" action="?/updateSettings" use:enhance={enhanceFor('settings')}>
			<fieldset class="mb-5">
				<legend class="label">Break policy</legend>
				<div class="grid gap-2">
					{#each modes as mode (mode.value)}
						<label
							class="flex cursor-pointer gap-3 rounded-xl border px-4 py-3"
							style="border-color: {breakMode === mode.value
								? 'var(--color-brand-500)'
								: 'var(--border)'}; background: {breakMode === mode.value
								? 'var(--info-surface)'
								: 'transparent'}"
						>
							<input
								type="radio"
								name="breakMode"
								value={mode.value}
								bind:group={breakMode}
								class="mt-1 h-4 w-4 shrink-0"
							/>
							<span class="min-w-0">
								<span class="block font-medium">{mode.title}</span>
								<span class="hint !mt-0.5 block">{mode.body}</span>
							</span>
						</label>
					{/each}
				</div>
			</fieldset>

			{#if breakMode === 'automatic'}
				<div class="grid gap-x-4 sm:grid-cols-2">
					<Field
						label="Unpaid break (minutes)"
						name="automaticBreakMinutes"
						error={form?.errors?.automaticBreakMinutes}
					>
						{#snippet children({ id, describedBy })}
							<input
								{id}
								name="automaticBreakMinutes"
								type="number"
								min="0"
								max="480"
								class="input"
								bind:value={automaticMinutes}
								aria-describedby={describedBy}
							/>
						{/snippet}
					</Field>

					<Field
						label="Applies from (minutes worked)"
						name="automaticBreakThresholdMinutes"
						error={form?.errors?.automaticBreakThresholdMinutes}
					>
						{#snippet children({ id, describedBy })}
							<input
								{id}
								name="automaticBreakThresholdMinutes"
								type="number"
								min="0"
								max="1440"
								class="input"
								bind:value={thresholdMinutes}
								aria-describedby={describedBy}
							/>
						{/snippet}
					</Field>
				</div>
				{#if example}<p class="hint !mt-0 mb-4">{example}</p>{/if}
			{:else}
				<input type="hidden" name="automaticBreakMinutes" value={automaticMinutes} />
				<input type="hidden" name="automaticBreakThresholdMinutes" value={thresholdMinutes} />
			{/if}

			<hr class="my-5" style="border-color: var(--border)" />

			<div class="grid gap-3">
				{#each toggles as toggle (toggle.name)}
					<label class="flex cursor-pointer items-start gap-3">
						<input
							type="checkbox"
							name={toggle.name}
							value="on"
							checked={toggle.value}
							class="mt-1 h-4 w-4 shrink-0"
						/>
						<span class="min-w-0">
							<span class="block text-sm font-medium">{toggle.label}</span>
							<span class="hint !mt-0 block">{toggle.hint}</span>
						</span>
					</label>
				{/each}
			</div>

			{#if !data.emailConfigured}
				<div class="mt-4">
					<Alert tone="info">
						No email provider is configured on this deployment, so email notifications will not
						be delivered. In-app notifications still work.
					</Alert>
				</div>
			{/if}

			<div class="mt-5">
				<SubmitButton pending={pending === 'settings'} pendingLabel="Saving...">
					Save settings
				</SubmitButton>
			</div>
		</form>
	</Card>

	<!-- Organization profile -->
	<div class="mt-4">
		<Card
			title="Organization details"
			subtitle={data.isOwner ? undefined : 'Only the owner can change these'}
		>
			{#if data.isOwner}
				<form method="POST" action="?/updateProfile" use:enhance={enhanceFor('profile')}>
					<Field label="Name" name="name" error={form?.errors?.name} required>
						{#snippet children({ id, describedBy })}
							<input
								{id}
								name="name"
								class="input"
								required
								maxlength="120"
								value={data.organization.name}
								aria-describedby={describedBy}
							/>
						{/snippet}
					</Field>

					<Field label="Industry" name="industry" error={form?.errors?.industry}>
						{#snippet children({ id, describedBy })}
							<select {id} name="industry" class="input" aria-describedby={describedBy}>
								<option value="">Not set</option>
								{#each data.industries as industry (industry)}
									<option value={industry} selected={data.organization.industry === industry}>
										{industry}
									</option>
								{/each}
							</select>
						{/snippet}
					</Field>

					<Field label="Country" name="countryCode" error={form?.errors?.countryCode} required>
						{#snippet children({ id, describedBy })}
							<select {id} name="countryCode" class="input" aria-describedby={describedBy}>
								{#each data.countries as country (country.code)}
									<option
										value={country.code}
										selected={data.organization.country_code === country.code}
									>
										{country.name}
									</option>
								{/each}
							</select>
						{/snippet}
					</Field>

					<div class="grid gap-x-4 sm:grid-cols-2">
						<Field
							label="Timezone"
							name="timezone"
							hint="Changing this changes which day shifts belong to."
							error={form?.errors?.timezone}
							required
						>
							{#snippet children({ id, describedBy })}
								<select {id} name="timezone" class="input" aria-describedby={describedBy}>
									{#each data.timezones as tz (tz)}
										<option value={tz} selected={data.organization.timezone === tz}>
											{tz.replace(/_/g, ' ')}
										</option>
									{/each}
								</select>
							{/snippet}
						</Field>

						<Field
							label="Currency"
							name="currencyCode"
							error={form?.errors?.currencyCode}
							required
						>
							{#snippet children({ id, describedBy })}
								<select {id} name="currencyCode" class="input" aria-describedby={describedBy}>
									{#each data.currencies as currency (currency)}
										<option
											value={currency}
											selected={data.organization.currency_code === currency}
										>
											{currency}
										</option>
									{/each}
								</select>
							{/snippet}
						</Field>
					</div>

					<Field label="Week starts on" name="weekStartsOn" error={form?.errors?.weekStartsOn}>
						{#snippet children({ id, describedBy })}
							<select {id} name="weekStartsOn" class="input" aria-describedby={describedBy}>
								{#each WEEKDAYS as day (day.value)}
									<option
										value={day.value}
										selected={data.organization.week_starts_on === day.value}
									>
										{day.label}
									</option>
								{/each}
							</select>
						{/snippet}
					</Field>

					<SubmitButton pending={pending === 'profile'} pendingLabel="Saving...">
						Save details
					</SubmitButton>
				</form>
			{:else}
				<dl class="grid grid-cols-2 gap-3 text-sm">
					<div>
						<dt class="hint !mt-0">Timezone</dt>
						<dd class="font-medium">{data.organization.timezone}</dd>
					</div>
					<div>
						<dt class="hint !mt-0">Currency</dt>
						<dd class="font-medium">{data.organization.currency_code}</dd>
					</div>
				</dl>
			{/if}
		</Card>
	</div>

	<div class="mt-4">
		<Card title="Clocking stations">
			<p class="hint !mt-0">
				Stations are managed on the station screen, where you can also display the QR code
				fullscreen.
			</p>
			<a href="/app/station" class="btn btn-secondary mt-3">Open stations</a>
		</Card>
	</div>
</div>
