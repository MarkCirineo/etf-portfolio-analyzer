<script lang="ts">
	import { formatMoney, formatPercent } from "$lib/format";
	import type { ListAnalysis } from "$lib/types";

	let { analysis }: { analysis: ListAnalysis } = $props();

	const pricing = $derived(analysis.quotes.pending > 0 || !analysis.totalValueComplete);
	const pricedFraction = $derived(
		analysis.quotes.requested > 0 ? analysis.quotes.priced / analysis.quotes.requested : 1
	);
	const poorlyCovered = $derived(
		analysis.inputs
			.filter((input) => input.weightCovered !== null && input.weightCovered < 95)
			.sort((a, b) => (a.weightCovered ?? 0) - (b.weightCovered ?? 0))
	);
	const leveraged = $derived(
		analysis.inputs.filter((input) => input.leveraged).map((input) => input.symbol)
	);
</script>

{#if pricing}
	<div role="status" class="rounded-xl border bg-card px-4 py-3 text-[13px]">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<span>
				Pricing your holdings —
				<span class="font-mono tabular-nums"
					>{analysis.quotes.priced} / {analysis.quotes.requested}</span
				>. Share counts fill in as prices arrive.
			</span>
		</div>
		<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
			<div
				class="h-1.5 rounded-full bg-indigo-700 transition-all dark:bg-indigo-400"
				style:width="{pricedFraction * 100}%"
			></div>
		</div>
	</div>
{/if}

{#if analysis.failedTickers.length}
	<div
		class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
	>
		Holdings could not be looked up for {analysis.failedTickers.join(", ")}. Until that resolves
		they are treated as directly held shares.
	</div>
{/if}

{#if analysis.unaccounted.percentOfPortfolio >= 5}
	<div
		class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
	>
		<strong
			>{formatPercent(analysis.unaccounted.percentOfPortfolio, 1)} of this portfolio ({formatMoney(
				analysis.unaccounted.exposure
			)}) is missing from the breakdowns.</strong
		>
		{#if poorlyCovered.length}
			{poorlyCovered
				.map(
					(input) =>
						`${input.symbol} reports only ${formatPercent(input.weightCovered, 0)} of its holdings`
				)
				.join("; ")}.
		{/if}
	</div>
{/if}

{#if leveraged.length}
	<div
		class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
	>
		{leveraged.join(", ")}
		{leveraged.length === 1 ? "is a leveraged fund" : "are leveraged funds"}. The look-through
		reflects what the fund physically holds (mostly cash and swaps), not its multiplied index
		exposure.
	</div>
{/if}

{#if analysis.quoteFailures.length && !pricing}
	<div
		class="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200"
	>
		No price available for {analysis.quoteFailures.slice(0, 8).join(", ")}{analysis
			.quoteFailures.length > 8
			? ` and ${analysis.quoteFailures.length - 8} more`
			: ""}. Their exposure still counts; share counts are unknown.
	</div>
{/if}
