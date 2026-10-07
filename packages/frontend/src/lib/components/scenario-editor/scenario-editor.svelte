<script lang="ts">
	import { toast } from "svelte-sonner";
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import { goto } from "$app/navigation";
	import { HoldingsEditor } from "$lib/components/holdings-editor";
	import Button from "$lib/components/ui/button/button.svelte";
	import { formatMoney, plural } from "$lib/format";
	import { rowsValue, toHoldings, toRows, type HoldingRow } from "$lib/holdings";
	import { request } from "$lib/request";
	import type { ListDetail } from "$lib/types";

	/** Null to create a new scenario. */
	let { listId }: { listId: string | null } = $props();

	let name = $state(listId ? "" : "Untitled scenario");
	let rows = $state<HoldingRow[]>([]);
	let prices = $state(new Map<string, number>());
	let loading = $state(listId !== null);
	let error = $state<string | null>(null);
	let saving = $state(false);
	let saved = $state("");

	const backHref = listId ? `/lists/${listId}` : "/lists";
	const snapshot = () => JSON.stringify({ name, rows });
	const dirty = $derived(snapshot() !== saved);
	const total = $derived(rowsValue(rows, prices));

	const load = async (id: string) => {
		loading = true;
		error = null;

		try {
			const response = await request(`/list/${id}/analysis`);
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to load scenario");
			}

			const detail = body.data as ListDetail;

			// Several accounts are edited one at a time on the accounts page
			if (detail.list.accounts.length > 1) {
				await goto(detail.list.isPrimary ? "/accounts" : `/accounts?list=${id}`, {
					replaceState: true
				});
				return;
			}

			prices = new Map(
				detail.analysis.inputs
					.filter((input) => input.price !== null)
					.map((input) => [input.symbol, input.price!])
			);
			name = detail.list.name;
			rows = toRows(detail.list.content, prices);
			saved = snapshot();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load scenario";
		} finally {
			loading = false;
		}
	};

	$effect(() => {
		if (listId) {
			void load(listId);
		}
	});

	const save = async () => {
		const parsed = toHoldings(rows);

		if ("invalid" in parsed) {
			toast.error(`Shares for ${parsed.invalid} must be a number of zero or more`);
			return;
		}

		if (Object.keys(parsed.holdings).length === 0) {
			toast.error("Add at least one holding");
			return;
		}

		saving = true;

		try {
			const response = await request(listId ? `/list/${listId}` : "/list", {
				method: listId ? "PATCH" : "POST",
				body: JSON.stringify({ name: name.trim() || undefined, holdings: parsed.holdings })
			});
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to save scenario");
			}

			saved = snapshot();
			toast.success(`${body.data?.name ?? "Scenario"} saved`);
			await goto(`/lists/${body.data?.id ?? listId}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save scenario");
		} finally {
			saving = false;
		}
	};
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6 px-4 pb-16 pt-4 sm:px-6">
	<a
		href={backHref}
		class="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-muted-foreground hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		{listId ? "Back to scenario" : "All scenarios"}
	</a>

	<div>
		<p class="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
			Scenario
		</p>
		<h1 class="mt-1 text-3xl font-semibold tracking-tight">
			{listId ? "Edit scenario" : "New scenario"}
		</h1>
		<p class="mt-1.5 max-w-2xl text-muted-foreground">
			A what-if mix of funds and stocks. It's analysed just like your portfolio, and never
			touches your real accounts.
		</p>
	</div>

	{#if loading}
		<div class="h-[28rem] animate-pulse rounded-2xl bg-muted" aria-busy="true"></div>
	{:else if error}
		<div
			class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
		>
			<p>{error}</p>
			{#if listId}
				<Button variant="outline" class="mt-4" onclick={() => load(listId)}
					>Try again</Button
				>
			{/if}
		</div>
	{:else}
		<section aria-label="Scenario" class="flex flex-col gap-6 rounded-2xl border bg-card p-6">
			<div class="flex flex-col gap-1.5">
				<label for="scenario-name" class="text-[13px] font-medium">Name</label>
				<input
					id="scenario-name"
					type="text"
					maxlength="100"
					placeholder="e.g. Dividend tilt"
					bind:value={name}
					class="min-h-11 max-w-md rounded-lg border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
				/>
			</div>

			<HoldingsEditor
				bind:rows
				{prices}
				title="Holdings"
				empty="No holdings yet. Add the funds and stocks for this scenario below."
			/>

			<div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
				<p class="text-sm text-muted-foreground">
					{plural(rows.length, "holding")}{total > 0
						? ` · ${formatMoney(total)} at today's prices`
						: ""}
				</p>
				<div class="flex gap-2">
					<Button variant="outline" href={backHref} class="min-h-11 px-4">Cancel</Button>
					<Button
						class="min-h-11 px-5"
						onclick={save}
						disabled={saving || rows.length === 0 || (listId !== null && !dirty)}
					>
						{saving ? "Saving…" : listId ? "Save changes" : "Create scenario"}
					</Button>
				</div>
			</div>
		</section>
	{/if}
</div>
