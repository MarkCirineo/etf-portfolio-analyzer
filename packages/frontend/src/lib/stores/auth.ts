import { writable } from "svelte/store";
import { request } from "$lib/request";
import type { AuthUser } from "$lib/types";

type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

type AuthState = {
	user: AuthUser | null;
	status: AuthStatus;
	error: string | null;
};

const initialState: AuthState = {
	user: null,
	status: "loading",
	error: null
};

const createAuthStore = () => {
	const { subscribe, set, update } = writable<AuthState>(initialState);

	const setAuthenticatedUser = (user: AuthUser | null) => {
		if (user) {
			set({
				user,
				status: "authenticated",
				error: null
			});
		} else {
			set({
				user: null,
				status: "unauthenticated",
				error: null
			});
		}
	};

	const refreshSession = async () => {
		update((state) => ({
			...state,
			status: state.status === "authenticated" ? "authenticated" : "loading",
			error: null
		}));

		try {
			const response = await request("/auth/me");

			if (!response.ok) {
				throw new Error("Unable to verify session");
			}

			const data = (await response.json()) as { user: AuthUser };

			setAuthenticatedUser(data.user);
		} catch (error) {
			set({
				user: null,
				status: "unauthenticated",
				error: error instanceof Error ? error.message : "Unable to verify session"
			});
		}
	};

	const logout = async () => {
		try {
			const response = await request("/auth/logout", { method: "POST" });

			if (!response.ok) {
				throw new Error("Unable to log out");
			}
		} catch (error) {
			console.error("[auth] logout failed", error);
		} finally {
			setAuthenticatedUser(null);
		}
	};

	return {
		subscribe,
		setAuthenticatedUser,
		refreshSession,
		logout
	};
};

export const authStore = createAuthStore();
