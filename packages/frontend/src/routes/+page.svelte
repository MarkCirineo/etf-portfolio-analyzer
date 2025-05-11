<script lang="ts">
	import SearchForm from "$lib/components/search-form/search-form.svelte";
	import StockList from "$lib/components/stock-list/stock-list.svelte";
	import type { SearchItem } from "$lib/types";

	const list: SearchItem[] = $state([]);

	const handleClicked = (item: SearchItem) => {
		list.push(item);
	};
</script>

<div class="flex h-screen items-center justify-center">
	<div class="relative w-1/2">
		<SearchForm clickedItem={handleClicked} />
		<StockList {list} />
	</div>
</div>
