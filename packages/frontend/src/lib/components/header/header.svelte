<script lang="ts">
	import { onMount } from "svelte";

	import UserRound from "@lucide/svelte/icons/user-round";
	import LogOut from "@lucide/svelte/icons/log-out";

	import LightSwitch from "$lib/components/ui/light-switch/light-switch.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import { AuthDialog } from "$lib/components/auth";
	import * as Avatar from "$lib/components/ui/avatar";
	import * as Popover from "$lib/components/ui/popover";
	import { auth, refreshSession, logout } from "$lib/stores/auth.svelte";
	import type { AuthUser } from "$lib/types";

	let accountMenuOpen = $state(false);

	onMount(() => {
		refreshSession();
	});

	const getInitials = (user?: AuthUser | null): string | null => {
		if (!user) return null;
		const base = user.username?.trim() || user.email?.trim();
		if (!base) return null;
		const parts = base.split(/\s+/).filter(Boolean);
		if (!parts.length) return null;
		if (parts.length === 1) {
			return parts[0]!.slice(0, 2).toUpperCase();
		}
		return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
	};

	const formatAvatarSrc = (avatar?: string | null): string | null => {
		if (!avatar) return null;
		const trimmed = avatar.trim();
		if (!trimmed) return null;
		return trimmed.startsWith("data:") ? trimmed : `data:image/png;base64,${trimmed}`;
	};

	const handleLogout = () => {
		logout();
		accountMenuOpen = false;
	};

	const userInitials = $derived(getInitials(auth.user));
	const avatarSrc = $derived(formatAvatarSrc(auth.user?.avatar ?? null));
</script>

<Popover.Root bind:open={accountMenuOpen}>
	<Popover.Trigger
		class="avatar-trigger focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2"
		aria-label="Open account menu"
	>
		<Avatar.Root>
			{#if avatarSrc}
				<Avatar.Image src={avatarSrc} alt="Profile avatar" />
				<Avatar.Fallback class="sr-only">
					{userInitials}
				</Avatar.Fallback>
			{:else if userInitials}
				<Avatar.Fallback>{userInitials}</Avatar.Fallback>
			{:else}
				<Avatar.Fallback class="text-muted-foreground">
					<UserRound class="size-4" />
				</Avatar.Fallback>
			{/if}
		</Avatar.Root>
	</Popover.Trigger>

	<Popover.Content sideOffset={14} align="end" class="account-popover w-72 p-0">
		<div class="space-y-4 p-4">
			<div class="space-y-1">
				<p class="text-foreground text-sm font-medium">
					{#if auth.status === "authenticated" && auth.user}
						{auth.user.username || auth.user.email}
					{:else}
						Account
					{/if}
				</p>
				<p class="text-muted-foreground text-xs">
					{#if auth.status === "authenticated" && auth.user}
						{auth.user.email}
					{:else if auth.status === "loading" || auth.status === "idle"}
						Checking session…
					{:else}
						Sign in to sync watchlists and preferences.
					{/if}
				</p>
			</div>

			{#if auth.status === "authenticated" && auth.user}
				<Button variant="ghost" class="w-full justify-between" onclick={handleLogout}>
					Log out
					<LogOut class="size-4" />
				</Button>
			{:else if auth.status === "loading" || auth.status === "idle"}
				<div class="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
					Hang tight while we verify your session.
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<AuthDialog
						mode="login"
						triggerVariant="ghost"
						triggerSize="sm"
						class="w-full justify-start"
					/>
					<AuthDialog
						mode="signup"
						triggerVariant="default"
						triggerSize="sm"
						class="w-full justify-start"
					/>
				</div>
			{/if}

			<div class="space-y-2 border-t pt-3">
				<div class="flex items-center justify-between text-sm">
					<span class="text-muted-foreground">Appearance</span>
					<LightSwitch />
				</div>
			</div>
		</div>
	</Popover.Content>
</Popover.Root>
