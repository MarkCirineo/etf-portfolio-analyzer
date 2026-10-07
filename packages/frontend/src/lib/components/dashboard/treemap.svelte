<script lang="ts">
	import { mainSource, squarify } from "$lib/dashboard";
	import { formatMoney, formatPercent } from "$lib/format";
	import type { AnalyzedHolding, ListAnalysis } from "$lib/types";
	import { cn } from "$lib/utils";

	let {
		analysis,
		colors,
		onopen
	}: {
		analysis: ListAnalysis;
		colors: Map<string, string>;
		onopen: (holding: AnalyzedHolding) => void;
	} = $props();

	// Laid out for the box's real size (a wide shape until it has been measured), then
	// drawn in percentages of it
	let boxWidth = $state(0);
	let boxHeight = $state(0);
	const width = $derived(boxWidth || 1000);
	const height = $derived(boxHeight || 440);

	// Fewer, larger tiles on a phone
	const top = $derived(analysis.holdings.slice(0, boxWidth > 0 && boxWidth < 640 ? 12 : 20));
	const topExposure = $derived(top.reduce((sum, holding) => sum + holding.exposure, 0));
	const topPercent = $derived(top.reduce((sum, holding) => sum + holding.percentOfPortfolio, 0));

	/** How much label a tile has room for, from its size in pixels. */
	const labelSize = (tileWidth: number, tileHeight: number) =>
		tileWidth >= 150 && tileHeight >= 136
			? "lg"
			: tileWidth >= 84 && tileHeight >= 84
				? "md"
				: tileWidth >= 46 && tileHeight >= 36
					? "sm"
					: "xs";

	const tiles = $derived(
		squarify(top, (holding) => holding.exposure, width, height).map((tile) => {
			const source = mainSource(tile.item);
			return {
				...tile,
				source,
				color: colors.get(source) ?? "#3F3F46",
				size: labelSize(tile.width, tile.height)
			};
		})
	);

	const legend = $derived(
		Array.from(new Set(tiles.map((tile) => tile.source))).map((symbol) => ({
			symbol,
			color: colors.get(symbol) ?? "#3F3F46"
		}))
	);

	const hasForeign = $derived(top.some((holding) => !holding.usListed));
</script>

<section
	aria-labelledby="treemap-title"
	class="flex min-w-0 flex-col rounded-2xl border bg-card p-5"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 id="treemap-title" class="text-base font-semibold">Top {top.length} holdings</h2>
			<p class="mt-1 text-[13px] text-muted-foreground">
				Sized by dollar exposure · <span class="font-mono tabular-nums"
					>{formatMoney(topExposure)}</span
				>
				· <span class="font-mono tabular-nums">{formatPercent(topPercent, 1)}</span> of your
				portfolio
			</p>
		</div>
		<ul
			aria-label="Colour shows the fund each mostly comes from"
			class="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground"
		>
			{#each legend as entry (entry.symbol)}
				<li class="flex items-center gap-1.5">
					<span class="size-2.5 rounded-[3px]" style:background={entry.color}></span>
					{entry.symbol}
				</li>
			{/each}
		</ul>
	</div>

	<div
		bind:clientWidth={boxWidth}
		bind:clientHeight={boxHeight}
		class="relative mt-4 aspect-[4/5] w-full overflow-hidden rounded-xl sm:aspect-[1000/440] sm:max-h-[440px] xl:aspect-auto xl:max-h-none xl:min-h-[420px] xl:flex-1"
	>
		{#each tiles as tile (tile.item.id)}
			{@const holding = tile.item}
			<button
				type="button"
				onclick={() => onopen(holding)}
				aria-label={`${holding.symbol}, ${formatMoney(holding.exposure)}, ${formatPercent(holding.percentOfPortfolio)} — open details`}
				class={cn(
					"absolute flex flex-col justify-between overflow-hidden rounded-lg border-2 border-card text-left text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					!holding.usListed && "border-dashed",
					tile.size === "lg" ? "p-4" : tile.size === "md" ? "p-3" : "p-1.5"
				)}
				style:left="{(tile.x / width) * 100}%"
				style:top="{(tile.y / height) * 100}%"
				style:width="{(tile.width / width) * 100}%"
				style:height="{(tile.height / height) * 100}%"
				style:background={tile.color}
			>
				{#if tile.size !== "xs"}
					<span class="min-w-0">
						<span
							class={cn(
								"block truncate font-bold",
								tile.size === "lg"
									? "text-2xl tracking-tight"
									: tile.size === "md"
										? "text-lg"
										: "text-xs"
							)}>{holding.symbol}</span
						>
						{#if tile.size === "lg" && holding.name}
							<span class="block truncate text-[13px] opacity-85">{holding.name}</span
							>
						{/if}
					</span>
					<span class="min-w-0 font-mono tabular-nums">
						<span
							class={cn(
								"block truncate font-semibold",
								tile.size === "lg"
									? "text-xl"
									: tile.size === "md"
										? "text-sm"
										: "text-[11px]"
							)}>{formatMoney(holding.exposure)}</span
						>
						{#if tile.size !== "sm"}
							<span class="block truncate text-xs opacity-85"
								>{formatPercent(holding.percentOfPortfolio)}</span
							>
						{/if}
					</span>
				{/if}
			</button>
		{/each}
	</div>
	<p class="mt-3 text-xs text-muted-foreground">
		Colour shows the fund each holding mostly comes from.{hasForeign
			? " Dashed outline: listed abroad, so it has exposure but no share count."
			: ""} Select a tile for details.
	</p>
</section>
