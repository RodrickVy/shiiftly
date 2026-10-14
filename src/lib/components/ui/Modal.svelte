<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A native <dialog>, so focus trapping, Escape and the backdrop come from
	 * the platform rather than being reimplemented.
	 *
	 * `open` can be bound for a simple boolean toggle, or driven by a parent
	 * that derives it from other state — in which case pass `onclose` so the
	 * parent can clear that state when the dialog dismisses itself.
	 */
	let {
		open = $bindable(false),
		title,
		onclose,
		children,
		footer
	}: {
		open: boolean;
		title: string;
		onclose?: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	let dialog = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	function handleClose() {
		open = false;
		onclose?.();
	}
</script>

<dialog
	bind:this={dialog}
	onclose={handleClose}
	class="w-[min(32rem,calc(100vw-2rem))] rounded-xl border p-0 backdrop:bg-black/40"
	style="background: var(--surface); color: var(--text); border-color: var(--border)"
	aria-label={title}
>
	{#if open}
		<div
			class="flex items-start justify-between gap-3 border-b px-5 py-3"
			style="border-color: var(--border)"
		>
			<h2 class="text-base font-semibold">{title}</h2>
			<button
				type="button"
				class="btn btn-ghost !min-h-0 !p-1"
				onclick={handleClose}
				aria-label="Close"
			>
				&#215;
			</button>
		</div>
		<div class="px-5 py-4">{@render children()}</div>
		{#if footer}
			<div class="flex justify-end gap-2 border-t px-5 py-3" style="border-color: var(--border)">
				{@render footer()}
			</div>
		{/if}
	{/if}
</dialog>
