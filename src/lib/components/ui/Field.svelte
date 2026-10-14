<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		name,
		hint,
		error,
		required = false,
		children
	}: {
		label: string;
		name: string;
		hint?: string;
		error?: string | string[] | null;
		required?: boolean;
		children: Snippet<[{ id: string; describedBy: string | undefined; invalid: boolean }]>;
	} = $props();

	const id = $derived(`f-${name}`);
	const messages = $derived(
		error == null ? [] : Array.isArray(error) ? error : [error]
	);
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
	{@render children({ id, describedBy, invalid })}
	{#if hint && !invalid}<p class="hint" id={hintId}>{hint}</p>{/if}
	{#if invalid}
		<p class="hint" id={errorId} style="color: var(--danger)">{messages.join(' ')}</p>
	{/if}
</div>
