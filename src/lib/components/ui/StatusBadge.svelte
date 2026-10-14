<script lang="ts">
	/**
	 * Attendance status. Colour is never the only signal: each state carries
	 * its own label, and the dot has a distinct shape per state.
	 */
	import type { AttendanceState } from '$lib/domain/attendance';

	let { state, label }: { state: AttendanceState; label?: string } = $props();

	const config: Record<AttendanceState, { tone: string; text: string }> = {
		working: { tone: 'badge-ok', text: 'Working' },
		on_break: { tone: 'badge-warn', text: 'On break' },
		shift_completed: { tone: 'badge-info', text: 'Shift complete' },
		not_clocked_in: { tone: 'badge-muted', text: 'Not clocked in' }
	};
</script>

<span class="badge {config[state].tone}">
	<span
		class="h-1.5 w-1.5 rounded-full"
		style="background: currentColor; {state === 'working' ? '' : 'opacity:.7'}"
		aria-hidden="true"
	></span>
	{label ?? config[state].text}
</span>
