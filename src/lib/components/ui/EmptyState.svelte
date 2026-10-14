<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		children
	}: { title: string; description?: string; children?: Snippet } = $props();
</script>

<div class="px-4 py-10 text-center">
	<p class="font-medium">{title}</p>
	{#if description}<p class="hint mx-auto mt-1 max-w-sm">{description}</p>{/if}
	{#if children}<div class="mt-4 flex justify-center gap-2">{@render children()}</div>{/if}
</div>
