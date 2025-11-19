<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";
	import { Toaster } from "$lib/components/ui/sonner/index.js";
	import { AccountMenu } from "$lib/components/account-menu";
	import { Navigation } from "$lib/components/navigation";

	let { children } = $props();
</script>

{@render children()}

<ModeWatcher />

<Toaster richColors position="bottom-center" />

<Navigation />

<div class="options">
	<AccountMenu />
</div>

<!-- svelte-ignore css_unused_selector -->
<style>
	.options {
		position: fixed;
		top: 1rem;
		right: 1rem;
	}

	.avatar-trigger {
		border: 1px solid hsl(var(--border));
		background-color: hsl(var(--background));
		border-radius: 9999px;
		padding: 0.15rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
		transition:
			transform 0.15s ease,
			box-shadow 0.2s ease;
		display: inline-flex;
	}

	.avatar-trigger:hover {
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
		transform: translateY(-1px);
	}

	.account-popover {
		background-color: hsl(var(--background));
		border-color: hsl(var(--border));
		box-shadow: 0 20px 45px rgba(0, 0, 0, 0.12);
	}
</style>
