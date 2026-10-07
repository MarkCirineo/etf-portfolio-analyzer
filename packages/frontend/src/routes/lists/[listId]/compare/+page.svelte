<script lang="ts">
	import type { Snippet } from "svelte";
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import Pencil from "@lucide/svelte/icons/pencil";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import Button from "$lib/components/ui/button/button.svelte";
	import { compareHoldings, compareInputs, compareSets } from "$lib/compare";
	import { formatCurrency, formatMoney, formatPercent } from "$lib/format";
	import { request } from "$lib/request";
	import type { List, ListAnalysis, ListDetail } from "$lib/types";
	import { cn } from "$lib/utils";

	const scenarioId = $derived(page.params.listId ?? "");
	const againstParam = $derived(page.url.searchParams.get("against"));

	let lists = $state<List[]>([]);
	let scenario = $state<ListDetail | null>(null);
	let base = $state<ListDetail | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	/** Compare against the chosen list, else the main portfolio, else any other list. */
	const againstId = $derived(
		againstParam ??
			lists.find((list) => list.isPrimary && list.id !== scenarioId)?.id ??
			lists.find((list) => list.id !== scenarioId)?.id ??
			null
	);

	async function fetchJson<T>(path: string): Promise<T> {
		const response = await request(path);
		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(body?.message ?? "Failed to load");
		}
		return body.data as T;
	}

	$effect(() => {
		void fetchJson<List[]>("/list")
			.then((data) => (lists = data))
			.catch((err) => (error = err instanceof Error ? err.message : "Failed to load lists"));
	});

	$effect(() => {
		const scenarioKey = scenarioId;
		const againstKey = againstId;

		if (!againstKey) {
			if (lists.length) loading = false;
			return;
		}

		loading = true;
		error = null;

		void Promise.all([
			fetchJson<ListDetail>(`/list/${scenarioKey}/analysis`),
			fetchJson<ListDetail>(`/list/${againstKey}/analysis`)
		])
			.then(([scenarioDetail, baseDetail]) => {
				if (scenarioKey === scenarioId && againstKey === againstId) {
					scenario = scenarioDetail;
					base = baseDetail;
				}
			})
			.catch((err) => (error = err instanceof Error ? err.message : "Failed to load"))
			.finally(() => (loading = false));
	});

	const choose = (field: "listId" | "against", value: string) => {
		const against = field === "against" ? value : againstId;
		const listId = field === "listId" ? value : scenarioId;
		void goto(`/lists/${listId}/compare${against ? `?against=${against}` : ""}`, {
			replaceState: true,
			noScroll: true
		});
	};

	const nameOf = (detail: ListDetail | null) =>
		detail ? (detail.list.isPrimary ? "Main portfolio" : detail.list.name) : "";

	const largest = (analysis: ListAnalysis) => analysis.holdings[0] ?? null;

	const sectors = $derived(
		scenario && base
			? compareSets(base.analysis.breakdown.sectors, scenario.analysis.breakdown.sectors)
			: []
	);
	const regions = $derived(
		scenario && base
			? compareSets(base.analysis.breakdown.regions, scenario.analysis.breakdown.regions)
			: []
	);
	const inputs = $derived(
		scenario && base ? compareInputs(base.analysis, scenario.analysis) : []
	);
	const holdings = $derived(
		scenario && base
			? compareHoldings(base.analysis, scenario.analysis)
			: { shrink: [], grow: [] }
	);

	/** Sectors that actually move, biggest swings scaled to the full half-width. */
	const movingSectors = $derived(sectors.filter((row) => Math.abs(row.delta) >= 0.05));
	const maxSwing = $derived(Math.max(...movingSectors.map((row) => Math.abs(row.delta)), 0.1));
	const topSector = $derived(base?.analysis.breakdown.sectors.rows[0]?.name ?? null);
	const topSectorChange = $derived(sectors.find((row) => row.name === topSector) ?? null);

	const signed = (value: number, digits = 1) =>
		`${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
	const signedMoney = (value: number) =>
		`${value >= 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
</script>

<svelte:head>
	<title>Compare · ETF Portfolio Analyzer</title>
</svelte:head>

{#snippet delta(value: number, good: "up" | "down" | null, text: string)}
	<span
		class={cn(
			"font-mono text-[13px] font-medium tabular-nums",
			Math.abs(value) < 0.005
				? "text-muted-foreground"
				: good === null
					? "text-foreground"
					: value > 0 === (good === "up")
						? "text-blue-700 dark:text-blue-300"
						: "text-orange-700 dark:text-orange-300"
		)}>{text}</span
	>
{/snippet}

{#snippet stat(label: string, before: string, after: string, change: Snippet)}
	<div class="rounded-2xl border bg-card p-4">
		<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
		<p class="mt-2 flex flex-wrap items-baseline gap-x-2 font-mono tabular-nums">
			<span class="text-muted-foreground">{before}</span>
			<ArrowRight class="size-3.5 self-center text-muted-foreground" />
			<span class="text-xl font-semibold">{after}</span>
		</p>
		<p class="mt-1">{@render change()}</p>
	</div>
{/snippet}

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-16 pt-4 sm:px-6">
	<a
		href="/lists/{scenarioId}"
		class="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		Back to scenario
	</a>

	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
				Compare
			</p>
			<h1 class="mt-1 text-3xl font-semibold tracking-tight">
				{scenario ? nameOf(scenario) : "Scenario"} vs {base ? nameOf(base) : "…"}
			</h1>
			<p class="mt-1.5 text-muted-foreground">
				Shares of each portfolio, so the comparison holds even when the totals differ.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<label class="sr-only" for="compare-scenario">Scenario</label>
			<select
				id="compare-scenario"
				value={scenarioId}
				onchange={(event) => choose("listId", event.currentTarget.value)}
				class="min-h-11 rounded-lg border bg-card px-3 text-sm font-semibold"
			>
				{#each lists as list (list.id)}
					<option value={list.id}>{list.isPrimary ? "Main portfolio" : list.name}</option>
				{/each}
			</select>
			<span class="text-sm text-muted-foreground">against</span>
			<label class="sr-only" for="compare-against">Compare against</label>
			<select
				id="compare-against"
				value={againstId ?? ""}
				onchange={(event) => choose("against", event.currentTarget.value)}
				class="min-h-11 rounded-lg border bg-card px-3 text-sm font-semibold"
			>
				{#each lists.filter((list) => list.id !== scenarioId) as list (list.id)}
					<option value={list.id}>{list.isPrimary ? "Main portfolio" : list.name}</option>
				{/each}
			</select>
			<Button href="/lists/{scenarioId}/edit" class="min-h-11 gap-2 px-4">
				<Pencil class="size-4" />
				Edit scenario
			</Button>
		</div>
	</div>

	{#if error}
		<div
			class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
		>
			{error}
		</div>
	{:else if !loading && !againstId}
		<div class="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
			You need at least two lists to compare. <a
				href="/lists"
				class="font-medium text-indigo-700 dark:text-indigo-300">Create a scenario</a
			>.
		</div>
	{:else if loading || !scenario || !base}
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
			{#each Array(4) as _, index (index)}
				<div class="h-28 animate-pulse rounded-2xl bg-muted"></div>
			{/each}
		</div>
		<div class="h-96 animate-pulse rounded-2xl bg-muted"></div>
	{:else}
		{@const b = base.analysis}
		{@const s = scenario.analysis}
		{@const feeChange = s.breakdown.fees.expenseRatio - b.breakdown.fees.expenseRatio}
		{@const incomeChange = (s.breakdown.income.yield ?? 0) - (b.breakdown.income.yield ?? 0)}
		{@const baseTop = largest(b)}
		{@const scenarioTop = largest(s)}

		<section aria-label="What changes" class="grid grid-cols-2 gap-3 lg:grid-cols-4">
			{#snippet feeDelta()}
				{@render delta(
					-feeChange,
					"up",
					`${signed(feeChange, 3)} pts · ${signedMoney(s.breakdown.fees.annual - b.breakdown.fees.annual)} / yr`
				)}
			{/snippet}
			{@render stat(
				"Expense ratio",
				formatPercent(b.breakdown.fees.expenseRatio, 3),
				formatPercent(s.breakdown.fees.expenseRatio, 3),
				feeDelta
			)}
			{#snippet incomeDelta()}
				{@render delta(
					incomeChange,
					"up",
					`${signed(incomeChange, 2)} pts · ${signedMoney(s.breakdown.income.annual - b.breakdown.income.annual)} / yr`
				)}
			{/snippet}
			{@render stat(
				"Distribution yield",
				formatPercent(b.breakdown.income.yield),
				formatPercent(s.breakdown.income.yield),
				incomeDelta
			)}
			{#snippet sectorDelta()}
				{@render delta(
					topSectorChange?.delta ?? 0,
					null,
					`${signed(topSectorChange?.delta ?? 0)} pts`
				)}
			{/snippet}
			{@render stat(
				topSector ? `${topSector} weight` : "Largest sector",
				formatPercent(topSectorChange?.base ?? 0, 1),
				formatPercent(topSectorChange?.scenario ?? 0, 1),
				sectorDelta
			)}
			{#snippet companyDelta()}
				{@render delta(
					(scenarioTop?.percentOfPortfolio ?? 0) - (baseTop?.percentOfPortfolio ?? 0),
					"down",
					`${signed((scenarioTop?.percentOfPortfolio ?? 0) - (baseTop?.percentOfPortfolio ?? 0), 2)} pts`
				)}
			{/snippet}
			{@render stat(
				"Largest company",
				`${baseTop?.symbol ?? "—"} ${formatPercent(baseTop?.percentOfPortfolio, 1)}`,
				`${scenarioTop?.symbol ?? "—"} ${formatPercent(scenarioTop?.percentOfPortfolio, 1)}`,
				companyDelta
			)}
		</section>

		<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
			<section aria-labelledby="inputs-title" class="min-w-0 rounded-2xl border bg-card p-5">
				<h2 id="inputs-title" class="text-base font-semibold">Holdings in this scenario</h2>
				<p class="mt-1 text-[13px] text-muted-foreground">
					<span class="font-mono tabular-nums">{formatMoney(b.totalValue)}</span>
					<ArrowRight class="inline size-3" />
					<span class="font-mono tabular-nums">{formatMoney(s.totalValue)}</span> in total
				</p>
				<ul class="mt-3 flex flex-col">
					{#each inputs as input (input.symbol)}
						<li
							class="flex items-center justify-between gap-3 border-b py-3 last:border-b-0"
						>
							<span class="font-semibold">{input.symbol}</span>
							<span
								class="flex flex-wrap items-center justify-end gap-x-2 font-mono text-[13px] tabular-nums"
							>
								{#if input.status === "unchanged"}
									<span>{formatMoney(input.base)}</span>
									<span
										class="rounded-full bg-muted px-2 py-0.5 font-sans text-xs text-muted-foreground"
										>Unchanged</span
									>
								{:else if input.status === "added"}
									<span>{formatMoney(input.scenario)}</span>
									<span
										class="rounded-full bg-blue-100 px-2 py-0.5 font-sans text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300"
										>Added</span
									>
								{:else if input.status === "removed"}
									<span class="text-muted-foreground line-through"
										>{formatMoney(input.base)}</span
									>
									<span
										class="rounded-full bg-orange-100 px-2 py-0.5 font-sans text-xs font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-300"
										>Removed</span
									>
								{:else}
									<span class="text-muted-foreground"
										>{formatMoney(input.base)}</span
									>
									<ArrowRight class="size-3 text-muted-foreground" />
									<span>{formatMoney(input.scenario)}</span>
									{@render delta(
										(input.scenario ?? 0) - (input.base ?? 0),
										null,
										signedMoney((input.scenario ?? 0) - (input.base ?? 0))
									)}
								{/if}
							</span>
						</li>
					{/each}
				</ul>
				{#if regions.some((row) => Math.abs(row.delta) >= 0.1)}
					<div
						class="mt-4 rounded-xl bg-muted/70 px-3.5 py-3 text-[13px] text-muted-foreground"
					>
						<p class="mb-1.5 font-medium text-foreground">Regions</p>
						<ul class="grid grid-cols-2 gap-x-4 gap-y-1">
							{#each [...regions]
								.sort((x, y) => y.base - x.base)
								.slice(0, 6) as row (row.name)}
								<li class="flex justify-between gap-2">
									<span class="truncate">{row.name}</span>
									<span class="font-mono tabular-nums"
										>{row.base.toFixed(1)} →
										<span class="text-foreground"
											>{row.scenario.toFixed(1)}</span
										></span
									>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</section>

			<section
				aria-labelledby="sector-shift-title"
				class="min-w-0 rounded-2xl border bg-card p-5"
			>
				<div class="flex flex-wrap items-end justify-between gap-2">
					<div>
						<h2 id="sector-shift-title" class="text-base font-semibold">
							Sector shift
						</h2>
						<p class="mt-1 text-[13px] text-muted-foreground">
							Percentage points of the portfolio, scenario minus {base.list.isPrimary
								? "main"
								: base.list.name}
						</p>
					</div>
					<div class="flex gap-4 text-xs text-muted-foreground">
						<span class="flex items-center gap-1.5"
							><span class="size-2.5 rounded-[3px] bg-orange-600"></span>Less</span
						>
						<span class="flex items-center gap-1.5"
							><span class="size-2.5 rounded-[3px] bg-blue-700 dark:bg-blue-400"
							></span>More</span
						>
					</div>
				</div>
				{#if movingSectors.length === 0}
					<p class="mt-4 rounded-xl bg-muted/70 p-4 text-[13px] text-muted-foreground">
						Sector weights are the same in both.
					</p>
				{:else}
					<ul class="mt-4 flex flex-col gap-2">
						{#each movingSectors as row (row.name)}
							<li
								class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_7rem] items-center gap-3 text-[13px]"
							>
								<span class="truncate" title={row.name}>{row.name}</span>
								<span class="relative h-3">
									<span class="absolute inset-y-0 left-1/2 w-px bg-border"></span>
									<span
										class={cn(
											"absolute inset-y-0 rounded-sm",
											row.delta < 0
												? "right-1/2 bg-orange-600"
												: "left-1/2 bg-blue-700 dark:bg-blue-400"
										)}
										style:width="{(Math.abs(row.delta) / maxSwing) * 50}%"
									></span>
								</span>
								<span class="text-right font-mono tabular-nums">
									<span class="font-semibold">{signed(row.delta)}</span>
									<span class="text-muted-foreground">
										{row.base.toFixed(1)}→{row.scenario.toFixed(1)}</span
									>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<div class="grid gap-6 md:grid-cols-2">
			{#each [{ key: "shrink", title: "Companies that shrink", rows: holdings.shrink }, { key: "grow", title: "Companies that grow", rows: holdings.grow }] as group (group.key)}
				<section
					aria-labelledby="{group.key}-title"
					class="min-w-0 rounded-2xl border bg-card p-5"
				>
					<h2 id="{group.key}-title" class="text-base font-semibold">{group.title}</h2>
					<p class="mt-1 text-[13px] text-muted-foreground">
						Share of the portfolio, looking through every fund
					</p>
					{#if group.rows.length === 0}
						<p class="mt-4 text-[13px] text-muted-foreground">None.</p>
					{:else}
						<ul class="mt-3 flex flex-col">
							{#each group.rows as row (row.id)}
								<li
									class="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
								>
									<span class="min-w-0">
										<span class="font-semibold">{row.symbol}</span>
										<span class="block truncate text-xs text-muted-foreground"
											>{row.name ?? ""}</span
										>
									</span>
									<span
										class="flex shrink-0 items-center gap-2 font-mono text-[13px] tabular-nums"
									>
										<span class="text-muted-foreground"
											>{formatPercent(row.base)}</span
										>
										<ArrowRight class="size-3 text-muted-foreground" />
										<span>{formatPercent(row.scenario)}</span>
										{@render delta(
											row.delta,
											null,
											`${signed(row.delta, 2)} pts`
										)}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>
			{/each}
		</div>

		<p class="text-xs text-muted-foreground">
			Both use today's prices and the same holdings data. Nothing is traded. Fees:
			{formatCurrency(b.breakdown.fees.annual)} → {formatCurrency(s.breakdown.fees.annual)} a year.
		</p>
	{/if}
</div>
