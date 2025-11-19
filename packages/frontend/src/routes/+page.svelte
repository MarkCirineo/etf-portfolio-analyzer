<script lang="ts">
	import { Plus, List as ListIcon } from "@lucide/svelte";
	import { goto } from "$app/navigation";
	import Button from "$lib/components/ui/button/button.svelte";

	const handleCreateList = () => {
		goto("/lists/new");
	};

	const handleViewLists = () => {
		goto("/lists");
	};
</script>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-2xl space-y-8 text-center">
		<div class="space-y-4">
			<h1
				class="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-100"
			>
				ETF Portfolio Analyzer
			</h1>
			<p class="text-lg text-zinc-600 dark:text-zinc-400">
				Create and manage your ETF portfolios with ease. Track your holdings and analyze
				your investments.
			</p>
		</div>

		<div class="flex flex-col gap-4 sm:flex-row sm:justify-center">
			<Button size="lg" onclick={handleCreateList} class="gap-2">
				<Plus class="size-5" />
				Create New List
			</Button>
			<Button size="lg" variant="outline" onclick={handleViewLists} class="gap-2">
				<ListIcon class="size-5" />
				View My Lists
			</Button>
		</div>
	</div>
</div>
