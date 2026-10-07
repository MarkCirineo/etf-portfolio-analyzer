<script lang="ts">
	import Wallet from "@lucide/svelte/icons/wallet";
	import { plural, formatCurrency, formatMoney, formatPercent, formatShares } from "$lib/format";
	import type { AccountSummary, ListAnalysis, ListInput } from "$lib/types";

	let {
		analysis,
		accounts,
		colors
	}: {
		analysis: ListAnalysis;
		/** The accounts in view. */
		accounts: AccountSummary[];
		colors: Map<string, string>;
	} = $props();

	const inputs = $derived([...analysis.inputs].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)));

	const describe = (input: ListInput) => {
		if (input.kind === "etf") {
			return [
				input.holdingsCount !== null ? plural(input.holdingsCount, "holding") : null,
				input.expenseRatio !== null ? `${formatPercent(input.expenseRatio)} fee` : null,
				input.leveraged ? "leveraged" : null
			]
				.filter(Boolean)
				.join(" · ");
		}

		return input.kind === "stock" ? "Held directly" : "Holdings unavailable";
	};

	/** "Schwab Roth 78 · Schwab Individual 52", or "Only in Schwab Roth". */
	const whereHeld = (symbol: string) => {
		const holders = accounts
			.map((account) => ({
				account,
				shares:
					account.positions.find((position) => position.symbol === symbol)?.shares ?? 0
			}))
			.filter((holder) => holder.shares > 0);

		if (holders.length === 1) {
			return `Only in ${holders[0].account.name}`;
		}

		return holders
			.map((holder) => `${holder.account.name} ${formatShares(holder.shares, 4)}`)
			.join(" · ");
	};
</script>

<section
	aria-labelledby="funds-title"
	class="flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5"
>
	<div>
		<h2 id="funds-title" class="text-base font-semibold">Your holdings</h2>
		<p class="mt-1 text-[13px] text-muted-foreground">
			{accounts.length > 1
				? `Combined across ${accounts.length} accounts`
				: accounts.length === 1
					? `In ${accounts[0].name}`
					: "What you entered, priced"}
		</p>
	</div>

	<div
		role="img"
		aria-label={`Allocation: ${inputs.map((input) => `${input.symbol} ${formatPercent(input.percentOfPortfolio, 1)}`).join(", ")}`}
		class="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted"
	>
		{#each inputs as input (input.symbol)}
			<div
				style:width="{input.percentOfPortfolio ?? 0}%"
				style:background={colors.get(input.symbol)}
			></div>
		{/each}
	</div>

	<ul class="flex flex-col">
		{#each inputs as input (input.symbol)}
			<li class="flex items-start gap-3 border-b py-3 last:border-b-0">
				<span
					class="mt-1.5 size-2.5 shrink-0 rounded-[3px]"
					style:background={colors.get(input.symbol)}
				></span>
				<div class="min-w-0 flex-1">
					<div class="font-semibold">
						{input.symbol}
						<span class="text-xs font-normal text-muted-foreground">
							{input.kind === "etf"
								? "ETF"
								: input.kind === "stock"
									? "Stock"
									: "Unknown"} ·
							{formatShares(input.shares, 4)} shares
						</span>
					</div>
					<div class="text-xs text-muted-foreground">{describe(input)}</div>
					{#if accounts.length > 1}
						<div class="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
							<Wallet class="mt-0.5 size-3 shrink-0" />
							<span>{whereHeld(input.symbol)}</span>
						</div>
					{/if}
				</div>
				<div class="text-right">
					<div class="font-mono font-semibold tabular-nums">
						{formatMoney(input.value)}
					</div>
					<div class="font-mono text-xs tabular-nums text-muted-foreground">
						{formatPercent(input.percentOfPortfolio, 1)}
					</div>
				</div>
			</li>
		{/each}
	</ul>

	<div class="mt-auto rounded-xl bg-muted/70 px-3.5 py-3 text-[13px] text-muted-foreground">
		Weighted expense ratio
		<span class="font-mono font-semibold tabular-nums text-foreground"
			>{formatPercent(analysis.breakdown.fees.expenseRatio, 3)}</span
		>
		— about
		<span class="font-mono font-semibold tabular-nums text-foreground"
			>{formatCurrency(analysis.breakdown.fees.annual)}</span
		> a year in fund fees.
	</div>
</section>
