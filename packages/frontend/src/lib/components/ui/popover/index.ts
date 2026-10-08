import { Popover as PopoverPrimitive } from "bits-ui";
import Content from "./popover-content.svelte";

const Root: typeof PopoverPrimitive.Root = PopoverPrimitive.Root;
const Trigger: typeof PopoverPrimitive.Trigger = PopoverPrimitive.Trigger;

export {
	Root,
	Trigger,
	Content,
	//
	Root as Popover,
	Trigger as PopoverTrigger,
	Content as PopoverContent
};
