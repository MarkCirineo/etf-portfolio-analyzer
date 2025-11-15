<script lang="ts">
	import SearchForm from "$lib/components/search-form/search-form.svelte";
	import StockList from "$lib/components/stock-list/stock-list.svelte";
	import { AuthDialog } from "$lib/components/auth";
	import type { SearchItem } from "$lib/types";

	const list: SearchItem[] = $state([]);
	let newlyAddedSymbol = $state<string | null>(null);

	const handleClicked = (item: SearchItem) => {
		list.push(item);
		newlyAddedSymbol = item.symbol;
	};
</script>

<div class="flex min-h-screen flex-col bg-background">
	<header class="border-b px-6 py-4">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<p class="text-lg font-semibold text-foreground">Market Explorer</p>
				<p class="text-sm text-muted-foreground">
					Discover ETFs and manage placeholder portfolios before auth goes live.
				</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<AuthDialog mode="login" />
				<AuthDialog mode="signup" />
			</div>
		</div>
	</header>

	<main class="flex flex-1 items-center justify-center px-6 py-10">
		<div class="relative w-full max-w-3xl">
			<SearchForm clickedItem={handleClicked} {list} />
			<StockList {list} {newlyAddedSymbol} />
		</div>
	</main>
</div>
