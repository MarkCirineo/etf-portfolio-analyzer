<script lang="ts">
	import { Avatar as AvatarPrimitive, type WithoutChildrenOrChild } from "bits-ui";
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<AvatarPrimitive.RootProps> & {
		children?: Snippet;
	} = $props();
</script>

<AvatarPrimitive.Root
	bind:ref
	class={cn(
		"relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border/60 bg-muted text-muted-foreground",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</AvatarPrimitive.Root>
