<script lang="ts">
	import { onDestroy } from "svelte";
	import { toast } from "svelte-sonner";
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import GitCompare from "@lucide/svelte/icons/git-compare";
	import Star from "@lucide/svelte/icons/star";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { Dashboard } from "$lib/components/dashboard";
	import Button from "$lib/components/ui/button/button.svelte";
	import { request } from "$lib/request";
	import { activeView, PortfolioView } from "$lib/stores/portfolio-view.svelte";

	const listId = page.params.listId;
	const view = new PortfolioView(`/list/${listId}/analysis`, { syncUrl: true });
	activeView.current = view;
	void view.load();

	let promoting = $state(false);

	const list = $derived(view.detail?.list ?? null);

	const makeMain = async () => {
		promoting = true;

		try {
			const response = await request(`/list/${listId}/primary`, { method: "POST" });
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to set main portfolio");
			}

			toast.success(`${list?.name ?? "This list"} is now your main portfolio`);
			await goto("/");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to set main portfolio");
		} finally {
			promoting = false;
		}
	};

	onDestroy(() => {
		view.destroy();
		if (activeView.current === view) {
			activeView.current = null;
		}
	});
</script>

<svelte:head>
	<title>{list?.name ?? "Scenario"} · ETF Portfolio Analyzer</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
	<a
		href="/lists"
		class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		All scenarios
	</a>
</div>

{#if view.loading}
	<div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-4 sm:px-6" aria-busy="true">
		<div class="h-20 w-80 max-w-full animate-pulse rounded-xl bg-muted"></div>
		<div class="h-96 animate-pulse rounded-2xl bg-muted"></div>
	</div>
{:else if view.error && !view.detail}
	<div class="mx-auto max-w-xl px-4 py-16">
		<div
			class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
		>
			<p>{view.error}</p>
			<Button variant="outline" class="mt-4" onclick={view.load}>Try again</Button>
		</div>
	</div>
{:else if list}
	<Dashboard
		{view}
		eyebrow={list.isPrimary ? "Main portfolio" : `Scenario · ${list.name}`}
		editHref={list.accounts.length > 1 || list.isPrimary
			? view.accountsHref
			: `/lists/${list.id}/edit`}
	>
		{#snippet actions()}
			{#if !list.isPrimary}
				<Button
					variant="outline"
					href="/lists/{list.id}/compare"
					class="min-h-11 gap-2 px-4"
				>
					<GitCompare class="size-4" />
					Compare
				</Button>
				<Button
					variant="outline"
					onclick={makeMain}
					disabled={promoting}
					class="min-h-11 gap-2 px-4"
				>
					<Star class="size-4" />
					Make main portfolio
				</Button>
			{/if}
		{/snippet}
	</Dashboard>
{/if}
