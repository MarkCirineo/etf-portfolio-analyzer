<script lang="ts">
	import Search from "$lib/components/ui/search/search.svelte";
	import { onDestroy } from "svelte";

	let searchQuery = "";

	let debounceInterval: ReturnType<typeof setTimeout> | null = null;

	const submitSearch = () => {
		// Perform the search action here
		console.log("Searching for:", searchQuery);
	};

	const debounceSearch = () => {
		if (debounceInterval) {
			clearTimeout(debounceInterval);
		}

		debounceInterval = setTimeout(() => {
			submitSearch();
		}, 500);
	};

	$: {
		if (searchQuery.length > 0) {
			debounceSearch();
		} else {
			if (debounceInterval) {
				clearTimeout(debounceInterval);
			}
		}
	}

	onDestroy(() => {
		if (debounceInterval) {
			clearTimeout(debounceInterval);
		}
	});
</script>

<div class="flex h-screen items-center justify-center">
	<div class="relative w-1/2">
		<Search bind:value={searchQuery} />
	</div>
</div>
