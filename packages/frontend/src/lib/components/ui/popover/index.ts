import { Popover as PopoverPrimitive } from "bits-ui";
import Content from "./popover-content.svelte";

const Root: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;
const Trigger: typeof PopoverPrimitive.Trigger = PopoverPrimitive.Trigger;
const Anchor: typeof PopoverPrimitive.Anchor = PopoverPrimitive.Anchor;

export {
	Root,
	Trigger,
	Anchor,
	Content,
	//
	Root as Popover,
	Trigger as PopoverTrigger,
	Anchor as PopoverAnchor,
	Content as PopoverContent
};
