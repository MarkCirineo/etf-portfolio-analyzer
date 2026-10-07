<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import X from "@lucide/svelte/icons/x";
	import {
		ACCOUNT_COLORS,
		ACCOUNT_TYPE_BADGE,
		ACCOUNT_TYPE_LABELS,
		colorAt
	} from "$lib/accounts";
	import { directExposure, exposureByAccount, mainSource } from "$lib/dashboard";
	import { formatCurrency, formatMoney, formatPercent, formatShares } from "$lib/format";
	import type { AccountSummary, AnalyzedHolding, ListAnalysis } from "$lib/types";
	import { cn } from "$lib/utils";

	let {
		holding,
		analysis,
		accounts,
		colors,
		onclose
	}: {
		holding: AnalyzedHolding | null;
		analysis: ListAnalysis;
		/** The accounts in view. */
		accounts: AccountSummary[];
		colors: Map<string, string>;
		onclose: () => void;
	} = $props();

	const rank = $derived(
		holding ? analysis.holdings.findIndex((entry) => entry.id === holding.id) + 1 : 0
	);

	/** Each way the user owns it: directly, and through each fund. */
	const sources = $derived.by(() => {
		if (!holding) return [];

		const direct = directExposure(holding);
		const list = holding.viaEtfs.map((via) => ({
			label: via.etf,
			exposure: via.exposure,
			detail: `${formatPercent(via.weight)} of the fund · your ${via.etf} is ${formatMoney(
				analysis.inputs.find((input) => input.symbol === via.etf)?.value
			)}`,
			color: colors.get(via.etf) ?? "#3F3F46",
			weight: via.weight,
			fundValue: analysis.inputs.find((input) => input.symbol === via.etf)?.value ?? null
		}));

		if (holding.directShares > 0) {
			list.unshift({
				label: "Held directly",
				exposure: direct,
				detail: `${formatShares(holding.directShares, 4)} shares`,
				color: colors.get(holding.symbol) ?? "#3F3F46",
				weight: 100,
				fundValue: null
			});
		}

		return list.sort((a, b) => b.exposure - a.exposure);
	});

	const fundsWithout = $derived(
		holding
			? analysis.inputs
					.filter(
						(input) =>
							input.kind === "etf" &&
							!holding.viaEtfs.some((via) => via.etf === input.symbol)
					)
					.map((input) => input.symbol)
			: []
	);

	const byAccount = $derived(
		holding && accounts.length > 1
			? exposureByAccount(holding, accounts)
					.map((entry, index) => ({ ...entry, color: colorAt(ACCOUNT_COLORS, index) }))
					.sort((a, b) => b.exposure - a.exposure)
			: []
	);
	const accountsWith = $derived(byAccount.filter((entry) => entry.exposure > 0.005));
	const accountsWithout = $derived(byAccount.filter((entry) => entry.exposure <= 0.005));

	const share = (exposure: number) =>
		holding && holding.exposure > 0 ? (exposure / holding.exposure) * 100 : 0;

	const asOf = $derived(
		analysis.inputs.map((input) => input.holdingsAsOf).find((value) => value) ?? null
	);
</script>

