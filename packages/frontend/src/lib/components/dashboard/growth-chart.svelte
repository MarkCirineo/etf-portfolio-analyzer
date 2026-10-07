<script lang="ts">
	import { formatMoney, formatMonth, formatPercent } from "$lib/format";
	import type { PortfolioBreakdown } from "$lib/types";

	let { backtest }: { backtest: NonNullable<PortfolioBreakdown["backtest"]> } = $props();

	const WIDTH = 600;
	const HEIGHT = 220;
	const LEFT = 44;
	const RIGHT = 590;
	const TOP = 12;
	const BOTTOM = 190;

	const points = $derived(backtest.points);
	const last = $derived(points[points.length - 1]);
	const totalReturn = $derived(last ? (last.value / 10000 - 1) * 100 : 0);

	/** Gridlines at round dollar steps. */
	const ticks = $derived.by(() => {
		const max = Math.max(...points.map((point) => point.value), 10000);
		const min = Math.min(...points.map((point) => point.value), 10000);
		const rough = (max - min) / 4;
		const magnitude = 10 ** Math.floor(Math.log10(rough || 1));
		const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
		const start = Math.floor(min / step) * step;
		const values: number[] = [];
		for (let value = start; value <= max + step * 0.01; value += step) {
			values.push(value);
		}
		if (values[values.length - 1] < max) {
			values.push(values[values.length - 1] + step);
		}
		return values;
	});

	const yMin = $derived(ticks[0]);
	const yMax = $derived(ticks[ticks.length - 1]);

	const x = (index: number) => LEFT + (index / Math.max(points.length - 1, 1)) * (RIGHT - LEFT);
	const y = (value: number) => BOTTOM - ((value - yMin) / (yMax - yMin || 1)) * (BOTTOM - TOP);

	const line = $derived(
		points
			.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
			.join(" ")
	);
	const area = $derived(`${LEFT},${BOTTOM} ${line} ${RIGHT},${BOTTOM}`);

	/** One label per few years, on January. */
	const years = $derived.by(() => {
		const januaries = points
			.map((point, index) => ({ month: point.month, index }))
			.filter((entry) => entry.month.endsWith("-01"));
		const every = Math.max(Math.ceil(januaries.length / 6), 1);
		return januaries.filter((_, index) => index % every === 0);
	});

	let hover = $state<number | null>(null);

	const track = (event: PointerEvent) => {
		const svg = event.currentTarget as SVGSVGElement;
		const box = svg.getBoundingClientRect();
		const svgX = ((event.clientX - box.left) / box.width) * WIDTH;
		const index = Math.round(((svgX - LEFT) / (RIGHT - LEFT)) * (points.length - 1));
		hover = Math.min(Math.max(index, 0), points.length - 1);
	};

	const hovered = $derived(hover !== null ? points[hover] : null);
	const yLabel = (value: number) =>
		value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${Math.round(value)}`;
</script>

<section aria-labelledby="growth-title" class="min-w-0 rounded-2xl border bg-card p-5">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<h2 id="growth-title" class="text-base font-semibold">Growth of $10,000</h2>
				<span
					class="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
				>
					Backtest of your current mix
				</span>
			</div>
			<p class="mt-1 text-[13px] text-muted-foreground">
				{formatMonth(backtest.start)} – {formatMonth(backtest.end)} · starts at {backtest.limitedBy}'s
				launch · rebalanced monthly · not your actual returns
			</p>
		</div>
		<div class="ml-auto text-right">
			<div class="font-mono text-xl font-semibold tabular-nums">
				{formatMoney(hovered?.value ?? last?.value)}
			</div>
			<div class="font-mono text-[13px] tabular-nums text-muted-foreground">
				{#if hovered}
					{formatMonth(hovered.month)}
				{:else}
					{totalReturn >= 0 ? "+" : ""}{formatPercent(
						totalReturn,
						0
					)}{backtest.annualizedReturn !== null
						? ` · ${formatPercent(backtest.annualizedReturn, 1)} a year`
						: ""}
				{/if}
			</div>
		</div>
	</div>

	<svg
		viewBox="0 0 {WIDTH} {HEIGHT}"
		role="img"
		aria-label={`Line chart: $10,000 grows to ${formatMoney(last?.value)} between ${formatMonth(backtest.start)} and ${formatMonth(backtest.end)}`}
		class="mt-3 block h-auto w-full touch-none"
		onpointermove={track}
		onpointerleave={() => (hover = null)}
	>
		<g class="stroke-border" stroke-width="1">
			{#each ticks as tick (tick)}
				<line x1={LEFT} x2={RIGHT} y1={y(tick)} y2={y(tick)}></line>
			{/each}
		</g>
		<g class="fill-muted-foreground font-mono" font-size="10" text-anchor="end">
			{#each ticks as tick (tick)}
				<text x={LEFT - 6} y={y(tick) + 3}>{yLabel(tick)}</text>
			{/each}
		</g>
		<g class="fill-muted-foreground font-mono" font-size="10" text-anchor="middle">
			{#each years as entry (entry.month)}
				<text x={x(entry.index)} y={HEIGHT - 6}>{entry.month.slice(0, 4)}</text>
			{/each}
		</g>
		<polygon points={area} class="fill-indigo-700 dark:fill-indigo-400" fill-opacity="0.08"
		></polygon>
		<polyline
			points={line}
			fill="none"
			class="stroke-indigo-700 dark:stroke-indigo-400"
			stroke-width="2.5"
			stroke-linejoin="round"
			stroke-linecap="round"
		></polyline>
		{#if hover !== null && hovered}
			<line
				x1={x(hover)}
				x2={x(hover)}
				y1={TOP}
				y2={BOTTOM}
				class="stroke-muted-foreground"
				stroke-dasharray="3 3"
			></line>
			<circle
				cx={x(hover)}
				cy={y(hovered.value)}
				r="4.5"
				class="fill-indigo-700 dark:fill-indigo-400"
			></circle>
		{:else if last}
			<circle
				cx={x(points.length - 1)}
				cy={y(last.value)}
				r="4"
				class="fill-indigo-700 dark:fill-indigo-400"
			></circle>
		{/if}
	</svg>
	{#if backtest.coveredPercent < 99}
		<p class="mt-2 text-xs text-muted-foreground">
			Covers the <span class="font-mono tabular-nums"
				>{formatPercent(backtest.coveredPercent, 0)}</span
			>
			of your portfolio that has fund history; stocks held directly are left out.
		</p>
	{/if}
</section>
