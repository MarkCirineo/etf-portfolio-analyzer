<script lang="ts">
	import type { PortfolioBreakdown } from "$lib/types";

	let { overlap }: { overlap: PortfolioBreakdown["overlap"] } = $props();

	/** The pair where one fund sits most inside another, to call out under the table. */
	const strongest = $derived.by(() => {
		let best: { inner: string; outer: string; percent: number } | null = null;

		overlap.matrix.forEach((row, i) =>
			row.forEach((percent, j) => {
				if (percent !== null && percent >= 50 && (!best || percent > best.percent)) {
					best = { inner: overlap.funds[i], outer: overlap.funds[j], percent };
				}
			})
		);

		return best as { inner: string; outer: string; percent: number } | null;
	});

	const shade = (percent: number) => `rgba(67, 56, 202, ${Math.min(percent / 100, 1) * 0.9})`;
</script>

<section aria-labelledby="overlap-title" class="min-w-0 rounded-2xl border bg-card p-5">
	<h2 id="overlap-title" class="text-base font-semibold">Fund overlap</h2>
	<p class="mb-4 mt-1 text-[13px] text-muted-foreground">
		How much of each row's fund, by weight, is already in the column's fund
	</p>
	<div class="overflow-x-auto">
		<table class="w-full border-separate border-spacing-1 text-[13px]">
			<thead>
				<tr>
					<th scope="col" class="w-14"><span class="sr-only">Fund</span></th>
					{#each overlap.funds as fund (fund)}
						<th scope="col" class="p-1 font-semibold">{fund}</th>
					{/each}
				</tr>
			</thead>
			<tbody class="font-mono tabular-nums">
				{#each overlap.matrix as row, i (overlap.funds[i])}
					<tr>
						<th scope="row" class="text-left font-sans font-semibold"
							>{overlap.funds[i]}</th
						>
						{#each row as percent, j (overlap.funds[j])}
							{#if percent === null}
								<td
									class="rounded-lg bg-muted px-1 py-3 text-center text-muted-foreground"
									>—</td
								>
							{:else}
								<td
									class="rounded-lg px-1 py-3 text-center {percent >= 55
										? 'font-semibold text-white'
										: ''}"
									style:background={shade(percent)}
								>
									{Math.round(percent)}%
								</td>
							{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if strongest}
		<p class="mt-3.5 rounded-xl bg-muted/70 px-3.5 py-3 text-[13px] text-muted-foreground">
			<span class="font-mono font-semibold tabular-nums text-foreground"
				>{Math.round(strongest.percent)}%</span
			>
			of {strongest.inner}'s weight is already inside {strongest.outer}, so it tilts your mix
			more than it diversifies it.
		</p>
	{/if}
</section>
