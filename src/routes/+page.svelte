<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const features = [
		{
			title: 'QR clock-in',
			body: 'Display a code at the door. Staff scan it with their own phone and confirm. Every scan is validated on the server.'
		},
		{
			title: 'Live shift timer',
			body: 'Timers run from server timestamps, so they survive a refresh, a locked phone or a dropped connection.'
		},
		{
			title: 'Breaks that match your rules',
			body: 'Deduct a fixed unpaid break automatically, or let staff record breaks as they take them.'
		},
		{
			title: 'Tasks and time off',
			body: 'Assign work, track progress, and handle leave requests without a single phone call.'
		},
		{
			title: 'Hours you can check',
			body: 'Every shift keeps its original clock events. Corrections are proposed, reviewed and logged.'
		},
		{
			title: 'Estimated earnings',
			body: 'Approved hours times the rate that applied at the time. Clearly marked as an estimate, never a payslip.'
		}
	];

	const steps = [
		{ n: 1, title: 'Create your organization', body: 'Set your timezone, currency and break policy.' },
		{ n: 2, title: 'Invite your team', body: 'Share one link. They sign up and join automatically.' },
		{ n: 3, title: 'Open the station', body: 'Put the QR code on any phone or tablet at the entrance.' },
		{ n: 4, title: 'Watch the day unfold', body: 'See who is in, who is on break, and the hours as they build.' }
	];
</script>

<svelte:head>
	<title>Shiftly — Know who is on shift, and for how long</title>
	<meta
		name="description"
		content="Shiftly is a mobile-first attendance and team management tool for small businesses. QR clock-in, live shift timers, breaks, tasks and time off."
	/>
</svelte:head>

