<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";
	import { Toaster } from "$lib/components/ui/sonner/index.js";
	import { AppHeader } from "$lib/components/app-header";

	let { children } = $props();
</script>

<div class="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
	<AppHeader />
	<main class="flex-1">
		{@render children()}
	</main>
</div>

<ModeWatcher />

<Toaster richColors position="bottom-center" />

<!-- svelte-ignore css_unused_selector -->
<style>
	:global(.avatar-trigger) {
		border: 1px solid hsl(var(--border));
		background-color: hsl(var(--background));
		border-radius: 9999px;
		padding: 0.15rem;
		display: inline-flex;
		transition: box-shadow 0.2s ease;
	}

	:global(.avatar-trigger:hover) {
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	:global(.account-popover) {
		background-color: hsl(var(--background));
		border-color: hsl(var(--border));
		box-shadow: 0 20px 45px rgba(0, 0, 0, 0.12);
	}
</style>
