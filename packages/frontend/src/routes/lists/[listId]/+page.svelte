<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { ArrowLeft, Pencil, RefreshCw } from "@lucide/svelte";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { io, type Socket } from "socket.io-client";

	import { API_BASE_URL, request } from "$lib/request";
	import Button from "$lib/components/ui/button/button.svelte";
	import type { AnalyzedHolding, List, ListAnalysis, ListDetail, PriceStatus } from "$lib/types";

	const PREVIEW_ROWS = 15;

	let list: List | null = $state(null);
	let analysis: ListAnalysis | null = $state(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let showAllHoldings = $state(false);
	let socket: Socket | null = null;

	const disconnectSocket = () => {
		if (socket) {
			const { listId } = page.params;
			if (listId) {
				socket.emit("list:unsubscribe", { listId });
			}
			socket.disconnect();
			socket = null;
		}
	};

	const getSocketUrl = (): string | null => {
		if (!API_BASE_URL) {
			return null;
		}

		// A full URL points at the API host; a relative path means same origin
		if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
			try {
				return new URL(API_BASE_URL).origin;
			} catch {
				return API_BASE_URL;
			}
		}

		return typeof window !== "undefined" ? window.location.origin : API_BASE_URL;
	};

	const applyAnalysis = (incoming: ListAnalysis) => {
		// The HTTP response and the first socket push can race; keep the newer one
		if (analysis && incoming.generatedAt < analysis.generatedAt) {
			return;
		}

		analysis = incoming;
	};

	const ensureSocket = (listId: string) => {
		if (socket) {
			if (socket.connected) {
				socket.emit("list:subscribe", { listId });
			}
			return socket;
		}

		const socketUrl = getSocketUrl();
		if (!socketUrl) {
			return null;
		}

		socket = io(socketUrl, {
			withCredentials: true,
			transports: ["websocket", "polling"]
		});

		socket.on("connect_error", (err) => {
			console.error("Socket connection error:", err?.message);
		});

		socket.on("connect", () => {
			socket?.emit("list:subscribe", { listId });
		});

		socket.on("list:analysis:update", (payload: { listId: string; analysis: ListAnalysis }) => {
			if (payload.listId === listId) {
				applyAnalysis(payload.analysis);
			}
		});

		return socket;
	};

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
			const response = await request(`/list/${listId}/analysis`, { method: "GET" });

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.message ?? "Failed to load list");
			}

			const body = (await response.json()) as { data?: ListDetail };

			if (!body?.data?.list) {
				throw new Error("List data was not returned by the server");
			}

			list = body.data.list;
			applyAnalysis(body.data.analysis);
			ensureSocket(listId);
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

	onDestroy(() => {
		disconnectSocket();
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

	const formatTime = (value?: string) => {
		if (!value) return "-";

		return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
	};

	const formatCurrency = (value: number | null | undefined) => {
		if (typeof value !== "number" || Number.isNaN(value)) {
			return "—";
		}

		return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
	};

	const formatPercent = (value: number | null | undefined, digits = 2) => {
		if (typeof value !== "number" || Number.isNaN(value)) {
			return "—";
		}

		return `${value.toFixed(digits)}%`;
	};

	const formatShares = (value: number | null | undefined) => {
		if (typeof value !== "number" || Number.isNaN(value)) {
			return "—";
		}

		return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
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

	const getDisplayedHoldings = (): AnalyzedHolding[] => {
		if (!analysis?.holdings) return [];
		return showAllHoldings ? analysis.holdings : analysis.holdings.slice(0, PREVIEW_ROWS);
	};

	const hasMoreHoldings = () => {
		return (analysis?.holdings?.length || 0) > PREVIEW_ROWS;
	};

	const isPricing = () => {
		return (analysis?.quotes.pending ?? 0) > 0 || analysis?.totalValueComplete === false;
	};

	const pricedFraction = () => {
		const quotes = analysis?.quotes;
		if (!quotes || quotes.requested === 0) return 1;
		return quotes.priced / quotes.requested;
	};

	const largestPercent = () => {
		return analysis?.holdings?.[0]?.percentOfPortfolio || 0;
	};

	const barWidth = (percent: number) => {
		const largest = largestPercent();
		return largest > 0 ? `${Math.max((percent / largest) * 100, 1)}%` : "0%";
	};

	const foreignListedCount = () => {
		return analysis?.holdings.filter((holding) => !holding.usListed).length ?? 0;
	};

	/** ETFs whose holdings data is materially incomplete, worst first. */
	const poorlyCoveredInputs = () => {
		return (
			analysis?.inputs
				.filter((input) => input.weightCovered !== null && input.weightCovered < 95)
				.sort((a, b) => (a.weightCovered ?? 0) - (b.weightCovered ?? 0)) ?? []
		);
	};

	const leveragedInputs = () => {
		return (
			analysis?.inputs.filter((input) => input.leveraged).map((input) => input.symbol) ?? []
		);
	};

	const priceNote = (status: PriceStatus) => {
		switch (status) {
			case "stale":
				return "stale";
			case "pending":
				return "loading";
			case "unavailable":
				return "unavailable";
			case "not-requested":
				return "not priced";
			case "foreign-listing":
				return "foreign listing";
			default:
				return "";
		}
	};
</script>

<div class="container mx-auto max-w-6xl px-4 py-8">
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
	{:else if !list || !analysis}
		<div
			class="rounded-lg border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700"
		>
			<p class="text-sm text-zinc-600 dark:text-zinc-400">This list could not be found.</p>
		</div>
	{:else}
		<div class="space-y-6">
			<!-- Summary -->
			<div class="grid gap-4 md:grid-cols-3">
				<div
					class="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
				>
					<p
						class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
					>
						Portfolio value
					</p>
					<p class="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
						{formatCurrency(analysis.totalValue)}
					</p>
					<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
						{#if !analysis.totalValueComplete}
							Pricing your holdings…
						{:else}
							{analysis.inputs.length} holding{analysis.inputs.length === 1
								? ""
								: "s"} · market {analysis.marketOpen ? "open" : "closed"}
						{/if}
					</p>
				</div>
				<div
					class="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
				>
					<p
						class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
					>
						Look-through
					</p>
					<p class="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
						{(analysis.holdings.length + analysis.tail.count).toLocaleString("en-US")} securities
					</p>
					<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
						{#if analysis.unaccounted.percentOfPortfolio >= 1}
							<span class="text-amber-700 dark:text-amber-400">
								{formatPercent(analysis.unaccounted.percentOfPortfolio, 1)} not covered
								by holdings data
							</span>
						{:else}
							{formatPercent(analysis.cashAndOther.percentOfPortfolio, 1)} cash &amp; other
						{/if}
					</p>
				</div>
				<div
					class="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
				>
					<p
						class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
					>
						Prices
					</p>
					{#if isPricing()}
						<p
							class="mt-1 flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-zinc-100"
						>
							<RefreshCw class="size-5 animate-spin text-zinc-400" />
							{analysis.quotes.priced} / {analysis.quotes.requested}
						</p>
						<div class="mt-2 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
							<div
								class="h-1.5 rounded-full bg-blue-500 transition-all"
								style={`width: ${pricedFraction() * 100}%`}
							></div>
						</div>
						<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
							Share counts fill in as prices arrive
						</p>
					{:else}
						<p class="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
							{analysis.quotes.stale > 0 ? "Refreshing" : "Up to date"}
						</p>
						<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
							{#if analysis.quotes.stale > 0}
								{analysis.quotes.stale} of {analysis.quotes.priced} prices are being
								refreshed
							{:else}
								{analysis.quotes.priced} priced · as of {formatTime(
									analysis.generatedAt
								)}
							{/if}
						</p>
					{/if}
				</div>
			</div>

			<!-- Notices -->
			{#if analysis.failedTickers.length}
				<div
					class="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
				>
					Holdings could not be looked up for {analysis.failedTickers.join(", ")}. Until
					that resolves they are treated as directly held shares.
				</div>
			{/if}

			{#if analysis.unaccounted.percentOfPortfolio >= 1}
				<div
					class="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
				>
					<p>
						<strong
							>{formatPercent(analysis.unaccounted.percentOfPortfolio)} of this portfolio
							({formatCurrency(analysis.unaccounted.exposure)}) is missing from the
							breakdown below.</strong
						>
						This is weight the fund did not attribute to a named position, or that the holdings
						provider did not report.
					</p>
					{#if poorlyCoveredInputs().length}
						<ul class="mt-2 space-y-0.5">
							{#each poorlyCoveredInputs() as input (input.symbol)}
								<li>
									{input.symbol}: only {formatPercent(input.weightCovered ?? 0)} of
									the fund accounted for
									{#if analysis.unaccounted.byInput.find((i) => i.symbol === input.symbol)}
										· {formatCurrency(
											analysis.unaccounted.byInput.find(
												(i) => i.symbol === input.symbol
											)?.exposure ?? 0
										)} unaccounted
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}

			{#if leveragedInputs().length}
				<div
					class="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
				>
					{leveragedInputs().join(", ")}
					{leveragedInputs().length === 1
						? "is a leveraged fund"
						: "are leveraged funds"}. The look-through reflects what the fund physically
					holds (mostly cash and swaps), not its multiplied index exposure.
				</div>
			{/if}

			{#if analysis.quoteFailures.length && !isPricing()}
				<div
					class="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-100"
				>
					No price available for {analysis.quoteFailures.join(", ")}. Exposure is still
					counted; share counts for these are unknown.
				</div>
			{/if}

			<!-- Inputs -->
			<div
				class="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
			>
				<h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
					Your holdings
				</h2>
				<p class="text-sm text-zinc-500 dark:text-zinc-400">
					What you entered, priced. ETFs are broken down below.
				</p>
				<div class="mt-4 overflow-x-auto">
					<table class="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
						<thead>
							<tr
								class="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
							>
								<th class="px-4 py-2">Symbol</th>
								<th class="px-4 py-2">Type</th>
								<th class="px-4 py-2 text-right">Shares</th>
								<th class="px-4 py-2 text-right">Price</th>
								<th class="px-4 py-2 text-right">Value</th>
								<th class="px-4 py-2 text-right">% of portfolio</th>
								<th class="px-4 py-2">Holdings</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
							{#each analysis.inputs as input (input.symbol)}
								<tr class="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
									<td
										class="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100"
									>
										{input.symbol}
									</td>
									<td class="px-4 py-3 text-zinc-600 dark:text-zinc-400">
										{#if input.kind === "etf"}
											ETF{input.leveraged ? " · leveraged" : ""}
										{:else if input.kind === "stock"}
											Stock
										{:else}
											Unknown
										{/if}
									</td>
									<td
										class="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300"
									>
										{formatShares(input.shares)}
									</td>
									<td
										class="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300"
									>
										{formatCurrency(input.price)}
										{#if priceNote(input.priceStatus)}
											<span class="ml-1 text-xs text-zinc-400"
												>{priceNote(input.priceStatus)}</span
											>
										{/if}
									</td>
									<td
										class="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300"
									>
										{formatCurrency(input.value)}
									</td>
									<td
										class="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300"
									>
										{formatPercent(input.percentOfPortfolio)}
									</td>
									<td class="px-4 py-3 text-zinc-600 dark:text-zinc-400">
										{#if input.holdingsCount !== null}
											{input.holdingsCount.toLocaleString("en-US")}
											{#if input.holdingsAsOf}
												<span class="text-xs text-zinc-400"
													>as of {input.holdingsAsOf}</span
												>
											{/if}
											{#if input.weightCovered !== null && input.weightCovered < 95}
												<div
													class="text-xs text-amber-700 dark:text-amber-400"
												>
													{formatPercent(input.weightCovered)} of fund covered
												</div>
											{/if}
										{:else}
											—
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

			<!-- Look-through -->
			<div
				class="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
			>
				<div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
							Effective stock exposure
						</h2>
						<p class="text-sm text-zinc-500 dark:text-zinc-400">
							Every security you own, directly or through your ETFs, by dollar
							exposure.
							{#if foreignListedCount() > 0}
								<span class="block">
									{foreignListedCount().toLocaleString("en-US")} are listed on foreign
									exchanges, so they show exposure but no share count.
								</span>
							{/if}
						</p>
					</div>
					<div class="text-sm text-zinc-500 dark:text-zinc-400">
						Generated {formatTime(analysis.generatedAt)}
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
								<th class="px-4 py-2 text-right">Exposure</th>
								<th class="px-4 py-2">% of portfolio</th>
								<th class="px-4 py-2 text-right">Shares</th>
								<th class="px-4 py-2 text-right">Price</th>
								<th class="px-4 py-2">Via</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
							{#each getDisplayedHoldings() as holding (holding.symbol)}
								<tr class="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
									<td
										class="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100"
									>
										{holding.symbol}
									</td>
									<td
										class="max-w-56 truncate px-4 py-3 text-zinc-600 dark:text-zinc-400"
									>
										{holding.name || "—"}
									</td>
									<td
										class="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300"
									>
										{formatCurrency(holding.exposure)}
									</td>
									<td class="min-w-40 px-4 py-3">
										<div class="flex items-center gap-2">
											<div
												class="h-1.5 w-20 rounded-full bg-zinc-100 dark:bg-zinc-800"
											>
												<div
													class="h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500"
													style={`width: ${barWidth(holding.percentOfPortfolio)}`}
												></div>
											</div>
											<span class="text-zinc-700 dark:text-zinc-300">
												{formatPercent(holding.percentOfPortfolio)}
											</span>
										</div>
									</td>
									<td
										class="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300"
									>
										{formatShares(holding.totalShares)}
										{#if holding.directShares > 0 && holding.viaEtfs.length > 0}
											<div class="text-xs text-zinc-400">
												{formatShares(holding.directShares)} direct
											</div>
										{/if}
									</td>
									<td
										class="px-4 py-3 text-right text-zinc-700 dark:text-zinc-300"
									>
										{formatCurrency(holding.price)}
										{#if priceNote(holding.priceStatus)}
											<div class="text-xs text-zinc-400">
												{priceNote(holding.priceStatus)}
											</div>
										{/if}
									</td>
									<td class="px-4 py-3">
										<div class="flex flex-wrap gap-1">
											{#if holding.directShares > 0}
												<span
													class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
												>
													Direct
												</span>
											{/if}
											{#each holding.viaEtfs as via (via.etf)}
												<span
													class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
													title={`${formatCurrency(via.exposure)} through ${via.etf}`}
												>
													{via.etf}
													{formatPercent(via.weight)}
												</span>
											{/each}
										</div>
									</td>
								</tr>
							{:else}
								<tr>
									<td
										class="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400"
										colspan="7"
									>
										No exposure calculated yet.
									</td>
								</tr>
							{/each}
						</tbody>
						{#if analysis.tail.count > 0 || analysis.cashAndOther.exposure > 0 || analysis.unaccounted.exposure > 0}
							<tfoot
								class="divide-y divide-zinc-100 text-zinc-500 dark:divide-zinc-800 dark:text-zinc-400"
							>
								{#if analysis.tail.count > 0}
									<tr>
										<td class="px-4 py-3" colspan="2">
											{analysis.tail.count.toLocaleString("en-US")} smaller holdings
										</td>
										<td class="px-4 py-3 text-right"
											>{formatCurrency(analysis.tail.exposure)}</td
										>
										<td class="px-4 py-3"
											>{formatPercent(analysis.tail.percentOfPortfolio)}</td
										>
										<td class="px-4 py-3" colspan="3"></td>
									</tr>
								{/if}
								{#if analysis.cashAndOther.exposure > 0}
									<tr>
										<td class="px-4 py-3" colspan="2">
											Cash &amp; other
											{#if analysis.cashAndOther.items.length}
												<div class="text-xs text-zinc-400">
													{analysis.cashAndOther.items
														.slice(0, 3)
														.map((item) => item.name)
														.join(", ")}{analysis.cashAndOther.items
														.length > 3
														? ", …"
														: ""}
												</div>
											{/if}
										</td>
										<td class="px-4 py-3 text-right">
											{formatCurrency(analysis.cashAndOther.exposure)}
										</td>
										<td class="px-4 py-3">
											{formatPercent(
												analysis.cashAndOther.percentOfPortfolio
											)}
										</td>
										<td class="px-4 py-3" colspan="3"></td>
									</tr>
								{/if}
								{#if analysis.unaccounted.exposure > 0}
									<tr class="text-amber-700 dark:text-amber-400">
										<td class="px-4 py-3" colspan="2">
											Not covered by holdings data
											{#if analysis.unaccounted.byInput.length}
												<div class="text-xs opacity-80">
													{analysis.unaccounted.byInput
														.map((item) => item.symbol)
														.join(", ")}
												</div>
											{/if}
										</td>
										<td class="px-4 py-3 text-right">
											{formatCurrency(analysis.unaccounted.exposure)}
										</td>
										<td class="px-4 py-3">
											{formatPercent(analysis.unaccounted.percentOfPortfolio)}
										</td>
										<td class="px-4 py-3" colspan="3"></td>
									</tr>
								{/if}
							</tfoot>
						{/if}
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
								: `View All (${analysis.holdings.length.toLocaleString("en-US")})`}
						</Button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
