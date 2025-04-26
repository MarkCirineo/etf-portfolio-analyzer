<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import Search from "@lucide/svelte/icons/search";
	import { cn } from "$lib/utils.js";

	// Clicking on search icon should focus the input field
	const focusInput = (event: Event) => {
		const input = (event.currentTarget as HTMLElement).parentElement?.querySelector(
			"input"
		) as HTMLInputElement;
		input?.focus();
	};

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(""),
		...restProps
	}: CommandPrimitive.InputProps = $props();
</script>

<div class="relative w-full" data-command-input-wrapper="">
	<Search
		class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform cursor-text text-gray-400"
		tabindex={0}
		onclick={focusInput}
	/>
	<CommandPrimitive.Input
		placeholder="Search..."
		class={cn(
			"placeholder:text-muted-foreground w-full rounded-md border bg-transparent py-2 pl-10 pr-4 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50",
			className
		)}
		bind:ref
		bind:value
		{...restProps}
	/>
</div>
