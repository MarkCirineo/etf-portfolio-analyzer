<script lang="ts">
	import Input from "$lib/components/ui/input/input.svelte";
	import { cn } from "$lib/utils";
	import Search from "@lucide/svelte/icons/search";

	// Clicking on search icon should focus the input field
	const focusInput = (event: Event) => {
		const input = (event.currentTarget as HTMLElement).parentElement?.querySelector(
			"input"
		) as HTMLInputElement;
		input?.focus();
	};

	type Props = {
		value: string;
		class?: string;
	};

	let { value = $bindable(), class: className, ...restProps }: Props = $props();
</script>

<div class="relative w-full" data-command-input-wrapper="">
	<Search
		class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform cursor-text text-gray-400"
		tabindex={0}
		onclick={focusInput}
	/>
	<Input
		type="text"
		bind:value
		placeholder="Search..."
		class={cn(
			"w-full rounded-md border py-2 pl-10 pr-4 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500",
			className
		)}
		{...restProps}
	/>
</div>
