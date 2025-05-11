<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";

	import LightSwitch from "$lib/components/ui/light-switch/light-switch.svelte";
	import { Toaster } from "$lib/components/ui/sonner/index.js";

	let { children } = $props();
</script>

{@render children()}

<ModeWatcher />

<Toaster richColors position="bottom-center" />

<div class="options">
	<LightSwitch />
</div>

<style>
	.options {
		position: fixed;
		top: 1rem;
		right: 1rem;
		display: flex;
		gap: 1rem;
	}
</style>
