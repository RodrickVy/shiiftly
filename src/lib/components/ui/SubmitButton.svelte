<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A submit button that shows progress and disables itself while in flight,
	 * so a slow network cannot produce a double submission.
	 */
	let {
		pending = false,
		pendingLabel = 'Working...',
		variant = 'primary',
		size = '',
		fullWidth = false,
		disabled = false,
		formaction,
		form,
		name,
		value,
		children
	}: {
		pending?: boolean;
		pendingLabel?: string;
		variant?: 'primary' | 'secondary' | 'danger';
		size?: '' | 'btn-lg';
		fullWidth?: boolean;
		disabled?: boolean;
		formaction?: string;
		/** Id of the form to submit, when the button sits outside it. */
		form?: string;
		name?: string;
		value?: string;
		children: Snippet;
	} = $props();
</script>

<button
	type="submit"
	class="btn btn-{variant} {size} {fullWidth ? 'w-full' : ''}"
	{formaction}
	{form}
	{name}
	{value}
	disabled={pending || disabled}
	aria-busy={pending}
>
	{#if pending}
		<span
			class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
			aria-hidden="true"
		></span>
		{pendingLabel}
	{:else}
		{@render children()}
	{/if}
</button>
