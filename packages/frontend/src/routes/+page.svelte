<script lang="ts">
	import SearchForm from "$lib/components/search-form/search-form.svelte";
	import StockList from "$lib/components/stock-list/stock-list.svelte";
	import type { SearchItem } from "$lib/types";

	const list: SearchItem[] = $state([]);
	let newlyAddedSymbol = $state<string | null>(null);

	const handleClicked = (item: SearchItem) => {
		list.push(item);
		newlyAddedSymbol = item.symbol;
	};
</script>

<div class="bg-background flex min-h-screen flex-col">
	<main class="flex flex-1 items-center justify-center px-6 py-10">
		<div class="relative w-full max-w-3xl">
			<SearchForm clickedItem={handleClicked} {list} />
			<StockList {list} {newlyAddedSymbol} />
		</div>
	</main>
</div>
