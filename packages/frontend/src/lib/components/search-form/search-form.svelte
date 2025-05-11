<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { request } from "$lib/request";
	import Search from "../ui/search/search.svelte";
	import type { SearchItem } from "$lib/types";

	let searchQuery = $state("");
	let debounceInterval: ReturnType<typeof setTimeout> | null = null;

	let items: SearchItem[] = $state([]);
	let loading = $state(false);
	let isFocused = $state(false);
	let noResults = $state(false);

	let { clickedItem } = $props();

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

	const handleClickOutside = (event: MouseEvent) => {
		const dropdown = document.querySelector(".dropdown-container");
		if (dropdown && !dropdown.contains(event.target as Node)) {
			isFocused = false;
		}
	};

	$effect(() => {
		if (searchQuery.length > 0) {
			debounceSearch();
		} else {
			if (debounceInterval) {
				clearTimeout(debounceInterval);
			}
			items = [];
			noResults = false;
		}
	});

	const handleClick = (e: MouseEvent, item: SearchItem) => {
		isFocused = false;

		clickedItem(item);
	};

	onMount(() => {
		if (typeof document !== "undefined") {
			document.addEventListener("mousedown", handleClickOutside);
		}
	});

	onDestroy(() => {
		if (debounceInterval) {
			clearTimeout(debounceInterval);
		}
		if (typeof document !== "undefined") {
			document.removeEventListener("mousedown", handleClickOutside);
		}
	});
</script>

<div onfocusin={handleFocus} class="dropdown-container">
	<Search bind:value={searchQuery} />
	<!-- Results -->
	{#if isFocused}
		<div
			class="absolute z-10 mt-1 max-h-96 w-full overflow-y-auto bg-white shadow-sm dark:bg-zinc-900"
		>
			{#if loading}
				<p class="rounded-md border p-4 text-zinc-500 dark:text-zinc-400">Loading...</p>
			{:else if items && items.length > 0}
				<div class="divide-y divide-zinc-200 rounded-md border dark:divide-zinc-700">
					{#each items as item}
						<button
							type="button"
							class="w-full p-4 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
							onclick={(e) => handleClick(e, item)}
						>
							<div class="font-medium text-zinc-900 dark:text-zinc-100">
								{item.symbol}
							</div>
							<div class="text-sm text-zinc-500 dark:text-zinc-400">
								{item.description}
							</div>
						</button>
					{/each}
				</div>
			{:else if noResults}
				<p class="rounded-md border p-4 text-zinc-500 dark:text-zinc-400">
					No results found.
				</p>
			{/if}
		</div>
	{/if}
</div>
