<script lang="ts">
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Waiting for approval — Shiftly</title></svelte:head>

{#if data.pending.status === 'rejected'}
	<AuthShell title="Request not accepted">
		<Alert tone="danger">
			Your request to join {data.pending.organizationName} was not accepted. If you think this is
			a mistake, speak to your manager.
		</Alert>
		<form method="POST" action="/auth/signout" class="mt-5">
			<button type="submit" class="btn btn-secondary w-full">Sign out</button>
		</form>
	</AuthShell>
{:else}
	<AuthShell title="Waiting for approval">
		<Alert tone="info" title="Your request has been sent">
			A manager at {data.pending.organizationName} needs to accept you before you can clock in.
		</Alert>
		<p class="hint mt-4">
			Nothing more to do for now. Check back here, or ask your manager directly.
		</p>
		<div class="mt-5 flex flex-col gap-2">
			<a href="/app/pending" class="btn btn-primary w-full" data-sveltekit-reload>Check again</a>
			<form method="POST" action="/auth/signout">
				<button type="submit" class="btn btn-ghost w-full">Sign out</button>
			</form>
		</div>
	</AuthShell>
{/if}
