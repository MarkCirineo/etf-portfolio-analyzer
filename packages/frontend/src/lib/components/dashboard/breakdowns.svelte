<script lang="ts">
	import { formatCompactMoney, formatPercent } from "$lib/format";
	import type { BreakdownSet, PortfolioBreakdown } from "$lib/types";

	let { breakdown }: { breakdown: PortfolioBreakdown } = $props();

	const REGION_COLORS = ["#3730A3", "#0F766E", "#B45309", "#9F1239", "#075985", "#57534E"];
	const SIZE_COLORS = ["#312E81", "#4F46E5", "#818CF8", "#C7D2FE", "#E0E7FF"];
	const UNCLASSIFIED = "#A1A1AA";

	/** Rows plus an "Unclassified" remainder when it is big enough to matter. */
	const withRemainder = (set: BreakdownSet) =>
		set.unclassified.percent >= 0.5
			? [
					...set.rows,
					{
						name: "Unclassified",
						exposure: set.unclassified.exposure,
						percent: set.unclassified.percent
					}
				]
			: set.rows;

	const sectors = $derived(breakdown.sectors.rows.slice(0, 12));
	const largestSector = $derived(sectors[0]?.percent ?? 0);

	const regions = $derived(
		withRemainder(breakdown.regions).map((row, index) => ({
			...row,
			color:
				row.name === "Unclassified"
					? UNCLASSIFIED
					: REGION_COLORS[index % REGION_COLORS.length]
		}))
	);

	const countries = $derived(breakdown.countries.rows.slice(0, 10));

	const sizes = $derived(
		withRemainder(breakdown.marketCap).map((row, index) => ({
			...row,
			color:
				row.name === "Unclassified" ? UNCLASSIFIED : SIZE_COLORS[index % SIZE_COLORS.length]
		}))
	);

	const valuation = $derived(breakdown.valuation);
</script>

{#snippet empty()}
	<p class="rounded-xl bg-muted/70 p-4 text-[13px] text-muted-foreground">
		No fund profile data yet.
	</p>
{/snippet}

{#snippet stacked(label: string, rows: { name: string; percent: number; color: string }[])}
	<div
		role="img"
		aria-label={`${label}: ${rows.map((row) => `${row.name} ${formatPercent(row.percent, 1)}`).join(", ")}`}
		class="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-muted"
	>
		{#each rows as row (row.name)}
			<div style:width="{row.percent}%" style:background={row.color}></div>
		{/each}
	</div>
	<ul class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
		{#each rows as row (row.name)}
			<li class="flex min-w-0 items-center gap-2">
				<span class="size-2.5 shrink-0 rounded-[3px]" style:background={row.color}></span>
				<span class="truncate">{row.name}</span>
				<span class="ml-auto font-mono tabular-nums">{formatPercent(row.percent, 1)}</span>
			</li>
		{/each}
	</ul>
{/snippet}

<div class="grid gap-6 lg:grid-cols-3">
	<section aria-labelledby="sectors-title" class="min-w-0 rounded-2xl border bg-card p-5">
		<h2 id="sectors-title" class="text-base font-semibold">Sectors</h2>
		<p class="mb-4 mt-1 text-[13px] text-muted-foreground">
			Share of your whole portfolio, through every fund
		</p>
		{#if sectors.length === 0}
			{@render empty()}
		{:else}
			<ul class="flex flex-col gap-2.5">
				{#each sectors as row (row.name)}
					<li
						class="grid grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)_3.25rem] items-center gap-2.5"
					>
						<span class="truncate text-[13px]" title={row.name}>{row.name}</span>
						<span class="h-2 rounded-full bg-muted">
							<span
								class="block h-2 rounded-full bg-indigo-700 dark:bg-indigo-400"
								style:width="{largestSector > 0
									? (row.percent / largestSector) * 100
									: 0}%"
							></span>
						</span>
						<span class="text-right font-mono text-[13px] tabular-nums"
							>{formatPercent(row.percent, 1)}</span
						>
					</li>
				{/each}
			</ul>
			{#if breakdown.sectors.unclassified.percent >= 0.5}
				<p class="mt-3 text-xs text-muted-foreground">
					<span class="font-mono tabular-nums"
						>{formatPercent(breakdown.sectors.unclassified.percent, 1)}</span
					> not classified (stocks you hold directly, or data a fund doesn't report)
				</p>
			{/if}
		{/if}
	</section>

	<section aria-labelledby="geo-title" class="min-w-0 rounded-2xl border bg-card p-5">
		<h2 id="geo-title" class="text-base font-semibold">Geography</h2>
		<p class="mb-4 mt-1 text-[13px] text-muted-foreground">
			Where the companies you own are based
		</p>
		{#if regions.length === 0}
			{@render empty()}
		{:else}
			{@render stacked("Regions", regions)}
			{#if countries.length}
				<h3
					class="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
				>
					Top countries
				</h3>
				<ol class="grid grid-cols-2 gap-x-4 text-[13px]">
					{#each countries as row (row.name)}
						<li class="flex justify-between gap-2 border-b py-1.5">
							<span class="truncate">{row.name}</span>
							<span class="font-mono tabular-nums"
								>{formatPercent(row.percent, 1)}</span
							>
						</li>
					{/each}
				</ol>
			{/if}
		{/if}
	</section>

	<section aria-labelledby="size-title" class="min-w-0 rounded-2xl border bg-card p-5">
		<h2 id="size-title" class="text-base font-semibold">Size &amp; valuation</h2>
		<p class="mb-4 mt-1 text-[13px] text-muted-foreground">
			By company size, weighted across your funds
		</p>
		{#if sizes.length === 0}
			{@render empty()}
		{:else}
			{@render stacked("Market cap", sizes)}
		{/if}
		<dl class="mt-5 grid grid-cols-2 gap-3">
			<div class="rounded-xl bg-muted/70 px-3.5 py-3">
				<dt class="text-xs text-muted-foreground">Avg. market cap</dt>
				<dd class="mt-1 font-mono text-lg font-semibold tabular-nums">
					{formatCompactMoney(valuation.weightedAvgMarketCap)}
				</dd>
			</div>
			<div class="rounded-xl bg-muted/70 px-3.5 py-3">
				<dt class="text-xs text-muted-foreground">Price / earnings</dt>
				<dd class="mt-1 font-mono text-lg font-semibold tabular-nums">
					{valuation.priceToEarnings?.toFixed(1) ?? "—"}
				</dd>
			</div>
			<div class="rounded-xl bg-muted/70 px-3.5 py-3">
				<dt class="text-xs text-muted-foreground">Price / book</dt>
				<dd class="mt-1 font-mono text-lg font-semibold tabular-nums">
					{valuation.priceToBook?.toFixed(1) ?? "—"}
				</dd>
			</div>
			<div class="rounded-xl bg-muted/70 px-3.5 py-3">
				<dt class="text-xs text-muted-foreground">Distribution yield</dt>
				<dd class="mt-1 font-mono text-lg font-semibold tabular-nums">
					{formatPercent(breakdown.income.yield)}
				</dd>
			</div>
		</dl>
		{#if valuation.coveredPercent > 0 && valuation.coveredPercent < 95}
			<p class="mt-3 text-xs text-muted-foreground">
				Valuation covers <span class="font-mono tabular-nums"
					>{formatPercent(valuation.coveredPercent, 0)}</span
				> of your portfolio.
			</p>
		{/if}
	</section>
</div>
