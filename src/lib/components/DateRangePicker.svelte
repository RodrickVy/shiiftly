<script lang="ts">
	/** A plain GET form, so a chosen range is shareable and bookmarkable. */
	import type { Snippet } from 'svelte';

	let {
		from,
		to,
		action = '',
		children
	}: { from: string; to: string; action?: string; children?: Snippet } = $props();
</script>

<form method="GET" {action} class="flex flex-wrap items-end gap-2">
	<div>
		<label class="label" for="range-from">From</label>
		<input id="range-from" name="from" type="date" class="input" value={from} max={to} />
	</div>
	<div>
		<label class="label" for="range-to">To</label>
		<input id="range-to" name="to" type="date" class="input" value={to} min={from} />
	</div>
	<button type="submit" class="btn btn-secondary">Apply</button>
	{#if children}{@render children()}{/if}
</form>
