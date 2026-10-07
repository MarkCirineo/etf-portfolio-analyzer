<script lang="ts">
	import type { Snippet } from "svelte";
	import Pencil from "@lucide/svelte/icons/pencil";
	import RefreshCw from "@lucide/svelte/icons/refresh-cw";
	import Button from "$lib/components/ui/button/button.svelte";
	import { symbolColors } from "$lib/dashboard";
	import { formatMoney, formatTime, plural } from "$lib/format";
	import type { PortfolioView } from "$lib/stores/portfolio-view.svelte";
	import type { AnalyzedHolding } from "$lib/types";
	import AccountsStrip from "./accounts-strip.svelte";
	import Breakdowns from "./breakdowns.svelte";
	import GrowthChart from "./growth-chart.svelte";
	import HoldingDrawer from "./holding-drawer.svelte";
	import HoldingsCard from "./holdings-card.svelte";
	import HoldingsExplorer from "./holdings-explorer.svelte";
	import Notices from "./notices.svelte";
	import OverlapMatrix from "./overlap-matrix.svelte";
	import SummaryCards from "./summary-cards.svelte";
	import Treemap from "./treemap.svelte";

	let {
		view,
		eyebrow,
		editHref,
		actions
	}: {
		view: PortfolioView;
		/** Shown above the title, e.g. "Main portfolio". */
		eyebrow: string;
		editHref: string;
		actions?: Snippet;
	} = $props();

	let opened = $state<AnalyzedHolding | null>(null);

	const detail = $derived(view.detail!);
	const analysis = $derived(detail.analysis);
	const allAccounts = $derived(detail.accounts);
	const inScope = $derived(
		detail.scope
			? allAccounts.filter((account) => detail.scope!.includes(account.id))
			: allAccounts
	);
	const colors = $derived(symbolColors(allAccounts, analysis));
	const scopeLabel = $derived(
		!detail.scope
			? null
			: inScope.length === 1
				? inScope[0].name
				: inScope.map((account) => account.name).join(" + ")
	);
	const total = $derived(allAccounts.reduce((sum, account) => sum + account.value, 0));
</script>

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-16 pt-8 sm:px-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
				{scopeLabel ?? (allAccounts.length > 1 ? `${eyebrow} · all accounts` : eyebrow)}
			</p>
			<h1 class="mt-1 text-3xl font-semibold tracking-tight">What you actually own</h1>
			<p class="mt-1.5 text-muted-foreground">
				{plural(analysis.inputs.length, "holding")}{inScope.length > 1
					? ` across ${inScope.length} accounts`
					: ""} · prices as of {formatTime(analysis.generatedAt)} · market {analysis.marketOpen
					? "open"
					: "closed"}
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{@render actions?.()}
			<Button variant="outline" href={editHref} class="min-h-11 gap-2 px-4">
				<Pencil class="size-4" />
				Edit holdings
			</Button>
			<Button
				variant="outline"
				onclick={view.load}
				disabled={view.refreshing}
				class="min-h-11 gap-2 px-4"
			>
				<RefreshCw class="size-4 {view.refreshing ? 'animate-spin' : ''}" />
				Refresh
			</Button>
		</div>
	</div>

	{#if scopeLabel}
		<div
			role="status"
			class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-indigo-50 py-2 pl-4 pr-2 text-sm dark:bg-indigo-950/60"
		>
			<span>
				Showing <strong>{scopeLabel}</strong> only:
				<span class="font-mono tabular-nums">{formatMoney(analysis.totalValue)}</span> of
				your
				<span class="font-mono tabular-nums">{formatMoney(total)}</span>. Everything on this
				page covers just {inScope.length === 1 ? "this account" : "these accounts"}.
			</span>
			<Button variant="outline" class="min-h-11 bg-card" onclick={() => view.setScope(null)}>
				Show all accounts
			</Button>
		</div>
	{/if}

	<div class="flex flex-col gap-6 transition-opacity {view.refreshing ? 'opacity-60' : ''}">
		<Notices {analysis} />

		<SummaryCards {analysis} accountCount={inScope.length} />

		{#if allAccounts.length > 1}
			<AccountsStrip
				accounts={allAccounts}
				scope={detail.scope}
				{colors}
				accountsHref={view.accountsHref}
				onselect={view.setScope}
			/>
		{/if}

		<div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
			{#if analysis.holdings.length}
				<Treemap {analysis} {colors} onopen={(holding) => (opened = holding)} />
			{/if}
			<HoldingsCard {analysis} accounts={inScope} {colors} />
		</div>

		<Breakdowns breakdown={analysis.breakdown} />

		{#if analysis.breakdown.backtest || analysis.breakdown.overlap.funds.length > 1}
			<div class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
				{#if analysis.breakdown.backtest}
					<GrowthChart backtest={analysis.breakdown.backtest} />
				{/if}
				{#if analysis.breakdown.overlap.funds.length > 1}
					<OverlapMatrix overlap={analysis.breakdown.overlap} />
				{/if}
			</div>
		{/if}

		<HoldingsExplorer {analysis} {colors} onopen={(holding) => (opened = holding)} />

		<p class="text-xs text-muted-foreground">
			Fund holdings, sectors and history from etf.com · prices from Finnhub · share counts are
			exposure divided by price.
		</p>
	</div>
</div>

<HoldingDrawer
	holding={opened}
	{analysis}
	accounts={inScope}
	{colors}
	onclose={() => (opened = null)}
/>
