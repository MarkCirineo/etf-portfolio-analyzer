<script lang="ts">
	import { onDestroy } from "svelte";
	import { request } from "$lib/request";
	import Search from "../ui/search/search.svelte";

	let searchQuery = "";
	let debounceInterval: ReturnType<typeof setTimeout> | null = null;

	type Item = {
		description: string;
		displaySymbol: string;
		symbol: string;
		type: string;
	};

	let items: Item[] = [];
	let loading = false;
	let isFocused = false;
	let noResults = false;

	const submitSearch = async () => {
		loading = true;

		const response = await request(`/etf/search?q=${searchQuery}`, {
			method: "GET"
		});

		if (response.ok) {
			const res = await response.json();
			items = res.data?.result;

			if (!items || items.length === 0) {
				noResults = true;
			}
		} else {
			// TODO: handle error
			items = [];
		}

		loading = false;
	};

	const debounceSearch = () => {
		if (debounceInterval) {
			clearTimeout(debounceInterval);
		}

		debounceInterval = setTimeout(() => {
			submitSearch();
		}, 400);
	};

	const handleFocus = () => {
		isFocused = true;
	};

	const handleBlur = () => {
		isFocused = false;
	};

	$: {
		if (searchQuery.length > 0) {
			debounceSearch();
		} else {
			if (debounceInterval) {
				clearTimeout(debounceInterval);
			}
			items = [];
			noResults = false;
		}
	}

	onDestroy(() => {
		if (debounceInterval) {
			clearTimeout(debounceInterval);
		}
	});
</script>

<div on:focusin={handleFocus} on:focusout={handleBlur}>
	<Search bind:value={searchQuery} />
	<!-- Results -->
	{#if isFocused}
		<div class="relative">
			<div
				class="absolute z-10 mt-1 max-h-96 w-full overflow-y-auto bg-white shadow-sm dark:bg-zinc-900"
			>
				{#if loading}
					<p class="rounded-md border p-4 text-zinc-500 dark:text-zinc-400">Loading...</p>
				{:else if items && items.length > 0}
					<ul class="divide-y divide-zinc-200 rounded-md border dark:divide-zinc-700">
						{#each items as item}
							<li class="p-4 hover:bg-zinc-100 dark:hover:bg-zinc-700">
								<div class="font-medium text-zinc-900 dark:text-zinc-100">
									{item.symbol}
								</div>
								<div class="text-sm text-zinc-500 dark:text-zinc-400">
									{item.description}
								</div>
							</li>
						{/each}
					</ul>
				{:else if noResults}
					<p class="rounded-md border p-4 text-zinc-500 dark:text-zinc-400">
						No results found.
					</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
