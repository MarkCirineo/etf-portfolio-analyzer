<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Plus from "@lucide/svelte/icons/plus";
	import * as Popover from "$lib/components/ui/popover";
	import { ACCOUNT_TYPE_LABELS } from "$lib/accounts";
	import { formatMoney, plural } from "$lib/format";
	import type { PortfolioView } from "$lib/stores/portfolio-view.svelte";
	import type { AccountSummary, AccountType } from "$lib/types";

	let { view }: { view: PortfolioView } = $props();

	let open = $state(false);

	type Option = {
		key: string;
		label: string;
		sub: string;
		value: number;
		scope: string[] | null;
	};

	const keyOf = (scope: string[] | null) => (scope ? [...scope].sort().join(",") : "all");

	const sum = (accounts: AccountSummary[]) =>
		accounts.reduce((total, account) => total + account.value, 0);

	const accounts = $derived(view.detail?.accounts ?? []);

	const groups = $derived.by(() => {
		const all: Option = {
			key: "all",
			label: "All accounts",
			sub: `${plural(accounts.length, "account")} combined`,
			value: sum(accounts),
			scope: null
		};

		const single: Option[] = accounts.map((account) => ({
			key: keyOf([account.id]),
			label: account.name,
			sub: [ACCOUNT_TYPE_LABELS[account.type], account.institution]
				.filter(Boolean)
				.join(" · "),
			value: account.value,
			scope: [account.id]
		}));

		// A type only becomes a group when it covers more than one account
		const byType = new Map<AccountType, AccountSummary[]>();
		for (const account of accounts) {
			byType.set(account.type, [...(byType.get(account.type) ?? []), account]);
		}

		const typeGroups: Option[] = Array.from(byType.entries())
			.filter(([, members]) => members.length > 1 && members.length < accounts.length)
			.map(([type, members]) => ({
				key: keyOf(members.map((account) => account.id)),
				label: `${ACCOUNT_TYPE_LABELS[type]} accounts`,
				sub: members.map((account) => account.name).join(", "),
				value: sum(members),
				scope: members.map((account) => account.id)
			}));

		return [
			{ title: "Combined", options: [all] },
			{ title: "One account", options: single },
			...(typeGroups.length ? [{ title: "By account type", options: typeGroups }] : [])
		];
	});

	const selectedKey = $derived(keyOf(view.detail?.scope ?? view.scope));

	const selectedLabel = $derived(
		groups.flatMap((group) => group.options).find((option) => option.key === selectedKey)
			?.label ?? "All accounts"
	);

	const pick = (option: Option) => {
		view.setScope(option.scope);
		open = false;
	};
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 text-sm shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
	>
		<span class="text-muted-foreground">Viewing</span>
		<span class="max-w-44 truncate font-semibold">{selectedLabel}</span>
		<ChevronDown class="size-4 text-muted-foreground" />
	</Popover.Trigger>

	<Popover.Content class="w-80 max-w-[calc(100vw-2rem)] p-1.5">
		{#each groups as group (group.title)}
			<div class="border-b py-1 last-of-type:border-b-0">
				<p
					class="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
				>
					{group.title}
				</p>
				{#each group.options as option (option.key)}
					<button
						type="button"
						aria-pressed={option.key === selectedKey}
						onclick={() => pick(option)}
						class="flex min-h-12 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent aria-pressed:bg-accent"
					>
						<span class="flex w-4 shrink-0 text-indigo-700 dark:text-indigo-300">
							{#if option.key === selectedKey}<Check class="size-4" />{/if}
						</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-semibold">{option.label}</span>
							<span class="block truncate text-xs text-muted-foreground"
								>{option.sub}</span
							>
						</span>
						<span class="font-mono text-xs tabular-nums"
							>{formatMoney(option.value)}</span
						>
					</button>
				{/each}
			</div>
		{/each}
		<a
			href="/accounts"
			onclick={() => (open = false)}
			class="mt-1 flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-indigo-700 hover:bg-accent dark:text-indigo-300"
		>
			<Plus class="size-4" />
			Add or edit accounts
		</a>
	</Popover.Content>
</Popover.Root>
