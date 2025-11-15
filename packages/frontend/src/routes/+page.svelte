<script lang="ts">
	import SearchForm from "$lib/components/search-form/search-form.svelte";
	import StockList from "$lib/components/stock-list/stock-list.svelte";
	import { request } from "$lib/request";
	import type { SearchItem } from "$lib/types";
	import { toast } from "svelte-sonner";

	const list: SearchItem[] = $state([]);
	let newlyAddedSymbol = $state<string | null>(null);
	let isSaving = $state(false);
	let lastSavedAt = $state<string | null>(null);
	let saveError = $state<string | null>(null);

	const handleClicked = (item: SearchItem) => {
		list.push(item);
		newlyAddedSymbol = item.symbol;
	};

	const saveList = async () => {
		if (list.length === 0) {
			toast.error("Add at least one ticker before saving.");
			return;
		}

		isSaving = true;
		saveError = null;

		try {
			const response = await request("/list", {
				method: "POST",
				body: JSON.stringify({
					tickers: list.map((item) => item.symbol)
				})
			});

			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to save list");
			}

			lastSavedAt = body?.data?.updatedAt ?? new Date().toISOString();

			const tickersSaved = body?.data?.tickers?.length ?? list.length;

			toast.success(`Saved ${tickersSaved} ticker${tickersSaved === 1 ? "" : "s"} to the backend.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to save list";
			saveError = message;
			toast.error(message);
		} finally {
			isSaving = false;
		}
	};
</script>

<div class="flex h-screen items-center justify-center">
	<div class="relative w-1/2">
		<SearchForm clickedItem={handleClicked} {list} />
		<StockList {list} {newlyAddedSymbol} />
		<div class="mt-6 space-y-2 rounded-md border border-dashed border-zinc-300 p-4 text-center dark:border-zinc-700">
			<button
				type="button"
				class="w-full rounded-md bg-zinc-900 py-2 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
				disabled={isSaving || list.length === 0}
				onclick={saveList}
			>
				{#if isSaving}
					Saving...
				{:else}
					Save list to backend
				{/if}
			</button>
			{#if lastSavedAt}
				<p class="text-sm text-zinc-500 dark:text-zinc-400">
					Last saved at {new Date(lastSavedAt).toLocaleTimeString()}
				</p>
			{/if}
			{#if saveError}
				<p class="text-sm text-red-500">{saveError}</p>
			{/if}
		</div>
	</div>
</div>
