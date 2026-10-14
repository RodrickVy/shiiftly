<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		tone = 'info',
		title,
		children
	}: { tone?: 'info' | 'ok' | 'warn' | 'danger'; title?: string; children?: Snippet } = $props();

	const surface = $derived(`var(--${tone === 'info' ? 'info' : tone}-surface)`);
	const color = $derived(`var(--${tone === 'info' ? 'info' : tone})`);
	const icon = $derived(
		tone === 'ok' ? '✓' : tone === 'danger' ? '✕' : tone === 'warn' ? '!' : 'i'
	);
</script>

<div
	class="flex gap-3 rounded-xl px-4 py-3 text-sm"
	style="background: {surface}; color: {color}"
	role={tone === 'danger' ? 'alert' : 'status'}
>
	<span
		class="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
		style="background: {color}; color: var(--surface)"
		aria-hidden="true">{icon}</span
	>
	<div class="min-w-0">
		{#if title}<p class="font-semibold">{title}</p>{/if}
		{#if children}<div class={title ? 'mt-0.5' : ''}>{@render children()}</div>{/if}
	</div>
</div>
