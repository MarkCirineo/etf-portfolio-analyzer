<script lang="ts">
	import Search from "@lucide/svelte/icons/search";
	import { mainSource } from "$lib/dashboard";
	import {
		formatCount,
		formatMoney,
		formatPercent,
		formatPrice,
		formatShares
	} from "$lib/format";
	import type { AnalyzedHolding, ListAnalysis, PriceStatus } from "$lib/types";
	import Button from "$lib/components/ui/button/button.svelte";

	let {
		analysis,
		colors,
		onopen
	}: {
		analysis: ListAnalysis;
		colors: Map<string, string>;
		onopen: (holding: AnalyzedHolding) => void;
	} = $props();

	const PAGE = 50;

	type SortKey = "symbol" | "exposure" | "shares" | "price";

	let query = $state("");
	let sort = $state<SortKey>("exposure");
	let descending = $state(true);
	let shown = $state(PAGE);

	const sortValue = (holding: AnalyzedHolding, key: SortKey) =>
		key === "symbol"
			? holding.symbol
			: key === "exposure"
				? holding.exposure
				: key === "shares"
					? holding.totalShares
					: holding.price;

	const rows = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		const filtered = needle
			? analysis.holdings.filter(
					(holding) =>
						holding.symbol.toLowerCase().includes(needle) ||
						(holding.name ?? "").toLowerCase().includes(needle)
				)
			: [...analysis.holdings];

		const direction = descending ? -1 : 1;

		return filtered.sort((a, b) => {
			const va = sortValue(a, sort);
			const vb = sortValue(b, sort);
			// Unknowns always sink to the bottom
			if (va === null && vb === null) return 0;
			if (va === null) return 1;
			if (vb === null) return -1;
			if (typeof va === "string" && typeof vb === "string")
				return va.localeCompare(vb) * direction;
			return ((va as number) - (vb as number)) * direction;
		});
	});

	const visible = $derived(rows.slice(0, shown));
	const largest = $derived(analysis.holdings[0]?.percentOfPortfolio ?? 0);
	const securities = $derived(analysis.holdings.length + analysis.tail.count);

	const sortBy = (key: SortKey) => {
		if (sort === key) {
			descending = !descending;
		} else {
			sort = key;
			descending = key !== "symbol";
		}
	};

	const ariaSort = (key: SortKey) =>
		sort === key ? (descending ? "descending" : "ascending") : "none";
	const arrow = (key: SortKey) => (sort === key ? (descending ? "↓" : "↑") : "");

	const priceNote = (status: PriceStatus) =>
		({
			fresh: "",
			stale: "refreshing",
			pending: "loading",
			unavailable: "unavailable",
			"not-requested": "not priced",
			"foreign-listing": "no US quote",
			"unconfirmed-listing": "listing unconfirmed"
		})[status];

	$effect(() => {
		// A new filter starts from the top of the list again
		void query;
		shown = PAGE;
	});
</script>

