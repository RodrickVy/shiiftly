<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle,
		children,
		footer
	}: { title: string; subtitle?: string; children: Snippet; footer?: Snippet } = $props();
</script>

<div class="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
	<a href="/" class="mb-6 flex items-center gap-2 font-semibold no-underline" style="color: var(--text)">
		<img src="/icon.svg" alt="" width="30" height="30" />
		Shiftly
	</a>

	<main class="card w-full max-w-md px-5 py-6 sm:px-7">
		<h1 class="text-xl font-semibold">{title}</h1>
		{#if subtitle}<p class="hint">{subtitle}</p>{/if}
		<div class="mt-5">
			{@render children()}
		</div>
	</main>

	{#if footer}
		<div class="mt-5 text-center text-sm" style="color: var(--text-muted)">
			{@render footer()}
		</div>
	{/if}
</div>
