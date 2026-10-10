<script lang="ts">
	import { toast } from "svelte-sonner";
	import X from "@lucide/svelte/icons/x";
	import Button from "$lib/components/ui/button/button.svelte";
	import { formatMoney, formatPrice } from "$lib/format";
	import { parseShares, rowValue, type HoldingRow } from "$lib/holdings";
	import { privacy } from "$lib/stores/privacy.svelte";
	import SymbolSearch from "./symbol-search.svelte";

	let {
		rows = $bindable(),
		prices,
		title,
		empty,
		alsoIn
	}: {
		rows: HoldingRow[];
		/** Latest price per symbol; symbols without one show a dash until saved and priced. */
		prices: Map<string, number>;
		title: string;
		/** Shown in place of the table while there are no rows. */
		empty: string;
		/** Other places a symbol is held, noted under it ("Also in Schwab Roth IRA"). */
		alsoIn?: (symbol: string) => string[];
	} = $props();

	let newSymbol = $state("");
	let newShares = $state("");
	let symbolInput = $state<HTMLInputElement | null>(null);
	let sharesInput = $state<HTMLInputElement | null>(null);

	/** Ticker shaped: letters, digits, dots and dashes (BRK.B, BF-B), no spaces. */
	const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;

	const add = (event: SubmitEvent) => {
		event.preventDefault();

		const symbol = newSymbol.trim().toUpperCase();
		const shares = parseShares(newShares || "0");

		if (!symbol) {
			toast.error("Enter a ticker symbol");
			return;
		}

		if (!TICKER.test(symbol)) {
			// A company name typed without picking a match
			toast.error("Pick a match from the list, or type the ticker");
			symbolInput?.focus();
			return;
		}

		if (shares === null) {
			toast.error("Shares must be a number of zero or more");
			return;
		}

		const existing = rows.find((row) => row.symbol === symbol);

		if (existing) {
			// Adding a symbol that is already there tops it up
			existing.shares = String((parseShares(existing.shares) ?? 0) + shares);
		} else {
			rows.push({ symbol, shares: String(shares) });
		}

		newSymbol = "";
		newShares = "";
		// Ready for the next one
		symbolInput?.focus();
	};

	const remove = (symbol: string) => {
		rows = rows.filter((row) => row.symbol !== symbol);
	};
</script>

<div>
	<h3 class="mb-2 text-[15px] font-semibold">{title}</h3>
	{#if rows.length === 0}
		<p class="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
			{empty}
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[520px] border-collapse text-sm">
				<thead>
					<tr class="text-left text-xs uppercase tracking-wider text-muted-foreground">
						<th scope="col" class="border-b py-2 pr-3 font-medium">Symbol</th>
						<th scope="col" class="w-40 border-b px-3 py-2 font-medium">Shares</th>
						<th scope="col" class="border-b px-3 py-2 text-right font-medium">Price</th>
						<th scope="col" class="border-b px-3 py-2 text-right font-medium">Value</th>
						<th scope="col" class="w-11 border-b py-2"
							><span class="sr-only">Remove</span></th
						>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.symbol)}
						{@const others = alsoIn?.(row.symbol) ?? []}
						<tr>
							<td class="border-b py-2 pr-3">
								<div class="font-semibold">{row.symbol}</div>
								{#if others.length}
									<div class="text-xs text-muted-foreground">
										Also in {others.join(", ")}
									</div>
								{/if}
							</td>
							<td class="border-b px-3 py-2">
								<input
									type="text"
									inputmode="decimal"
									aria-label="{row.symbol} shares"
									aria-invalid={parseShares(row.shares) === null}
									bind:value={row.shares}
									class:hidden-amount={privacy.hidden}
									class="min-h-10 w-full rounded-lg border bg-background px-2.5 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-red-600"
								/>
							</td>
							<td
								class="border-b px-3 py-2 text-right font-mono tabular-nums text-muted-foreground"
							>
								{prices.has(row.symbol) ? formatPrice(prices.get(row.symbol)) : "—"}
							</td>
							<td
								class="border-b px-3 py-2 text-right font-mono font-semibold tabular-nums"
							>
								{formatMoney(rowValue(row, prices))}
							</td>
							<td class="border-b py-2">
								<button
									type="button"
									aria-label="Remove {row.symbol}"
									onclick={() => remove(row.symbol)}
									class="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<X class="size-4" />
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if rows.some((row) => !prices.has(row.symbol))}
			<p class="mt-2 text-xs text-muted-foreground">New symbols are priced after you save.</p>
		{/if}
	{/if}
</div>

<form onsubmit={add} class="flex flex-wrap items-end gap-3 rounded-xl bg-muted/70 p-4">
	<div class="flex min-w-48 flex-[2] flex-col gap-1.5">
		<label for="new-symbol" class="text-[13px] font-medium">Add a holding</label>
		<SymbolSearch
			id="new-symbol"
			bind:value={newSymbol}
			bind:input={symbolInput}
			onpick={() => sharesInput?.focus()}
		/>
	</div>
	<div class="flex min-w-28 flex-1 flex-col gap-1.5">
		<label for="new-shares" class="text-[13px] font-medium">Shares</label>
		<input
			id="new-shares"
			bind:this={sharesInput}
			type="text"
			inputmode="decimal"
			placeholder="0"
			bind:value={newShares}
			class="min-h-11 rounded-lg border bg-card px-3 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
		/>
	</div>
	<Button type="submit" variant="outline" class="min-h-11 bg-card px-5">Add</Button>
</form>

<style>
	/* Blurs the digits, not the box; clicking in shows them for editing */
	.hidden-amount:not(:focus) {
		color: transparent;
		text-shadow: 0 0 8px hsl(var(--foreground));
	}
</style>
