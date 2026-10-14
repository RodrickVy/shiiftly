<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle,
		actions,
		padded = true,
		children
	}: {
		title?: string;
		subtitle?: string;
		actions?: Snippet;
		padded?: boolean;
		children: Snippet;
	} = $props();
</script>

<section class="card">
	{#if title || actions}
		<header
			class="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 sm:px-5"
			style="border-color: var(--border)"
		>
			<div class="min-w-0">
				{#if title}<h2 class="text-base font-semibold">{title}</h2>{/if}
				{#if subtitle}<p class="hint !mt-0.5">{subtitle}</p>{/if}
			</div>
			{#if actions}<div class="flex shrink-0 flex-wrap gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class={padded ? 'px-4 py-4 sm:px-5' : ''}>
		{@render children()}
	</div>
</section>
