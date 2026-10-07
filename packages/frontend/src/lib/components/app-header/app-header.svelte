<script lang="ts">
	import Layers from "@lucide/svelte/icons/layers";
	import { page } from "$app/state";
	import { AccountMenu } from "$lib/components/account-menu";
	import { activeView } from "$lib/stores/portfolio-view.svelte";
	import { cn } from "$lib/utils";
	import ScopeSwitcher from "./scope-switcher.svelte";

	const links = [
		{ href: "/", label: "Portfolio", match: (path: string) => path === "/" },
		{
			href: "/accounts",
			label: "Accounts",
			match: (path: string) => path.startsWith("/accounts")
		},
		{ href: "/lists", label: "Scenarios", match: (path: string) => path.startsWith("/lists") }
	];

	const view = $derived(activeView.current);
	const showSwitcher = $derived((view?.detail?.accounts.length ?? 0) > 1);
</script>

<header class="border-b bg-card">
	<div
		class="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6"
	>
		<a href="/" class="flex items-center gap-2.5 text-[15px] font-semibold text-foreground">
			<span
				class="inline-flex size-8 items-center justify-center rounded-lg bg-indigo-700 text-white dark:bg-indigo-400 dark:text-zinc-950"
			>
				<Layers class="size-[18px]" />
			</span>
			<span class="hidden sm:inline">ETF Portfolio Analyzer</span>
		</a>

		<nav aria-label="Primary" class="order-last flex w-full gap-1 sm:order-none sm:w-auto">
			{#each links as link (link.href)}
				{@const current = link.match(page.url.pathname)}
				<a
					href={link.href}
					aria-current={current ? "page" : undefined}
					class={cn(
						"rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors",
						current
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:bg-muted hover:text-foreground"
					)}
				>
					{link.label}
				</a>
			{/each}
		</nav>

		<div class="ml-auto flex items-center gap-2">
			{#if view && showSwitcher}
				<ScopeSwitcher {view} />
			{/if}
			<AccountMenu />
		</div>
	</div>
</header>