<DialogPrimitive.Root
	open={holding !== null}
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<DialogPrimitive.Portal>
		<DialogPrimitive.Overlay
			class="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
		/>
		<DialogPrimitive.Content
			class="fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l bg-card shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
		>
			{#if holding}
				<div class="flex items-center justify-between border-b px-5 py-2">
					<span class="text-xs font-medium uppercase tracking-wider text-muted-foreground"
						>Holding</span
					>
					<DialogPrimitive.Close
						class="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
						aria-label="Close details"
					>
						<X class="size-5" />
					</DialogPrimitive.Close>
				</div>

				<div class="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-6">
					<div class="flex items-center gap-3.5">
						<span
							aria-hidden="true"
							class="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
							style:background={colors.get(mainSource(holding)) ?? "#3F3F46"}
						>
							{holding.symbol.slice(0, 2)}
						</span>
						<div class="min-w-0">
							<DialogPrimitive.Title class="text-2xl font-bold tracking-tight">
								{holding.symbol}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description class="truncate text-muted-foreground">
								{holding.name ?? "Name unavailable"}
							</DialogPrimitive.Description>
						</div>
					</div>

					<ul aria-label="About this holding" class="flex flex-wrap gap-1.5">
						{#if rank > 0}
							<li
								class="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
							>
								Your #{rank} holding
							</li>
						{/if}
						{#if holding.sector}
							<li
								class="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
							>
								{holding.sector}
							</li>
						{/if}
						{#if !holding.usListed}
							<li
								class="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-300"
							>
								{holding.priceStatus === "unconfirmed-listing"
									? "US listing unconfirmed"
									: "Listed abroad"} · no share count
							</li>
						{/if}
					</ul>

					<dl class="grid grid-cols-2 gap-3">
						<div class="rounded-xl border px-4 py-3.5">
							<dt class="text-xs text-muted-foreground">Your exposure</dt>
							<dd class="mt-1 font-mono text-xl font-semibold tabular-nums">
								{formatMoney(holding.exposure)}
							</dd>
						</div>
						<div class="rounded-xl border px-4 py-3.5">
							<dt class="text-xs text-muted-foreground">Of your portfolio</dt>
							<dd class="mt-1 font-mono text-xl font-semibold tabular-nums">
								{formatPercent(holding.percentOfPortfolio)}
							</dd>
						</div>
						<div class="rounded-xl border px-4 py-3.5">
							<dt class="text-xs text-muted-foreground">Shares you own</dt>
							<dd class="mt-1 font-mono text-xl font-semibold tabular-nums">
								{formatShares(holding.totalShares)}
							</dd>
						</div>
						<div class="rounded-xl border px-4 py-3.5">
							<dt class="text-xs text-muted-foreground">Price</dt>
							<dd class="mt-1 font-mono text-xl font-semibold tabular-nums">
								{formatCurrency(holding.price)}
							</dd>
						</div>
					</dl>

					<section aria-labelledby="sources-title" class="flex flex-col gap-3.5">
						<div>
							<h2 id="sources-title" class="text-base font-semibold">
								Where it comes from
							</h2>
							<p class="mt-1 text-[13px] text-muted-foreground">
								{sources.length === 1
									? `All of it through ${sources[0].label === "Held directly" ? "shares you hold directly" : sources[0].label}`
									: `Through ${sources.length} of your holdings`}
							</p>
						</div>
						<div
							role="img"
							aria-label={`Split: ${sources.map((source) => `${formatPercent(share(source.exposure), 1)} ${source.label}`).join(", ")}`}
							class="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-muted"
						>
							{#each sources as source (source.label)}
								<div
									style:width="{share(source.exposure)}%"
									style:background={source.color}
								></div>
							{/each}
						</div>
						<ul class="flex flex-col">
							{#each sources as source (source.label)}
								<li class="flex items-center gap-3 border-b py-3.5">
									<span
										class="size-2.5 shrink-0 rounded-[3px]"
										style:background={source.color}
									></span>
									<div class="min-w-0 flex-1">
										<div class="font-semibold">{source.label}</div>
										<div class="text-xs text-muted-foreground">
											{source.detail}
										</div>
									</div>
									<div class="text-right">
										<div class="font-mono font-semibold tabular-nums">
											{formatMoney(source.exposure)}
										</div>
										<div
											class="font-mono text-xs tabular-nums text-muted-foreground"
										>
											{formatPercent(share(source.exposure), 1)} of your {holding.symbol}
										</div>
									</div>
								</li>
							{/each}
							{#if fundsWithout.length}
								<li class="flex items-center gap-3 py-3.5 text-muted-foreground">
									<span
										class="size-2.5 shrink-0 rounded-[3px] border border-dashed border-muted-foreground"
									></span>
									Not held by {fundsWithout.join(" or ")}
								</li>
							{/if}
						</ul>
					</section>

					{#if byAccount.length}
						<section aria-labelledby="where-held-title" class="flex flex-col gap-3.5">
							<div>
								<h2 id="where-held-title" class="text-base font-semibold">
									Which accounts it's in
								</h2>
								<p class="mt-1 text-[13px] text-muted-foreground">
									Through {accountsWith.length} of your {byAccount.length} accounts
								</p>
							</div>
							<div
								role="img"
								aria-label={`By account: ${accountsWith.map((entry) => `${entry.account.name} ${formatPercent(share(entry.exposure), 1)}`).join(", ")}`}
								class="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-muted"
							>
								{#each accountsWith as entry (entry.account.id)}
									<div
										style:width="{share(entry.exposure)}%"
										style:background={entry.color}
									></div>
								{/each}
							</div>
							<ul class="flex flex-col">
								{#each accountsWith as entry (entry.account.id)}
									<li class="flex items-center gap-3 border-b py-3.5">
										<span
											class="size-2.5 shrink-0 rounded-[3px]"
											style:background={entry.color}
										></span>
										<div class="min-w-0 flex-1">
											<div class="flex flex-wrap items-center gap-2">
												<span class="font-semibold"
													>{entry.account.name}</span
												>
												<span
													class={cn(
														"rounded-full px-2 py-0.5 text-[11px] font-semibold",
														ACCOUNT_TYPE_BADGE[entry.account.type]
													)}
													>{ACCOUNT_TYPE_LABELS[entry.account.type]}</span
												>
											</div>
											<div class="text-xs text-muted-foreground">
												{entry.through[0] === "held directly" &&
												entry.through.length === 1
													? "Held directly"
													: `Through ${entry.through.join(", ")}`}
											</div>
										</div>
										<div class="text-right">
											<div class="font-mono font-semibold tabular-nums">
												{formatMoney(entry.exposure)}
											</div>
											{#if holding.price}
												<div
													class="font-mono text-xs tabular-nums text-muted-foreground"
												>
													{formatShares(entry.exposure / holding.price)} shares
												</div>
											{/if}
										</div>
									</li>
								{/each}
								{#if accountsWithout.length}
									<li
										class="flex items-center gap-3 py-3.5 text-muted-foreground"
									>
										<span
											class="size-2.5 shrink-0 rounded-[3px] border border-dashed border-muted-foreground"
										></span>
										Not in {accountsWithout
											.map((entry) => entry.account.name)
											.join(" or ")}
									</li>
								{/if}
							</ul>
						</section>
					{/if}

					<section
						aria-labelledby="math-title"
						class="rounded-xl bg-muted/70 px-4 py-3.5"
					>
						<h2 id="math-title" class="mb-2 text-[13px] font-semibold">
							How this is worked out
						</h2>
						<p class="font-mono text-xs leading-relaxed text-muted-foreground">
							{#each sources as source (source.label)}
								{#if source.fundValue !== null}
									{formatMoney(source.fundValue)} × {formatPercent(source.weight)}
									= {formatMoney(source.exposure)}<br />
								{:else}
									{source.detail} = {formatMoney(source.exposure)}<br />
								{/if}
							{/each}
							{#if holding.price && holding.totalShares !== null}
								{formatMoney(holding.exposure)} ÷ {formatCurrency(holding.price)} = {formatShares(
									holding.totalShares
								)} shares
							{:else}
								No US price, so no share count.
							{/if}
						</p>
					</section>
				</div>

				<div
					class="flex items-center justify-between gap-3 border-t px-5 py-3.5 text-xs text-muted-foreground"
				>
					<span>{asOf ? `Holdings as of ${asOf}` : "Holdings date unknown"}</span>
				</div>
			{/if}
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
</DialogPrimitive.Root>