{#snippet header(key: SortKey, label: string, align: "left" | "right")}
	<th
		scope="col"
		aria-sort={ariaSort(key)}
		class="border-b px-3 pb-2 font-medium {align === 'right' ? 'text-right' : 'text-left'}"
	>
		<button
			type="button"
			onclick={() => sortBy(key)}
			class="min-h-9 uppercase tracking-wider hover:text-foreground"
		>
			{label} <span aria-hidden="true">{arrow(key)}</span>
		</button>
	</th>
{/snippet}

<section aria-labelledby="explorer-title" class="min-w-0 rounded-2xl border bg-card p-5">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 id="explorer-title" class="text-base font-semibold">Holdings explorer</h2>
			<p class="mt-1 text-[13px] text-muted-foreground">
				{formatCount(securities)} securities · showing
				<span class="font-mono tabular-nums">{formatCount(visible.length)}</span> of the
				{formatCount(rows.length)} largest{query ? " that match" : ""}
			</p>
		</div>
		<div class="flex w-full max-w-72 flex-col gap-1">
			<label for="holding-filter" class="text-xs font-medium text-muted-foreground"
				>Filter holdings</label
			>
			<div
				class="flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 focus-within:ring-2 focus-within:ring-ring"
			>
				<Search class="size-4 shrink-0 text-muted-foreground" />
				<input
					id="holding-filter"
					type="search"
					placeholder="Symbol or company"
					bind:value={query}
					class="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
				/>
			</div>
		</div>
	</div>

	<div class="mt-4 overflow-x-auto">
		<table class="w-full min-w-[860px] border-collapse text-[13px]">
			<thead>
				<tr class="text-xs text-muted-foreground">
					{@render header("symbol", "Holding", "left")}
					{@render header("exposure", "Exposure", "right")}
					<th
						scope="col"
						class="w-52 border-b px-3 pb-2 text-left font-medium uppercase tracking-wider"
						>% of portfolio</th
					>
					{@render header("shares", "Shares", "right")}
					{@render header("price", "Price", "right")}
					<th
						scope="col"
						class="border-b pb-2 pl-3 text-left font-medium uppercase tracking-wider"
						>Comes from</th
					>
				</tr>
			</thead>
			<tbody>
				{#each visible as holding (holding.id)}
					<tr class="hover:bg-muted/50">
						<td class="border-b py-2.5 pr-3">
							<div class="flex items-center gap-3">
								<span
									aria-hidden="true"
									class="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
									style:background={colors.get(mainSource(holding)) ?? "#3F3F46"}
								>
									{holding.symbol.slice(0, 2)}
								</span>
								<div class="min-w-0">
									<div class="flex flex-wrap items-center gap-2">
										<button
											type="button"
											onclick={() => onopen(holding)}
											class="font-semibold text-indigo-700 hover:underline dark:text-indigo-300"
										>
											{holding.symbol}
										</button>
										{#if !holding.usListed}
											<span
												class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300"
											>
												{holding.priceStatus === "unconfirmed-listing"
													? "Listing unconfirmed"
													: "Foreign listing"}
											</span>
										{/if}
									</div>
									<div class="max-w-64 truncate text-xs text-muted-foreground">
										{holding.name ?? "—"}
									</div>
								</div>
							</div>
						</td>
						<td
							class="border-b px-3 py-2.5 text-right font-mono font-semibold tabular-nums"
						>
							{formatMoney(holding.exposure)}
						</td>
						<td class="border-b px-3 py-2.5">
							<div class="flex items-center gap-2.5">
								<span class="h-1.5 flex-1 rounded-full bg-muted">
									<span
										class="block h-1.5 rounded-full bg-indigo-700 dark:bg-indigo-400"
										style:width="{largest > 0
											? Math.max(
													(holding.percentOfPortfolio / largest) * 100,
													1
												)
											: 0}%"
									></span>
								</span>
								<span class="w-14 text-right font-mono tabular-nums"
									>{formatPercent(holding.percentOfPortfolio)}</span
								>
							</div>
						</td>
						<td class="border-b px-3 py-2.5 text-right font-mono tabular-nums">
							{formatShares(holding.totalShares)}
						</td>
						<td
							class="border-b px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground"
						>
							{formatPrice(holding.price)}
							{#if priceNote(holding.priceStatus)}
								<div class="font-sans text-[11px]">
									{priceNote(holding.priceStatus)}
								</div>
							{/if}
						</td>
						<td class="border-b py-2.5 pl-3">
							<div class="flex flex-wrap gap-1">
								{#if holding.directShares > 0}
									<span class="rounded-md bg-muted px-2 py-0.5 text-xs"
										>Direct · {formatShares(holding.directShares, 4)} sh</span
									>
								{/if}
								{#each holding.viaEtfs as via (via.etf)}
									<span
										class="rounded-md bg-muted px-2 py-0.5 text-xs"
										title={`${formatMoney(via.exposure)} through ${via.etf}, ${formatPercent(via.weight)} of the fund`}
										>{via.etf}</span
									>
								{/each}
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="border-b py-6 text-center text-muted-foreground">
							{query
								? "No holdings match that filter."
								: "No exposure calculated yet."}
						</td>
					</tr>
				{/each}
			</tbody>
			{#if !query}
				<tfoot class="text-muted-foreground">
					{#if analysis.tail.count > 0}
						<tr>
							<td class="border-b py-3 pr-3"
								>{formatCount(analysis.tail.count)} smaller holdings</td
							>
							<td class="border-b px-3 py-3 text-right font-mono tabular-nums"
								>{formatMoney(analysis.tail.exposure)}</td
							>
							<td class="border-b px-3 py-3 font-mono tabular-nums"
								>{formatPercent(analysis.tail.percentOfPortfolio)}</td
							>
							<td colspan="3" class="border-b py-3 pl-3 text-xs"
								>Beyond the largest 500</td
							>
						</tr>
					{/if}
					{#if analysis.cashAndOther.exposure > 0}
						<tr>
							<td class="border-b py-3 pr-3">Cash &amp; other</td>
							<td class="border-b px-3 py-3 text-right font-mono tabular-nums"
								>{formatMoney(analysis.cashAndOther.exposure)}</td
							>
							<td class="border-b px-3 py-3 font-mono tabular-nums"
								>{formatPercent(analysis.cashAndOther.percentOfPortfolio)}</td
							>
							<td colspan="3" class="border-b py-3 pl-3 text-xs">
								Cash, futures and other non-equity positions held by your funds
							</td>
						</tr>
					{/if}
					{#if analysis.unaccounted.exposure > 0}
						<tr class="text-amber-800 dark:text-amber-300">
							<td class="border-b py-3 pr-3">Not covered by holdings data</td>
							<td class="border-b px-3 py-3 text-right font-mono tabular-nums"
								>{formatMoney(analysis.unaccounted.exposure)}</td
							>
							<td class="border-b px-3 py-3 font-mono tabular-nums"
								>{formatPercent(analysis.unaccounted.percentOfPortfolio)}</td
							>
							<td colspan="3" class="border-b py-3 pl-3 text-xs">
								Weight {analysis.unaccounted.byInput
									.map((item) => item.symbol)
									.join(", ") || "the funds"} did not attribute to a named position
							</td>
						</tr>
					{/if}
					<tr class="font-semibold text-foreground">
						<td class="pr-3 pt-3">Total</td>
						<td class="px-3 pt-3 text-right font-mono tabular-nums"
							>{formatMoney(analysis.totalValue)}</td
						>
						<td class="px-3 pt-3 font-mono tabular-nums">100%</td>
						<td colspan="3"></td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>

	{#if rows.length > shown}
		<div class="mt-4 flex justify-center">
			<Button variant="outline" onclick={() => (shown += PAGE * 2)}>
				Show {formatCount(Math.min(PAGE * 2, rows.length - shown))} more
			</Button>
		</div>
	{/if}
</section>
