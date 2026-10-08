<script lang="ts">
	import ArrowDownRight from "@lucide/svelte/icons/arrow-down-right";
	import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
	import {
		formatCount,
		formatCurrency,
		formatMoney,
		formatPercent,
		formatSignedCurrency,
		formatSignedPercent,
		plural
	} from "$lib/format";
	import type { ListAnalysis } from "$lib/types";

	let { analysis, accountCount }: { analysis: ListAnalysis; accountCount: number } = $props();

	const breakdown = $derived(analysis.breakdown);
	const funds = $derived(analysis.inputs.filter((input) => input.kind === "etf").length);
	const stocks = $derived(analysis.inputs.length - funds);
	const securities = $derived(analysis.holdings.length + analysis.tail.count);
	const coverage = $derived(Math.max(100 - analysis.unaccounted.percentOfPortfolio, 0));
	const up = $derived(analysis.dayChange.amount >= 0);

	const mix = $derived(
		[funds ? plural(funds, "fund") : null, stocks ? plural(stocks, "stock") : null]
			.filter(Boolean)
			.join(" and ")
	);
</script>

{#snippet card(label: string)}
	<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
{/snippet}

<section aria-label="Summary" class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
	<div class="rounded-2xl border bg-card p-4">
		{@render card("Portfolio value")}
		<p class="mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
			{formatCurrency(analysis.totalValue)}
		</p>
		<p class="mt-1 text-[13px] text-muted-foreground">
			{#if !analysis.totalValueComplete}
				Still pricing your holdings…
			{:else if accountCount > 1}
				{plural(accountCount, "account")} · {plural(analysis.inputs.length, "holding")}
			{:else}
				{plural(analysis.inputs.length, "holding")}
			{/if}
		</p>
	</div>

	<div class="rounded-2xl border bg-card p-4">
		{@render card("Today")}
		<p
			class="mt-1.5 flex items-center gap-1 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl {up
				? 'text-green-700 dark:text-green-400'
				: 'text-red-700 dark:text-red-400'}"
		>
			{#if up}<ArrowUpRight class="size-5" />{:else}<ArrowDownRight class="size-5" />{/if}
			{formatSignedCurrency(analysis.dayChange.amount)}
		</p>
		<p class="mt-1 text-[13px] text-muted-foreground">
			<span class="font-mono tabular-nums"
				>{formatSignedPercent(analysis.dayChange.percent)}</span
			>
			{analysis.dayChange.complete
				? "since yesterday's close"
				: "so far · some prices pending"}
		</p>
	</div>

	<div class="rounded-2xl border bg-card p-4">
		{@render card("Annual fund fees")}
		<p class="mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
			{formatCurrency(breakdown.fees.annual)}
		</p>
		<p class="mt-1 text-[13px] text-muted-foreground">
			<span class="font-mono tabular-nums"
				>{formatPercent(breakdown.fees.expenseRatio, 3)}</span
			>
			weighted expense ratio{breakdown.fees.complete ? "" : " · partial"}
		</p>
	</div>

	<div class="rounded-2xl border bg-card p-4">
		{@render card("Est. annual income")}
		<p class="mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
			{formatMoney(breakdown.income.annual)}
		</p>
		<p class="mt-1 text-[13px] text-muted-foreground">
			<span class="font-mono tabular-nums">{formatPercent(breakdown.income.yield)}</span>
			distribution yield
		</p>
	</div>

	<div class="rounded-2xl border bg-card p-4">
		{@render card("Securities owned")}
		<p class="mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
			{formatCount(securities)}
		</p>
		<p class="mt-1 text-[13px] text-muted-foreground">Through {mix || "your holdings"}</p>
	</div>

	<div class="rounded-2xl border bg-card p-4">
		{@render card("Data coverage")}
		<p class="mt-1.5 font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
			{formatPercent(coverage, 1)}
		</p>
		<div class="my-2 h-1.5 overflow-hidden rounded-full bg-muted">
			<div class="h-1.5 bg-indigo-700 dark:bg-indigo-400" style:width="{coverage}%"></div>
		</div>
		<p class="text-[13px] text-muted-foreground">
			<span class="font-mono tabular-nums"
				>{formatPercent(analysis.unaccounted.percentOfPortfolio, 1)}</span
			> not covered by holdings data
		</p>
	</div>
</section>
