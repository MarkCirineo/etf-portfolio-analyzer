<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { request } from "$lib/request";
	import type { List } from "$lib/types";
	import Button from "$lib/components/ui/button/button.svelte";
	import { Plus, Calendar, Package } from "@lucide/svelte";
	import { toast } from "svelte-sonner";

	let lists = $state<List[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	const fetchLists = async () => {
		loading = true;
		error = null;

		try {
			const response = await request("/list", {
				method: "GET"
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.message ?? "Failed to fetch lists");
			}

			const body = await response.json();
			lists = body.data || [];
		} catch (err) {
			const message = err instanceof Error ? err.message : "Failed to fetch lists";
			error = message;
			toast.error(message);
		} finally {
			loading = false;
		}
	};

	const handleCreateList = () => {
		goto("/lists/new");
	};

	const formatDate = (dateString: string) => {
		const date = new Date(dateString);
		return date.toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric"
		});
	};

	const getHoldingsCount = (list: List) => {
		return Object.keys(list.content || {}).length;
	};

	onMount(() => {
		fetchLists();
	});
</script>

<div class="container mx-auto max-w-6xl px-4 py-8">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold text-zinc-900 dark:text-zinc-100">My Lists</h1>
			<p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
				Manage and view all your ETF portfolio lists
			</p>
		</div>
		<Button onclick={handleCreateList} class="gap-2">
			<Plus class="size-4" />
			Create New List
		</Button>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<p class="text-zinc-600 dark:text-zinc-400">Loading lists...</p>
		</div>
	{:else if error}
		<div
			class="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
		>
			<p class="text-sm text-red-800 dark:text-red-200">{error}</p>
			<Button variant="outline" size="sm" class="mt-4" onclick={fetchLists}>Try Again</Button>
		</div>
	{:else if lists.length === 0}
		<div
			class="rounded-md border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700"
		>
			<Package class="mx-auto mb-4 size-12 text-zinc-400 dark:text-zinc-600" />
			<h3 class="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
				No lists yet
			</h3>
			<p class="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
				Get started by creating your first ETF portfolio list
			</p>
			<Button onclick={handleCreateList} class="gap-2">
				<Plus class="size-4" />
				Create Your First List
			</Button>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each lists as list}
				<div
					class="group cursor-pointer rounded-lg border border-zinc-200 bg-white p-6 transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
					role="button"
					tabindex="0"
					onclick={() => goto(`/lists/${list.id}`)}
					onkeydown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							goto(`/lists/${list.id}`);
						}
					}}
				>
					<div class="mb-4">
						<h3 class="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
							{list.name || "Untitled List"}
						</h3>
					</div>
					<div class="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
						<div class="flex items-center gap-2">
							<Package class="size-4" />
							<span
								>{getHoldingsCount(list)} holding{getHoldingsCount(list) === 1
									? ""
									: "s"}</span
							>
						</div>
						<div class="flex items-center gap-2">
							<Calendar class="size-4" />
							<span>Updated {formatDate(list.updatedAt)}</span>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
