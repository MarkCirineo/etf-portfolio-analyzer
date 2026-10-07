<script lang="ts">
	import { onDestroy } from "svelte";
	import Layers from "@lucide/svelte/icons/layers";
	import Plus from "@lucide/svelte/icons/plus";
	import { AuthDialog } from "$lib/components/auth";
	import { Dashboard } from "$lib/components/dashboard";
	import Button from "$lib/components/ui/button/button.svelte";
	import { auth } from "$lib/stores/auth.svelte";
	import { activeView, PortfolioView } from "$lib/stores/portfolio-view.svelte";

	const view = new PortfolioView("/portfolio", { syncUrl: true });
	activeView.current = view;

	let started = false;

	$effect(() => {
		if (auth.status === "authenticated" && !started) {
			started = true;
			void view.load();
		}
	});

	onDestroy(() => {
		view.destroy();
		if (activeView.current === view) {
			activeView.current = null;
		}
	});
</script>

<svelte:head>
	<title>Portfolio · ETF Portfolio Analyzer</title>
</svelte:head>

{#if auth.status === "unauthenticated"}
	<div class="mx-auto flex max-w-2xl flex-col items-center gap-8 px-4 py-24 text-center">
		<span
			class="inline-flex size-14 items-center justify-center rounded-2xl bg-indigo-700 text-white dark:bg-indigo-400 dark:text-zinc-950"
		>
			<Layers class="size-7" />
		</span>
		<div class="space-y-4">
			<h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">
				See what you actually own
			</h1>
			<p class="text-lg text-muted-foreground">
				Add your brokerage accounts and the funds in them. We look through every ETF to show
				the thousands of companies underneath: how many shares of each you really own, your
				sectors, countries, fees and income, all combined.
			</p>
		</div>
		<div class="flex flex-col gap-3 sm:flex-row">
			<AuthDialog mode="signup" triggerVariant="default" triggerSize="lg" />
			<AuthDialog mode="login" triggerVariant="outline" triggerSize="lg" />
		</div>
	</div>
{:else if auth.status !== "authenticated" || view.loading}
	<div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-8 sm:px-6" aria-busy="true">
		<div class="h-20 w-80 max-w-full animate-pulse rounded-xl bg-muted"></div>
		<div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
			{#each Array(6) as _, index (index)}
				<div class="h-28 animate-pulse rounded-2xl bg-muted"></div>
			{/each}
		</div>
		<div class="h-96 animate-pulse rounded-2xl bg-muted"></div>
		<span class="sr-only">Loading your portfolio…</span>
	</div>
{:else if view.error && !view.detail}
	<div class="mx-auto max-w-xl px-4 py-16">
		<div
			class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
		>
			<p>{view.error}</p>
			<Button variant="outline" class="mt-4" onclick={view.load}>Try again</Button>
		</div>
	</div>
{:else if view.empty || !view.detail}
	<div class="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-24 text-center">
		<h1 class="text-3xl font-semibold tracking-tight">Set up your portfolio</h1>
		<p class="text-muted-foreground">
			Add each brokerage account you have — a Roth IRA here, a taxable account there — and
			what's in it. Everything gets combined into one look-through view.
		</p>
		<Button href="/accounts" size="lg" class="gap-2">
			<Plus class="size-5" />
			Add your first account
		</Button>
	</div>
{:else}
	<Dashboard {view} eyebrow="Main portfolio" editHref="/accounts" />
{/if}
