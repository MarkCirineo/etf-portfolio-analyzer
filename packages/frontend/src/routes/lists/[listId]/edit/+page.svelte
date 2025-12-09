<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { ArrowLeft, RefreshCw } from "@lucide/svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import SearchForm from "$lib/components/search-form/search-form.svelte";
	import StockList from "$lib/components/stock-list/stock-list.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import { request } from "$lib/request";
	import type { List, SearchItem } from "$lib/types";

	const editableList: SearchItem[] = $state([]);
	const shares = $state<Record<string, number>>({});
	let newlyAddedSymbol = $state<string | null>(null);
	let listName = $state("Untitled List");
	let isSaving = $state(false);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let lastSavedAt = $state<string | null>(null);

	const hydrateFromList = (list: List) => {
		listName = list.name || "Untitled List";
		lastSavedAt = list.updatedAt || null;
		newlyAddedSymbol = null;

		editableList.splice(0, editableList.length);
		for (const key of Object.keys(shares)) {
			delete shares[key];
		}

		Object.entries(list.content || {}).forEach(([ticker, value]) => {
			editableList.push({
				symbol: ticker,
				displaySymbol: ticker,
				description: `Saved holding (${ticker})`,
				type: "EQUITY"
			});

			const numericValue = Number(value);
			shares[ticker] = Number.isFinite(numericValue) ? numericValue : 0;
		});
	};

	const fetchListDetail = async () => {
		loading = true;
		error = null;

		const { listId } = page.params;

		if (!listId) {
			error = "List id is missing from the URL.";
			loading = false;
			return;
		}

		try {
			const response = await request(`/list/${listId}`, { method: "GET" });
			const body = await response.json().catch(() => ({}));

			if (!response.ok || !body?.data) {
				throw new Error(body?.message ?? "Failed to load list");
			}

			hydrateFromList(body.data as List);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to load list";
			error = message;
			toast.error(message);
		} finally {
			loading = false;
		}
	};

	onMount(() => {
		fetchListDetail();
	});

	const handleClicked = (item: SearchItem) => {
		editableList.push(item);
		newlyAddedSymbol = item.symbol;

		if (!(item.symbol in shares)) {
			shares[item.symbol] = 0;
		}
	};

	const saveChanges = async () => {
		if (editableList.length === 0) {
			toast.error("Add at least one ticker before saving.");
			return;
		}

		const { listId } = page.params;

		if (!listId) {
			toast.error("List id is missing from the URL.");
			return;
		}

		isSaving = true;
		saveError = null;

		try {
			const holdingsPayload = editableList.reduce<Record<string, number>>((acc, item) => {
				const ticker = item.symbol.trim().toUpperCase();
				const value = Number(shares[item.symbol] ?? 0);

				if (!Number.isFinite(value) || value < 0) {
					throw new Error(`Invalid share count for ${ticker}`);
				}

				acc[ticker] = value;
				return acc;
			}, {});

			const trimmedName = listName.trim();
			const response = await request(`/list/${listId}`, {
				method: "PATCH",
				body: JSON.stringify({
					name: trimmedName.length > 0 ? trimmedName : undefined,
					holdings: holdingsPayload
				})
			});

			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to update list");
			}

			if (body?.data) {
				hydrateFromList(body.data as List);
			}

			toast.success("List updated successfully");
			setTimeout(() => {
				goto(`/lists/${listId}`);
			}, 500);
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to update list";
			saveError = message;
			toast.error(message);
		} finally {
			isSaving = false;
		}
	};

	const handleCancel = () => {
		const { listId } = page.params;
		goto(`/lists/${listId}`);
	};
</script>

<div class="container mx-auto max-w-4xl px-4 py-8">
	<div class="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
		<div>
			<Button
				variant="ghost"
				class="gap-2 px-0 text-zinc-600 dark:text-zinc-300"
				onclick={handleCancel}
			>
				<ArrowLeft class="size-4" />
				Back to List
			</Button>
			<h1 class="text-3xl font-bold text-zinc-900 dark:text-zinc-100">Edit List</h1>
			<p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
				Update holdings, adjust share counts, or add/remove tickers.
			</p>
		</div>
		<Button variant="outline" class="gap-2" onclick={fetchListDetail} disabled={loading}>
			<RefreshCw class={`size-4 ${loading ? "animate-spin" : ""}`} />
			Reload
		</Button>
	</div>

	{#if loading}
		<div
			class="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
		>
			Loading list...
		</div>
	{:else if error}
		<div
			class="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100"
		>
			<p>{error}</p>
			<Button variant="outline" size="sm" class="mt-4" onclick={fetchListDetail}>
				Try again
			</Button>
		</div>
	{:else}
		<div class="space-y-6">
			<SearchForm clickedItem={handleClicked} list={editableList} />
			<StockList list={editableList} {newlyAddedSymbol} {shares} />
			<div
				class="space-y-2 rounded-md border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
			>
				<input
					type="text"
					class="w-full rounded-md border border-zinc-300 bg-transparent p-2 text-zinc-900 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:text-zinc-100"
					placeholder="List name"
					bind:value={listName}
				/>
				<div class="flex flex-col gap-2 sm:flex-row">
					<Button variant="outline" class="w-full sm:w-40" onclick={handleCancel}>
						Cancel
					</Button>
					<Button
						class="w-full sm:w-40"
						onclick={saveChanges}
						disabled={isSaving || editableList.length === 0}
					>
						{#if isSaving}
							Saving...
						{:else}
							Save Changes
						{/if}
					</Button>
				</div>
				{#if lastSavedAt}
					<p class="text-sm text-zinc-500 dark:text-zinc-400">
						Last updated {new Date(lastSavedAt).toLocaleString()}
					</p>
				{/if}
				{#if saveError}
					<p class="text-sm text-red-500">{saveError}</p>
				{/if}
			</div>
		</div>
	{/if}
</div>
