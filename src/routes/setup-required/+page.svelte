<script lang="ts">
	import Alert from '$lib/components/ui/Alert.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Configuration required — Shiftly</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-14">
	<h1 class="text-2xl font-bold">Shiftly is not configured yet</h1>
	<p class="mt-2" style="color: var(--text-muted)">
		The application cannot reach its database until these environment variables are set. Nothing
		is running in a degraded or simulated mode — the app is simply not connected.
	</p>

	{#if data.problems.length}
		<div class="mt-6">
			<Alert tone="danger" title="Missing configuration">
				<ul class="mt-2 list-disc space-y-1 pl-5">
					{#each data.problems as problem (problem)}
						<li>{problem}</li>
					{/each}
				</ul>
			</Alert>
		</div>
	{/if}

	<section class="card mt-6 px-5 py-5">
		<h2 class="font-semibold">How to fix it</h2>
		<ol class="mt-3 list-decimal space-y-2 pl-5 text-sm" style="color: var(--text-muted)">
			<li>Create a project at <code>supabase.com</code>.</li>
			<li>
				Copy <code>.env.example</code> to <code>.env</code> and fill in the project URL, the anon
				key and the service-role key.
			</li>
			<li>
				Set <code>QR_TOKEN_SECRET</code> to a random string of at least 32 characters.
			</li>
			<li>Apply the migrations in <code>supabase/migrations</code>.</li>
			<li>Restart the dev server.</li>
		</ol>
		<p class="hint">
			The project README has the full walkthrough, including how to apply the migrations without
			the Supabase CLI.
		</p>
	</section>
</main>
