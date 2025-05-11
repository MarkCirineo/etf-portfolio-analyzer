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

<div class="flex h-screen items-center justify-center">
	<div class="relative w-1/2">
		<SearchForm clickedItem={handleClicked} {list} />
		<StockList {list} {newlyAddedSymbol} />
	</div>
</div>
