<script lang="ts">
	import { page } from '$app/state';
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';

	const reason = $derived(page.url.searchParams.get('reason'));
	const message = $derived(
		reason === 'missing'
			? 'That link is incomplete. It may have been cut short by your email client.'
			: 'That link has expired or has already been used.'
	);
</script>

<svelte:head><title>Link problem — Shiftly</title></svelte:head>

<AuthShell title="This link did not work">
	<Alert tone="danger">{message}</Alert>
	<div class="mt-5 flex flex-col gap-2">
		<a href="/forgot-password" class="btn btn-primary w-full">Request a new link</a>
		<a href="/login" class="btn btn-secondary w-full">Back to sign in</a>
	</div>
</AuthShell>
