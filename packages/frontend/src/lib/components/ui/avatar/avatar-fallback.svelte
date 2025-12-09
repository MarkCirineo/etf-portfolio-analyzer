<script lang="ts">
	import { Avatar as AvatarPrimitive, type WithoutChildrenOrChild } from "bits-ui";
	import type { Snippet } from "svelte";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChildrenOrChild<AvatarPrimitive.FallbackProps> & {
		children?: Snippet;
	} = $props();
</script>

<AvatarPrimitive.Fallback
	bind:ref
	class={cn(
		"flex h-full w-full items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase tracking-wide",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</AvatarPrimitive.Fallback>
