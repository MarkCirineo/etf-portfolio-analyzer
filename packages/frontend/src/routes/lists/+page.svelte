<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import Copy from "@lucide/svelte/icons/copy";
	import Package from "@lucide/svelte/icons/package";
	import Plus from "@lucide/svelte/icons/plus";
	import { goto } from "$app/navigation";
	import Button from "$lib/components/ui/button/button.svelte";
	import { formatDate, plural } from "$lib/format";
	import { request } from "$lib/request";
	import type { List } from "$lib/types";

	let lists = $state<List[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let copying = $state(false);

	const main = $derived(lists.find((list) => list.isPrimary) ?? null);
	const scenarios = $derived(lists.filter((list) => !list.isPrimary));

	const fetchLists = async () => {
		loading = true;
		error = null;

		try {
			const response = await request("/list");
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to fetch lists");
			}

			lists = body.data ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to fetch lists";
		} finally {
			loading = false;
		}
	};

	/** A scenario starts as a copy of everything in the main portfolio, combined. */
	const copyMain = async () => {
		if (!main) return;

		copying = true;

		try {
			const response = await request("/list", {
				method: "POST",
				body: JSON.stringify({
					name: `What if… (from ${main.name})`,
					holdings: main.content
				})
			});
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to copy portfolio");
			}

			await goto(`/lists/${body.data.id}/edit`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to copy portfolio");
		} finally {
			copying = false;
		}
	};

	onMount(fetchLists);
</script>

<svelte:head>
	<title>Scenarios · ETF Portfolio Analyzer</title>
</svelte:head>

{#snippet card(list: List, badge: string | null, href: string)}
	<a
		{href}
		class="group flex flex-col gap-3 rounded-2xl border bg-card p-5 transition-colors hover:border-zinc-300 hover:bg-accent/40 dark:hover:border-zinc-700"
	>
		<div class="flex items-start justify-between gap-2">
			<h3 class="truncate text-lg font-semibold">{list.name || "Untitled"}</h3>
			{#if badge}
				<span
					class="shrink-0 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
					>{badge}</span
				>
			{/if}
		</div>
		<p class="truncate font-mono text-[13px] text-muted-foreground">
			{Object.keys(list.content).slice(0, 6).join(" · ") || "No holdings"}
		</p>
		<p class="mt-auto text-xs text-muted-foreground">
			{plural(Object.keys(list.content).length, "holding")}{list.accounts.length > 1
				? ` · ${plural(list.accounts.length, "account")}`
				: ""} · updated {formatDate(list.updatedAt)}
		</p>
	</a>
{/snippet}

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-16 pt-8 sm:px-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">Scenarios</h1>
			<p class="mt-1.5 max-w-2xl text-muted-foreground">
				Try out a different mix without touching your real portfolio: swap a fund, add a new
				one, and see how fees, income, sectors and overlap would change.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if main}
				<Button
					variant="outline"
					onclick={copyMain}
					disabled={copying}
					class="min-h-11 gap-2 px-4"
				>
					<Copy class="size-4" />
					Start from my portfolio
				</Button>
			{/if}
			<Button href="/lists/new" class="min-h-11 gap-2 px-4">
				<Plus class="size-4" />
				New scenario
			</Button>
		</div>
	</div>

	{#if loading}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
			{#each Array(3) as _, index (index)}
				<div class="h-36 animate-pulse rounded-2xl bg-muted"></div>
			{/each}
		</div>
	{:else if error}
		<div
			class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
		>
			<p>{error}</p>
			<Button variant="outline" class="mt-4" onclick={fetchLists}>Try again</Button>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#if main}
				{@render card(main, "Main portfolio", "/")}
			{/if}
			{#each scenarios as list (list.id)}
				{@render card(list, null, `/lists/${list.id}`)}
			{/each}
		</div>
		{#if scenarios.length === 0}
			<div class="rounded-2xl border border-dashed p-10 text-center">
				<Package class="mx-auto mb-3 size-10 text-muted-foreground" />
				<h2 class="font-semibold">No scenarios yet</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					{main
						? "Start from a copy of your portfolio, or build one from scratch."
						: "Build a list of funds to see what you'd own."}
				</p>
			</div>
		{/if}
	{/if}
</div>
