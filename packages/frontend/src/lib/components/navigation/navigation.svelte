<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { goto } from "$app/navigation";
	import Menu from "@lucide/svelte/icons/menu";
	import X from "@lucide/svelte/icons/x";
	import Home from "@lucide/svelte/icons/home";
	import { List as ListIcon } from "@lucide/svelte";
	import Plus from "@lucide/svelte/icons/plus";
	import Button from "$lib/components/ui/button/button.svelte";
	import { cn } from "$lib/utils";

	let isOpen = $state(false);

	const toggleMenu = () => {
		isOpen = !isOpen;
	};

	const closeMenu = () => {
		isOpen = false;
	};

	const navigateTo = (path: string) => {
		goto(path);
		closeMenu();
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape" && isOpen) {
			closeMenu();
		}
	};

	const handleClickOutside = (e: MouseEvent) => {
		const target = e.target as HTMLElement;
		const sidebar = document.querySelector(".navigation-sidebar");
		const trigger = document.querySelector(".navigation-trigger");

		if (isOpen && sidebar && !sidebar.contains(target) && !trigger?.contains(target)) {
			closeMenu();
		}
	};

	onMount(() => {
		if (typeof document !== "undefined") {
			document.addEventListener("keydown", handleKeyDown);
			document.addEventListener("mousedown", handleClickOutside);
		}
	});

	onDestroy(() => {
		if (typeof document !== "undefined") {
			document.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("mousedown", handleClickOutside);
		}
	});
</script>

<div class="navigation-container">
	<button
		class="navigation-trigger focus-visible:ring-ring bg-background hover:bg-accent fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-md border border-zinc-300 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 dark:border-zinc-700"
		onclick={toggleMenu}
		aria-label="Open navigation menu"
	>
		<Menu class="size-5" />
	</button>

	<!-- Overlay -->
	{#if isOpen}
		<div
			class="fixed inset-0 z-40 bg-black/50 transition-opacity"
			onclick={closeMenu}
			onkeydown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					closeMenu();
				}
			}}
			role="button"
			tabindex="-1"
			aria-label="Close navigation menu"
		></div>
	{/if}

	<!-- Sidebar -->
	<aside
		class={cn(
			"bg-background fixed left-0 top-0 z-50 h-full w-64 border-r border-zinc-200 shadow-lg transition-transform duration-300 ease-in-out dark:border-zinc-800",
			isOpen ? "translate-x-0" : "-translate-x-full"
		)}
	>
		<div class="flex h-full flex-col">
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800"
			>
				<h2 class="text-lg font-semibold">Navigation</h2>
				<button
					class="hover:bg-accent rounded-md p-1 transition-colors"
					onclick={closeMenu}
					aria-label="Close navigation menu"
				>
					<X class="size-5" />
				</button>
			</div>

			<!-- Navigation Links -->
			<nav class="flex-1 space-y-1 p-4">
				<Button
					variant="ghost"
					class="w-full justify-start gap-3"
					onclick={() => navigateTo("/")}
				>
					<Home class="size-4" />
					Home
				</Button>
				<Button
					variant="ghost"
					class="w-full justify-start gap-3"
					onclick={() => navigateTo("/lists")}
				>
					<ListIcon class="size-4" />
					My Lists
				</Button>
				<Button
					variant="ghost"
					class="w-full justify-start gap-3"
					onclick={() => navigateTo("/lists/new")}
				>
					<Plus class="size-4" />
					Create List
				</Button>
			</nav>
		</div>
	</aside>
</div>
