<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { ArrowLeft, Pencil, RefreshCw } from "@lucide/svelte";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { request } from "$lib/request";
	import Button from "$lib/components/ui/button/button.svelte";
	import type { List, ListAnalysis, ListDetail } from "$lib/types";

	let list: List | null = $state(null);
	let analysis: ListAnalysis | null = $state(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showAllHoldings = $state(false);

	const fetchListDetail = async () => {
		loading = true;
		error = null;

		const { listId } = page.params;

		if (!listId) {
			error = "List id is missing from the URL.";
			loading = false;
			return;
		}

		try {
			const response = await request(`/list/${listId}/analysis`, {
				method: "GET"
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.message ?? "Failed to load list");
			}

			const body = (await response.json()) as { data?: ListDetail };

			if (!body?.data?.list) {
				throw new Error("List data was not returned by the server");
			}

			list = body.data.list;
			analysis = body.data.analysis;
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to load list";
			error = message;
			toast.error(message);
		} finally {
			loading = false;
		}
	};

	onMount(() => {
		fetchListDetail();
	});

	const formatDate = (value?: string) => {
		if (!value) return "-";

		return new Date(value).toLocaleString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit"
		});
	};

	const formatShares = (value?: number) => {
		if (typeof value !== "number" || Number.isNaN(value)) {
			return "-";
		}

		return value.toLocaleString("en-US", {
			minimumFractionDigits: 4,
			maximumFractionDigits: 4
		});
	};

	const handleBack = () => {
		goto("/lists");
	};

	const handleEdit = () => {
		if (!list?.id) {
			return;
		}

		goto(`/lists/${list.id}/edit`);
	};

	const getDisplayedHoldings = () => {
		if (!analysis?.holdings) return [];
		return showAllHoldings ? analysis.holdings : analysis.holdings.slice(0, 15);
	};

	const hasMoreHoldings = () => {
		return (analysis?.holdings?.length || 0) > 15;
	};
</script>

<div class="container mx-auto max-w-5xl px-4 py-8">
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<Button
				variant="ghost"
				class="gap-2 px-0 text-zinc-600 dark:text-zinc-300"
				onclick={handleBack}
			>
				<ArrowLeft class="size-4" />
				Back to Lists
			</Button>
			<h1 class="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
				{list?.name || "Portfolio List"}
			</h1>
			<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
				Last updated {formatDate(list?.updatedAt)}
			</p>
		</div>
		<div class="flex gap-2">
			<Button class="gap-2" onclick={handleEdit} disabled={!list}>
				<Pencil class="size-4" />
				Edit List
			</Button>
			<Button variant="outline" class="gap-2" onclick={fetchListDetail} disabled={loading}>
				<RefreshCw class={`size-4 ${loading ? "animate-spin" : ""}`} />
				Refresh
			</Button>
		</div>
	</div>

	{#if loading}
		<div
			class="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700"
		>
			<p class="text-sm text-zinc-600 dark:text-zinc-400">Crunching numbers...</p>
		</div>
	{:else if error}
		<div
			class="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100"
		>
			<p class="text-sm">{error}</p>
			<Button variant="outline" size="sm" class="mt-4" onclick={fetchListDetail}
				>Try again</Button
			>
		</div>
	{:else if !list}
		<div
			class="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700"
		>
			<p class="text-sm text-zinc-600 dark:text-zinc-400">This list could not be found.</p>
		</div>
	{:else}
		<div class="space-y-6">
			<div
				class="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
			>
				<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
							Effective Stock Exposure
						</h2>
						<p class="text-sm text-zinc-500 dark:text-zinc-400">
							{analysis
								? `Generated ${formatDate(analysis.generatedAt)}`
								: "No analysis has been generated yet"}
						</p>
					</div>
					<div class="text-sm text-zinc-500 dark:text-zinc-400">
						{analysis?.holdings?.length || 0} symbols
					</div>
				</div>

				<div class="mt-4 overflow-x-auto">
					<table class="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
						<thead>
							<tr
								class="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
							>
								<th class="px-4 py-2">Symbol</th>
								<th class="px-4 py-2">Name</th>
								<th class="px-4 py-2">Total Shares</th>
								<th class="px-4 py-2">Direct Shares</th>
								<th class="px-4 py-2">Via ETFs</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
							{#if analysis?.holdings?.length}
								{#each getDisplayedHoldings() as holding}
									<tr class="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
										<td
											class="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100"
										>
											{holding.symbol}
										</td>
										<td class="px-4 py-3 text-zinc-600 dark:text-zinc-400">
											{holding.name || "-"}
										</td>
										<td class="px-4 py-3 text-zinc-700 dark:text-zinc-300">
											{formatShares(holding.totalShares)}
										</td>
										<td class="px-4 py-3 text-zinc-700 dark:text-zinc-300">
											{formatShares(holding.directShares)}
										</td>
										<td class="px-4 py-3 text-zinc-600 dark:text-zinc-400">
											{holding.viaEtfs.length === 0
												? "Direct only"
												: holding.viaEtfs.join(", ")}
										</td>
									</tr>
								{/each}
							{:else}
								<tr>
									<td
										class="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
										colspan="5"
									>
										No effective stock exposure calculated yet.
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>

				{#if hasMoreHoldings()}
					<div class="mt-4 flex justify-center">
						<Button
							variant="outline"
							onclick={() => (showAllHoldings = !showAllHoldings)}
						>
							{showAllHoldings
								? "Show Less"
								: `View All (${analysis?.holdings?.length || 0} total)`}
						</Button>
					</div>
				{/if}

				{#if analysis?.failedTickers?.length}
					<div
						class="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
					>
						Some ETFs could not be decomposed: {analysis.failedTickers.join(", ")}
					</div>
				{/if}

				{#if analysis?.usedPlaceholders?.length}
					<p class="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
						Placeholder weights were used for: {analysis.usedPlaceholders.join(", ")}.
					</p>
				{/if}
			</div>

			<div
				class="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
			>
				<h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
					Original Holdings
				</h2>
				<p class="text-sm text-zinc-500 dark:text-zinc-400">
					These are the raw inputs stored on the list before any ETF decomposition.
				</p>
				<div class="mt-4 overflow-x-auto">
					<table class="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
						<thead>
							<tr
								class="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
							>
								<th class="px-4 py-2">Ticker</th>
								<th class="px-4 py-2">Shares</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
							{#each Object.entries(list.content || {}) as [ticker, shares]}
								<tr class="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
									<td
										class="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100"
										>{ticker}</td
									>
									<td class="px-4 py-3 text-zinc-700 dark:text-zinc-300"
										>{formatShares(shares)}</td
									>
								</tr>
							{:else}
								<tr>
									<td
										class="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
										colspan="2"
									>
										This list has no holdings yet.
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	{/if}
</div>
