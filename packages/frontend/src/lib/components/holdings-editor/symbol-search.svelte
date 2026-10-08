<script lang="ts" module>
	type Result = { symbol: string; description: string; type: string };

	/** Searches already made this session, so retyping costs nothing. */
	const cache = new Map<string, Result[]>();
</script>

<script lang="ts">
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import { request } from "$lib/request";

	let {
		value = $bindable(""),
		input = $bindable(null),
		id,
		onpick
	}: {
		value: string;
		input: HTMLInputElement | null;
		id: string;
		/** Called after a suggestion fills in its ticker. */
		onpick?: (symbol: string) => void;
	} = $props();

	const MIN_LENGTH = 2;
	const DEBOUNCE_MS = 300;

	let results = $state<Result[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let loading = $state(false);
	let failed = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let latest = "";

	const listId = `${id}-suggestions`;

	const search = async (query: string) => {
		const key = query.toLowerCase();
		latest = key;

		if (cache.has(key)) {
			show(cache.get(key)!);
			return;
		}

		loading = true;
		failed = false;

		try {
			const response = await request(`/etf/search?q=${encodeURIComponent(query)}`);
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Search failed");
			}

			const found: Result[] = body?.data?.result ?? [];
			cache.set(key, found);

			// A slower, older search must not replace a newer one
			if (latest === key) {
				show(found);
			}
		} catch {
			if (latest === key) {
				failed = true;
				show([]);
			}
		} finally {
			if (latest === key) {
				loading = false;
			}
		}
	};

	const show = (found: Result[]) => {
		results = found;
		active = found.length > 0 ? 0 : -1;
		open = true;
	};

	const close = () => {
		open = false;
		active = -1;
	};

	const oninput = () => {
		if (timer) clearTimeout(timer);

		const query = value.trim();

		if (query.length < MIN_LENGTH) {
			latest = "";
			loading = false;
			close();
			return;
		}

		timer = setTimeout(() => void search(query), DEBOUNCE_MS);
	};

	const pick = (result: Result) => {
		value = result.symbol;
		close();
		onpick?.(result.symbol);
	};

	const onkeydown = (event: KeyboardEvent) => {
		if (!open || results.length === 0) {
			if (event.key === "Escape") close();
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			active = (active + 1) % results.length;
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			active = (active - 1 + results.length) % results.length;
		} else if (event.key === "Enter" && active >= 0) {
			// Choosing a suggestion, not submitting the form
			event.preventDefault();
			pick(results[active]);
		} else if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};
</script>

<div class="relative">
	<input
		{id}
		bind:this={input}
		bind:value
		{oninput}
		{onkeydown}
		onblur={close}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={listId}
		aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
		placeholder="Ticker or company, like SCHD or Apple"
		class="min-h-11 w-full rounded-lg border bg-card px-3 pr-9 focus:outline-none focus:ring-2 focus:ring-ring"
	/>
	{#if loading}
		<LoaderCircle
			class="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
			aria-hidden="true"
		/>
	{/if}

	{#if open}
		<ul
			id={listId}
			role="listbox"
			aria-label="Matching tickers"
			class="absolute inset-x-0 top-full z-20 mt-1.5 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
		>
			{#each results as result, index (result.symbol)}
				<!-- Pointer-down, not click, so it lands before the input's blur closes the list -->
				<li
					id="{listId}-{index}"
					role="option"
					aria-selected={index === active}
					onpointerdown={(event) => {
						event.preventDefault();
						pick(result);
					}}
					onpointerenter={() => (active = index)}
					class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent"
				>
					<span class="w-16 shrink-0 font-mono font-semibold">{result.symbol}</span>
					<span class="min-w-0 flex-1 truncate">{result.description}</span>
					<span class="shrink-0 text-xs text-muted-foreground">{result.type}</span>
				</li>
			{:else}
				<li class="px-3 py-2.5 text-sm text-muted-foreground" role="presentation">
					{failed
						? "Search isn't available right now. You can still type a ticker."
						: "No matches. If you know the ticker, type it in."}
				</li>
			{/each}
		</ul>
	{/if}
</div>
