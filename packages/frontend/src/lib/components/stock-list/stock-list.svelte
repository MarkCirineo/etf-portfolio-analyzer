<script lang="ts">
	import type { SearchItem } from "$lib/types";

	const { list } = $props<{ list: SearchItem[] }>();
</script>

{#each list as item}
	<div class="mt-2 w-full p-4 pl-6 text-left dark:bg-zinc-900">
		<div class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
			{item.symbol}
		</div>
		<div class="text-sm text-zinc-500 dark:text-zinc-400">
			{item.description}
		</div>
	</div>
{/each}