<div class="min-h-dvh" style="background: var(--surface)">
	<header class="sticky top-0 z-20 border-b backdrop-blur" style="border-color: var(--border); background: color-mix(in oklch, var(--surface) 85%, transparent)">
		<nav class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
			<a href="/" class="flex items-center gap-2 font-semibold no-underline" style="color: var(--text)">
				<img src="/icon.svg" alt="" width="28" height="28" />
				Shiftly
			</a>
			<div class="flex items-center gap-2">
				{#if data.signedIn}
					<a href="/app" class="btn btn-primary">Open Shiftly</a>
				{:else}
					<a href="/login" class="btn btn-ghost">Sign in</a>
					<a href="/signup" class="btn btn-primary">Get started</a>
				{/if}
			</div>
		</nav>
	</header>

	<!-- Hero -->
	<section class="mx-auto max-w-6xl px-4 pt-12 pb-10 sm:pt-20">
		<div class="grid items-center gap-10 lg:grid-cols-2">
			<div>
				<p class="badge badge-info mb-4">Built for teams of 2–50</p>
				<h1 class="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
					Know who is on shift, and for how long.
				</h1>
				<p class="mt-4 max-w-xl text-lg" style="color: var(--text-muted)">
					Shiftly replaces the paper attendance book. Staff clock in by scanning a code at the
					door; you get accurate hours, breaks, tasks and time off in one place.
				</p>
				<div class="mt-7 flex flex-wrap gap-3">
					<a href="/signup" class="btn btn-primary btn-lg">Start Managing Your Team</a>
					<a href="#how" class="btn btn-secondary btn-lg">See how it works</a>
				</div>
				<p class="hint mt-3">No card required. Works on any phone browser.</p>
			</div>

			<!-- Clock-in demonstration -->
			<div class="relative mx-auto w-full max-w-sm">
				<div class="card overflow-hidden">
					<div class="border-b px-5 py-4 text-center" style="border-color: var(--border)">
						<p class="hint !mt-0">Front Entrance</p>
						<p class="font-semibold">Kibera Coffee House</p>
					</div>
					<div class="flex flex-col items-center gap-3 px-5 py-6">
						<!-- A representative QR block, not a working code. -->
						<svg viewBox="0 0 29 29" class="h-40 w-40" role="img" aria-label="Illustration of a station QR code" style="image-rendering: pixelated">
							<rect width="29" height="29" fill="#fff" />
							{#each [[0, 0], [22, 0], [0, 22]] as [x, y] (x + '-' + y)}
								<rect {x} {y} width="7" height="7" fill="none" stroke="#111" stroke-width="1" />
								<rect x={x + 2} y={y + 2} width="3" height="3" fill="#111" />
							{/each}
							{#each [[9, 2], [11, 3], [13, 2], [10, 5], [12, 6], [14, 4], [9, 8], [13, 9], [2, 10], [4, 12], [6, 10], [8, 13], [10, 11], [12, 12], [14, 14], [16, 11], [18, 13], [20, 10], [22, 12], [24, 14], [26, 11], [2, 16], [4, 18], [6, 20], [8, 17], [10, 19], [12, 16], [14, 18], [16, 20], [18, 17], [20, 19], [22, 16], [24, 18], [26, 20], [9, 22], [11, 24], [13, 26], [15, 23], [17, 25], [19, 22], [21, 26], [23, 23], [25, 25], [10, 27], [16, 27], [22, 27], [27, 16], [27, 22]] as [x, y] (x + ':' + y)}
								<rect {x} {y} width="2" height="2" fill="#111" />
							{/each}
						</svg>
						<p class="badge badge-ok">Valid today</p>
						<p class="hint text-center">Scan with your phone camera to clock in or out.</p>
					</div>
				</div>

				<div class="card mt-3 px-4 py-3">
					<div class="flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">Amina Yusuf</p>
							<p class="hint !mt-0">Clocked in 08:02</p>
						</div>
						<span class="badge badge-ok">
							<span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>
							Working
						</span>
						<span class="tnum text-sm font-semibold">3:41:08</span>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- How it works -->
	<section id="how" class="border-y py-14" style="border-color: var(--border); background: var(--surface-sunken)">
		<div class="mx-auto max-w-6xl px-4">
			<h2 class="text-2xl font-bold tracking-tight sm:text-3xl">From sign-up to first shift</h2>
			<ol class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{#each steps as step (step.n)}
					<li class="card px-5 py-5">
						<span
							class="flex h-8 w-8 items-center justify-center rounded-full font-semibold"
							style="background: var(--color-brand-600); color: #fff">{step.n}</span
						>
						<p class="mt-3 font-semibold">{step.title}</p>
						<p class="hint">{step.body}</p>
					</li>
				{/each}
			</ol>
		</div>
	</section>

	<!-- Features -->
	<section class="mx-auto max-w-6xl px-4 py-14">
		<h2 class="text-2xl font-bold tracking-tight sm:text-3xl">Everything a small team needs</h2>
		<p class="mt-2 max-w-2xl" style="color: var(--text-muted)">
			And nothing it does not. Shiftly is deliberately small: it records hours accurately and
			keeps the record honest.
		</p>
		<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each features as feature (feature.title)}
				<div class="card px-5 py-5">
					<h3 class="font-semibold">{feature.title}</h3>
					<p class="hint">{feature.body}</p>
				</div>
			{/each}
		</div>
	</section>

	<!-- Honesty about the QR model -->
	<section class="mx-auto max-w-6xl px-4 pb-14">
		<div class="card px-5 py-5" style="background: var(--surface-muted)">
			<h2 class="font-semibold">What a QR code does and does not prove</h2>
			<p class="hint max-w-3xl">
				The station code changes every day and every scan is checked on the server, so an old
				screenshot stops working. But a code shown on a screen can be photographed and shared,
				so Shiftly treats scanning as a convenient way to record attendance — not as proof that
				somebody was physically present. Short-lived rotating codes and optional location checks
				are planned.
			</p>
		</div>
	</section>

	<!-- CTA -->
	<section class="border-t py-14" style="border-color: var(--border); background: var(--surface-sunken)">
		<div class="mx-auto max-w-3xl px-4 text-center">
			<h2 class="text-2xl font-bold tracking-tight sm:text-3xl">Set it up in a few minutes</h2>
			<p class="mt-2" style="color: var(--text-muted)">
				Create your organization, invite your team and open the station.
			</p>
			<a href="/signup" class="btn btn-primary btn-lg mt-6">Start Managing Your Team</a>
		</div>
	</section>

	<footer class="border-t py-8" style="border-color: var(--border)">
		<div class="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
			<p class="hint !mt-0">Shiftly — workforce attendance for small teams.</p>
			<nav class="flex gap-4 text-sm">
				<a href="/login" style="color: var(--text-muted)">Sign in</a>
				<a href="/signup" style="color: var(--text-muted)">Create account</a>
			</nav>
		</div>
	</footer>
</div>
