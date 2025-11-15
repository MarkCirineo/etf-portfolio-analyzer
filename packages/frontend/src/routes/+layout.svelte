<script lang="ts">
	import "../app.css";
	import { ModeWatcher } from "mode-watcher";
	import { onMount } from "svelte";

	import LightSwitch from "$lib/components/ui/light-switch/light-switch.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import { Toaster } from "$lib/components/ui/sonner/index.js";
	import { AuthDialog } from "$lib/components/auth";
	import { authStore } from "$lib/stores/auth";

	const auth = authStore;

	onMount(() => {
		auth.refreshSession();
	});

	let { children } = $props();
</script>

{@render children()}

<ModeWatcher />

<Toaster richColors position="bottom-center" />

<div class="options">
	{#if $auth.status === "authenticated" && $auth.user}
		<div class="session-card">
			<div class="text-right">
				<p class="text-sm font-medium truncate">
					{$auth.user.username || $auth.user.email}
				</p>
				<p class="text-xs text-muted-foreground">Signed in</p>
			</div>
			<Button size="sm" variant="outline" onclick={() => auth.logout()}>Log out</Button>
		</div>
	{:else if $auth.status === "loading" || $auth.status === "idle"}
		<div class="session-card">
			<p class="text-sm font-medium">Checking session...</p>
		</div>
	{:else}
		<div class="flex flex-wrap gap-3">
			<AuthDialog mode="login" />
			<AuthDialog mode="signup" />
		</div>
	{/if}
	<LightSwitch />
</div>

<style>
	.options {
		position: fixed;
		top: 1rem;
		right: 1rem;
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}

	.session-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid hsl(var(--border));
		background-color: hsl(var(--background));
		padding: 0.6rem 0.75rem;
		min-width: 12rem;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
	}
</style>
