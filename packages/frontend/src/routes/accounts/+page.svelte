<script lang="ts">
	import { onDestroy } from "svelte";
	import { toast } from "svelte-sonner";
	import Plus from "@lucide/svelte/icons/plus";
	import { page } from "$app/state";
	import { AuthDialog } from "$lib/components/auth";
	import Button from "$lib/components/ui/button/button.svelte";
	import { HoldingsEditor } from "$lib/components/holdings-editor";
	import { rowsValue, toHoldings, toRows, type HoldingRow } from "$lib/holdings";
	import { ACCOUNT_TYPE_BADGE, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES } from "$lib/accounts";
	import { formatMoney, formatPercent, plural } from "$lib/format";
	import { request } from "$lib/request";
	import { auth } from "$lib/stores/auth.svelte";
	import { PortfolioView } from "$lib/stores/portfolio-view.svelte";
	import type { Account, AccountType } from "$lib/types";
	import { cn } from "$lib/utils";

	type Draft = {
		/** Null while adding a new account. */
		id: string | null;
		name: string;
		institution: string;
		type: AccountType;
		rows: HoldingRow[];
	};

	const NEW = "new";

	// ?list= edits a scenario's accounts; otherwise the main portfolio's
	const listParam = page.url.searchParams.get("list");
	const view = new PortfolioView(listParam ? `/list/${listParam}/analysis` : "/portfolio");
	const dashboardHref = listParam ? `/lists/${listParam}` : "/";

	let selected = $state<string | null>(page.url.searchParams.has("new") ? NEW : null);
	let draft = $state<Draft | null>(null);
	let saved = $state("");
	let saving = $state(false);
	let started = false;

	$effect(() => {
		if (auth.status === "authenticated" && !started) {
			started = true;
			void view.load();
		}
	});

	onDestroy(view.destroy);

	const list = $derived(view.detail?.list ?? null);
	const accounts = $derived(list?.accounts ?? []);
	const summaries = $derived(new Map((view.detail?.accounts ?? []).map((s) => [s.id, s])));
	const total = $derived(
		(view.detail?.accounts ?? []).reduce((sum, summary) => sum + summary.value, 0)
	);

	/** Latest price per symbol, from whichever account holds it. */
	const prices = $derived.by(() => {
		const map = new Map<string, number>();
		for (const summary of view.detail?.accounts ?? []) {
			for (const position of summary.positions) {
				if (position.price !== null) map.set(position.symbol, position.price);
			}
		}
		for (const input of view.detail?.analysis.inputs ?? []) {
			if (input.price !== null) map.set(input.symbol, input.price);
		}
		return map;
	});

	const toDraft = (account: Account | null): Draft =>
		account
			? {
					id: account.id,
					name: account.name,
					institution: account.institution ?? "",
					type: account.type,
					rows: toRows(account.holdings, prices)
				}
			: {
					id: null,
					name: accounts.length === 0 ? "Brokerage account" : "",
					institution: "",
					type: "taxable",
					rows: []
				};

	const snapshot = (value: Draft | null) => JSON.stringify(value);
	const dirty = $derived(draft !== null && snapshot(draft) !== saved);

	const open = (id: string | null) => {
		if (dirty && !confirm("Discard your unsaved changes to this account?")) {
			return;
		}

		selected = id;
		draft = toDraft(
			id && id !== NEW ? (accounts.find((account) => account.id === id) ?? null) : null
		);
		saved = snapshot(draft);
	};

	// Pick an account once they load, or after the selected one disappears
	$effect(() => {
		if (view.loading) return;

		const exists = selected === NEW || accounts.some((account) => account.id === selected);

		if (!exists || draft === null) {
			const next =
				selected === NEW || accounts.length === 0
					? NEW
					: exists
						? selected
						: accounts[0].id;
			selected = next;
			draft = toDraft(
				next === NEW ? null : (accounts.find((account) => account.id === next) ?? null)
			);
			saved = snapshot(draft);
		}
	});

	const otherAccountsWith = (symbol: string) =>
		accounts
			.filter((account) => account.id !== draft?.id && account.holdings[symbol] !== undefined)
			.map((account) => account.name);

	const draftValue = $derived(draft ? rowsValue(draft.rows, prices) : 0);

	const discard = () => {
		saved = snapshot(draft);
		open(selected);
	};

	const save = async () => {
		if (!draft) return;

		const parsed = toHoldings(draft.rows);

		if ("invalid" in parsed) {
			toast.error(`Shares for ${parsed.invalid} must be a number of zero or more`);
			return;
		}

		const { holdings } = parsed;

		const account = {
			name: draft.name.trim(),
			institution: draft.institution.trim() || null,
			type: draft.type,
			holdings
		};

		saving = true;

		try {
			let response: Response;

			if (!list) {
				// The first account creates the main portfolio
				response = await request("/list", {
					method: "POST",
					body: JSON.stringify({ name: "My portfolio", accounts: [account] })
				});
			} else if (draft.id === null) {
				response = await request(`/list/${list.id}/accounts`, {
					method: "POST",
					body: JSON.stringify(account)
				});
			} else {
				response = await request(`/list/${list.id}/accounts/${draft.id}`, {
					method: "PATCH",
					body: JSON.stringify(account)
				});
			}

			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to save account");
			}

			const savedId: string | undefined = list ? body.data?.id : body.data?.accounts?.[0]?.id;
			toast.success(`${account.name || "Account"} saved`);

			await view.load();
			saved = snapshot(draft);
			if (savedId) {
				selected = savedId;
				draft = toDraft(accounts.find((entry) => entry.id === savedId) ?? null);
				saved = snapshot(draft);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save account");
		} finally {
			saving = false;
		}
	};

	const remove = async () => {
		if (!draft?.id || !list) return;

		if (!confirm(`Delete ${draft.name}? Its holdings will be removed from your portfolio.`)) {
			return;
		}

		saving = true;

		try {
			const response = await request(`/list/${list.id}/accounts/${draft.id}`, {
				method: "DELETE"
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				throw new Error(body?.message ?? "Failed to delete account");
			}

			toast.success(`${draft.name} deleted`);
			saved = snapshot(draft);
			selected = null;
			draft = null;
			await view.load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete account");
		} finally {
			saving = false;
		}
	};
</script>

<svelte:head>
	<title>Accounts · ETF Portfolio Analyzer</title>
</svelte:head>

<div class="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-16 pt-8 sm:px-6">
	<div>
		<p class="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
			{list && !list.isPrimary ? `Scenario · ${list.name}` : "Your portfolio"}
		</p>
		<h1 class="mt-1 text-3xl font-semibold tracking-tight">Accounts</h1>
		<p class="mt-1.5 max-w-2xl text-muted-foreground">
			Add each brokerage account and what's in it. Everything here is added together on your
			dashboard, so the same fund in two accounts counts once, combined.
		</p>
	</div>

	{#if auth.status === "unauthenticated"}
		<div class="flex flex-col items-start gap-3 rounded-2xl border bg-card p-6">
			<p>Sign in to add your accounts.</p>
			<div class="flex gap-2">
				<AuthDialog mode="login" />
				<AuthDialog mode="signup" />
			</div>
		</div>
	{:else if view.loading || auth.status !== "authenticated"}
		<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]" aria-busy="true">
			<div class="h-80 animate-pulse rounded-2xl bg-muted"></div>
			<div class="h-[30rem] animate-pulse rounded-2xl bg-muted"></div>
		</div>
	{:else if view.error && !view.detail && !view.empty}
		<div
			class="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
		>
			<p>{view.error}</p>
			<Button variant="outline" class="mt-4" onclick={view.load}>Try again</Button>
		</div>
	{:else}
		<div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
			<section
				aria-labelledby="list-title"
				class="flex flex-col gap-1.5 rounded-2xl border bg-card p-3"
			>
				<h2
					id="list-title"
					class="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
				>
					{plural(accounts.length, "account")}
				</h2>
				{#each accounts as account (account.id)}
					{@const summary = summaries.get(account.id)}
					<button
						type="button"
						aria-pressed={selected === account.id}
						onclick={() => open(account.id)}
						class={cn(
							"flex min-h-16 items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-accent",
							selected === account.id &&
								"border-indigo-700 bg-indigo-50 hover:bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/60 dark:hover:bg-indigo-950/60"
						)}
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-semibold">{account.name}</span>
							<span
								class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"
							>
								<span
									class={cn(
										"rounded-full px-1.5 py-px text-[11px] font-semibold",
										ACCOUNT_TYPE_BADGE[account.type]
									)}>{ACCOUNT_TYPE_LABELS[account.type]}</span
								>
								<span class="truncate">{account.institution ?? ""}</span>
							</span>
						</span>
						<span class="font-mono font-semibold tabular-nums"
							>{formatMoney(summary?.value)}</span
						>
					</button>
				{/each}
				{#if accounts.length > 1}
					<div class="mx-3 mt-1 flex justify-between border-t pb-1 pt-3 font-semibold">
						<span>All accounts</span>
						<span class="font-mono tabular-nums">{formatMoney(total)}</span>
					</div>
				{/if}
				<button
					type="button"
					aria-pressed={selected === NEW}
					onclick={() => open(NEW)}
					class={cn(
						"mt-1.5 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed px-3.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
						selected === NEW &&
							"border-indigo-700 text-foreground dark:border-indigo-400"
					)}
				>
					<Plus class="size-4" />
					Add account
				</button>
			</section>

			{#if draft}
				<section
					aria-labelledby="editor-title"
					class="flex min-w-0 flex-col gap-6 rounded-2xl border bg-card p-6"
				>
					<div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
						<div>
							<h2 id="editor-title" class="text-xl font-semibold tracking-tight">
								{draft.id ? draft.name || "Untitled account" : "New account"}
							</h2>
							<p class="mt-1 text-muted-foreground">
								<span class="font-mono tabular-nums">{formatMoney(draftValue)}</span
								>
								{#if total > 0 && draft.id}
									· <span class="font-mono tabular-nums"
										>{formatPercent((draftValue / total) * 100, 1)}</span
									> of your portfolio
								{/if}
								· {plural(draft.rows.length, "holding")}
							</p>
						</div>
						{#if list}
							<a
								href={dashboardHref}
								class="py-3 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300"
								>View on dashboard</a
							>
						{/if}
					</div>

					<div class="grid gap-4 sm:grid-cols-3">
						<div class="flex flex-col gap-1.5">
							<label for="account-name" class="text-[13px] font-medium"
								>Account name</label
							>
							<input
								id="account-name"
								type="text"
								maxlength="100"
								placeholder="e.g. Schwab Roth IRA"
								bind:value={draft.name}
								class="min-h-11 rounded-lg border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<label for="account-institution" class="text-[13px] font-medium">
								Brokerage <span class="font-normal text-muted-foreground"
									>(optional)</span
								>
							</label>
							<input
								id="account-institution"
								type="text"
								maxlength="100"
								placeholder="e.g. Charles Schwab"
								bind:value={draft.institution}
								class="min-h-11 rounded-lg border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<div class="flex flex-col gap-1.5">
							<label for="account-type" class="text-[13px] font-medium"
								>Account type</label
							>
							<select
								id="account-type"
								bind:value={draft.type}
								class="min-h-11 rounded-lg border bg-background px-3 focus:outline-none focus:ring-2 focus:ring-ring"
							>
								{#each ACCOUNT_TYPES as type (type)}
									<option value={type}>{ACCOUNT_TYPE_LABELS[type]}</option>
								{/each}
							</select>
						</div>
					</div>

					<HoldingsEditor
						bind:rows={draft.rows}
						{prices}
						title="Holdings in this account"
						empty="No holdings yet. Add the funds and stocks this account holds below."
						alsoIn={otherAccountsWith}
					/>

					<div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
						{#if draft.id && accounts.length > 1}
							<button
								type="button"
								onclick={remove}
								disabled={saving}
								class="min-h-11 px-1 text-sm font-medium text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
							>
								Delete account
							</button>
						{:else}
							<span></span>
						{/if}
						<div class="flex gap-2">
							{#if dirty && draft.id}
								<Button variant="outline" class="min-h-11 px-4" onclick={discard}>
									Discard changes
								</Button>
							{/if}
							<Button
								class="min-h-11 px-5"
								onclick={save}
								disabled={saving ||
									(!dirty && draft.id !== null) ||
									(!list && draft.rows.length === 0)}
							>
								{saving ? "Saving…" : draft.id ? "Save changes" : "Add account"}
							</Button>
						</div>
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>
