<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import {
		ACCOUNT_TYPE_BADGE,
		ACCOUNT_TYPE_COLORS,
		ACCOUNT_TYPE_LABELS,
		ACCOUNT_TYPES
	} from "$lib/accounts";
	import { formatMoney, formatPercent, plural } from "$lib/format";
	import type { AccountSummary } from "$lib/types";
	import { cn } from "$lib/utils";

	let {
		accounts,
		scope,
		colors,
		accountsHref,
		onselect
	}: {
		accounts: AccountSummary[];
		scope: string[] | null;
		colors: Map<string, string>;
		/** The page for adding or editing this list's accounts. */
		accountsHref: string;
		onselect: (scope: string[] | null) => void;
	} = $props();

	const total = $derived(accounts.reduce((sum, account) => sum + account.value, 0));
	const institutions = $derived(
		new Set(accounts.map((account) => account.institution).filter(Boolean)).size
	);

	const byType = $derived(
		ACCOUNT_TYPES.map((type) => {
			const value = accounts
				.filter((account) => account.type === type)
				.reduce((sum, account) => sum + account.value, 0);
			return { type, value, percent: total > 0 ? (value / total) * 100 : 0 };
		}).filter((entry) => entry.value > 0)
	);

	const isSelected = (account: AccountSummary) => scope !== null && scope.includes(account.id);

	const toggle = (account: AccountSummary) => {
		// Selecting the only account in view again goes back to all of them
		onselect(scope?.length === 1 && scope[0] === account.id ? null : [account.id]);
	};
</script>

<section aria-labelledby="accounts-title" class="rounded-2xl border bg-card p-5">
	<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
		<div>
			<h2 id="accounts-title" class="text-base font-semibold">Accounts</h2>
			<p class="mt-1 text-[13px] text-muted-foreground">
				{plural(accounts.length, "account")}{institutions > 1
					? ` at ${institutions} brokerages`
					: ""}, combined into one portfolio · select one to focus on it
			</p>
		</div>
		{#if byType.length > 1}
			<div class="w-full max-w-sm">
				<div
					class="mb-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"
				>
					{#each byType as entry (entry.type)}
						<span>
							{ACCOUNT_TYPE_LABELS[entry.type]}
							<span class="font-mono font-semibold tabular-nums text-foreground"
								>{formatPercent(entry.percent, 1)}</span
							>
						</span>
					{/each}
				</div>
				<div
					role="img"
					aria-label={`By account type: ${byType.map((entry) => `${ACCOUNT_TYPE_LABELS[entry.type]} ${formatPercent(entry.percent, 1)}`).join(", ")}`}
					class="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
				>
					{#each byType as entry (entry.type)}
						<div
							style:width="{entry.percent}%"
							style:background={ACCOUNT_TYPE_COLORS[entry.type]}
						></div>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<div class="mt-4 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
		{#each accounts as account (account.id)}
			{@const selected = isSelected(account)}
			{@const positions = account.positions.filter((position) => (position.value ?? 0) > 0)}
			<button
				type="button"
				aria-pressed={selected}
				onclick={() => toggle(account)}
				class={cn(
					"flex flex-col gap-2.5 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/60",
					selected &&
						"border-indigo-700 ring-1 ring-indigo-700 dark:border-indigo-400 dark:ring-indigo-400"
				)}
			>
				<span class="flex w-full items-start justify-between gap-2">
					<span class="min-w-0">
						<span class="block font-semibold leading-snug">{account.name}</span>
						<span class="block truncate text-xs text-muted-foreground"
							>{account.institution ?? " "}</span
						>
					</span>
					<span
						class={cn(
							"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
							ACCOUNT_TYPE_BADGE[account.type]
						)}
					>
						{ACCOUNT_TYPE_LABELS[account.type]}
					</span>
				</span>
				<span class="flex w-full items-baseline justify-between gap-2">
					<span class="font-mono text-xl font-semibold tabular-nums"
						>{formatMoney(account.value)}</span
					>
					<span class="font-mono text-xs tabular-nums text-muted-foreground">
						{formatPercent(account.percentOfPortfolio, 1)}
					</span>
				</span>
				<span
					aria-hidden="true"
					class="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
				>
					{#each positions as position (position.symbol)}
						<span
							style:width="{position.percentOfAccount ?? 0}%"
							style:background={colors.get(position.symbol)}
						></span>
					{/each}
				</span>
				<span class="line-clamp-2 text-xs text-muted-foreground">
					{#if positions.length === 0}
						No holdings yet
					{:else}
						{positions
							.map(
								(position) =>
									`${position.symbol} ${Math.round(position.percentOfAccount ?? 0)}%`
							)
							.join(" · ")}
					{/if}
				</span>
			</button>
		{/each}
		<a
			href="{accountsHref}{accountsHref.includes('?') ? '&' : '?'}new=1"
			class="flex min-h-36 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
		>
			<Plus class="size-5" />
			Add account
		</a>
	</div>
</section>
