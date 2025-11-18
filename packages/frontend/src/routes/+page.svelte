<script lang="ts">
	import SearchForm from "$lib/components/search-form/search-form.svelte";
	import StockList from "$lib/components/stock-list/stock-list.svelte";
	import { request } from "$lib/request";
	import type { SearchItem } from "$lib/types";
	import { toast } from "svelte-sonner";

	const list: SearchItem[] = $state([]);
	const shares = $state<Record<string, number>>({});
	let newlyAddedSymbol = $state<string | null>(null);
	let listName = $state("My List");
	let isSaving = $state(false);
	let lastSavedAt = $state<string | null>(null);
	let saveError = $state<string | null>(null);

	const handleClicked = (item: SearchItem) => {
		list.push(item);
		newlyAddedSymbol = item.symbol;
		if (!(item.symbol in shares)) {
			shares[item.symbol] = 0;
		}
	};

	const saveList = async () => {
		if (list.length === 0) {
			toast.error("Add at least one ticker before saving.");
			return;
		}

		isSaving = true;
		saveError = null;

		try {
			const holdingsPayload = list.reduce<Record<string, number>>((acc, item) => {
				const ticker = item.symbol.trim().toUpperCase();
				const value = Number(shares[item.symbol] ?? 0);

				if (!Number.isFinite(value) || value < 0) {
					throw new Error(`Invalid share count for ${ticker}`);
				}

				acc[ticker] = value;
				return acc;
			}, {});

			const trimmedName = listName.trim();

			const response = await request("/list", {
				method: "POST",
				body: JSON.stringify({
					name: trimmedName || undefined,
					holdings: holdingsPayload
				})
			});

			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to save list");
			}

			lastSavedAt = body?.data?.updatedAt ?? new Date().toISOString();

			const holdingsSaved = body?.data?.content
				? Object.keys(body.data.content).length
				: list.length;

			toast.success(
				`Saved ${holdingsSaved} holding${holdingsSaved === 1 ? "" : "s"} to the backend.`
			);
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
		<StockList {list} {newlyAddedSymbol} {shares} />
		<div
			class="mt-6 space-y-2 rounded-md border border-dashed border-zinc-300 p-4 text-center dark:border-zinc-700"
		>
			<input
				type="text"
				class="w-full rounded-md border border-zinc-300 bg-transparent p-2 text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
				placeholder="List name"
				bind:value={listName}
			/>
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
