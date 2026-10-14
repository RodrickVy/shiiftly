<script lang="ts">
	/**
	 * Dial code + national number.
	 *
	 * Two fields rather than one free-text box, because asking a person in
	 * Nairobi to type `+254712345678` when their phone says `0712 345 678` is
	 * a reliable way to lose them. The server joins and normalises the two
	 * (see normalizePhone), so what reaches the database is always E.164.
	 */
	import { DIAL_CODES, DEFAULT_DIAL } from '$lib/domain/phone';

	let {
		label = 'Phone number',
		hint,
		error,
		required = false,
		dial = DEFAULT_DIAL,
		value = '',
		name = 'phone'
	}: {
		label?: string;
		hint?: string;
		error?: string | string[] | null;
		required?: boolean;
		dial?: string;
		value?: string;
		name?: string;
	} = $props();

	const id = $derived(`${name}-number`);
	const dialId = $derived(`${name}-dial`);

	const messages = $derived(error == null ? [] : Array.isArray(error) ? error : [error]);
	const invalid = $derived(messages.length > 0);
	const hintId = $derived(hint ? `${id}-hint` : undefined);
	const errorId = $derived(invalid ? `${id}-error` : undefined);
	const describedBy = $derived([hintId, errorId].filter(Boolean).join(' ') || undefined);
</script>

<div class="mb-4">
	<label class="label" for={id}>
		{label}
		{#if required}<span style="color: var(--danger)" aria-hidden="true">*</span>{/if}
	</label>

	<div class="flex gap-2">
		<select
			id={dialId}
			name="phoneDial"
			class="input w-auto shrink-0"
			aria-label="Country dialling code"
			value={dial}
		>
			{#each DIAL_CODES as code (code.country)}
				<option value={code.dial}>{code.country} {code.dial}</option>
			{/each}
		</select>

		<input
			{id}
			name="phoneNumber"
			type="tel"
			class="input"
			inputmode="tel"
			autocomplete="tel-national"
			placeholder="0712 345 678"
			{required}
			aria-invalid={invalid}
			aria-describedby={describedBy}
			{value}
		/>
	</div>

	{#if hint && !invalid}<p class="hint" id={hintId}>{hint}</p>{/if}
	{#if invalid}
		<p class="hint" id={errorId} style="color: var(--danger)">{messages.join(' ')}</p>
	{/if}
</div>
