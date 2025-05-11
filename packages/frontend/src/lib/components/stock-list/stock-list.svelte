<script lang="ts">
	import type { SearchItem } from "$lib/types";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Check from "@lucide/svelte/icons/check";
	import X from "@lucide/svelte/icons/x";

	type Props = {
		list: SearchItem[];
		newlyAddedSymbol: string | null;
	};

	const { list, newlyAddedSymbol }: Props = $props();

	const shares = $state<Record<string, number>>({});

	const editing = $state<Record<string, boolean>>({});

	$effect(() => {
		if (newlyAddedSymbol) {
			shares[newlyAddedSymbol] = 0;
			editing[newlyAddedSymbol] = true;
		}
	});

	const handleConfirm = (symbol: string, value: number) => {
		shares[symbol] = value;
		editing[symbol] = false;
	};

	const handleEdit = (symbol: string) => {
		editing[symbol] = true;
	};

	const handleRemove = (item: SearchItem) => {
		const index = list.findIndex((i) => i.symbol === item.symbol);
		if (index >= 0) {
			list.splice(index, 1);
		}
	};
</script>

{#each list as item}
	<div class="mt-2 flex w-full justify-between p-4 text-left dark:bg-zinc-900">
		<div class="flex w-1/2 items-center space-x-4">
			<X class="h-4 w-4 cursor-pointer" onclick={() => handleRemove(item)} />
			<div>
				<div class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
					{item.symbol}
				</div>
				<div class="text-sm text-zinc-500 dark:text-zinc-400">
					{item.description}
				</div>
			</div>
		</div>
		<div class="mt-2 flex items-center space-x-2">
			{#if editing[item.symbol]}
				<input
					type="number"
					class="w-16 rounded border border-zinc-300 p-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
					bind:value={shares[item.symbol]}
				/>
				<button
					class="text-green-500 hover:text-green-600"
					onclick={() => handleConfirm(item.symbol, shares[item.symbol])}
				>
					<Check class="h-4 w-4" />
				</button>
			{:else}
				<span class="text-zinc-900 dark:text-zinc-100">
					{shares[item.symbol] || 0} shares
				</span>
				<button
					class="text-blue-500 hover:text-blue-600"
					onclick={() => handleEdit(item.symbol)}
				>
					<Pencil class="h-4 w-4" />
				</button>
			{/if}
		</div>
	</div>
{/each}
