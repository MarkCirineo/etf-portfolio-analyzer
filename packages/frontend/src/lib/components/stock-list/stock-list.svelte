<script lang="ts">
	import type { SearchItem } from "$lib/types";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Check from "@lucide/svelte/icons/check";
	import X from "@lucide/svelte/icons/x";

	type Props = {
		list: SearchItem[];
		newlyAddedSymbol: string | null;
		shares: Record<string, number>;
	};

	const props: Props = $props();
	const { list, shares } = props;

	const shareInputs = $state<Record<string, string>>({});
	const editing = $state<Record<string, boolean>>({});

	$effect(() => {
		if (props.newlyAddedSymbol) {
			const symbol = props.newlyAddedSymbol;
			const existingValue = shares[symbol] ?? 0;
			shares[symbol] = existingValue;
			shareInputs[symbol] = existingValue.toString();
			editing[symbol] = true;
		}
	});

	const handleConfirm = (symbol: string) => {
		const parsed = Number(shareInputs[symbol] ?? "0");

		if (!Number.isFinite(parsed) || parsed < 0) {
			shareInputs[symbol] = shares[symbol]?.toString() ?? "0";
			return;
		}

		shares[symbol] = parsed;
		shareInputs[symbol] = parsed.toString();
		editing[symbol] = false;
	};

	const handleEdit = (symbol: string) => {
		shareInputs[symbol] = shares[symbol]?.toString() ?? "0";
		editing[symbol] = true;
	};

	const handleRemove = (item: SearchItem) => {
		const index = list.findIndex((i) => i.symbol === item.symbol);
		if (index < 0) {
			return;
		}

		list.splice(index, 1);
		delete shares[item.symbol];
		delete shareInputs[item.symbol];
		delete editing[item.symbol];
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
					type="text"
					inputmode="numeric"
					pattern="[0-9]*"
					class="w-16 rounded border border-zinc-300 p-1 text-center text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
					bind:value={shareInputs[item.symbol]}
				/>
				<button
					class="text-green-500 hover:text-green-600"
					onclick={() => handleConfirm(item.symbol)}
				>
					<Check class="h-4 w-4" />
				</button>
			{:else}
				<span class="text-zinc-900 dark:text-zinc-100">
					{shares[item.symbol] ?? 0} shares
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
