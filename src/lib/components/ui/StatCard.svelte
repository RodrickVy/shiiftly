<script lang="ts">
	let {
		label,
		value,
		hint,
		tone = 'default',
		href
	}: {
		label: string;
		value: string | number;
		hint?: string;
		tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info';
		href?: string;
	} = $props();

	const color = $derived(tone === 'default' ? 'var(--text)' : `var(--${tone})`);
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	{href}
	class="card block px-4 py-3 no-underline {href ? 'transition-colors hover:bg-[var(--surface-muted)]' : ''}"
>
	<p class="hint !mt-0 truncate">{label}</p>
	<p class="tnum mt-1 text-2xl font-semibold" style="color: {color}">{value}</p>
	{#if hint}<p class="hint truncate">{hint}</p>{/if}
</svelte:element>
