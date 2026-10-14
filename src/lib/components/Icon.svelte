<script lang="ts">
	import { ICON_PATHS, type IconName } from './icons';

	let {
		name,
		size = 20,
		label
	}: { name: IconName; size?: number; label?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : 'presentation'}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	class="shrink-0"
>
	<path d={ICON_PATHS[name]} />
</svg>
