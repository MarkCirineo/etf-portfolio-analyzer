import { request } from "$lib/request";
import type { AuthUser } from "$lib/types";

type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

type AuthState = {
	user: AuthUser | null;
	status: AuthStatus;
	error: string | null;
};

export const auth = $state<AuthState>({
	user: null,
	status: "loading",
	error: null
});

export const setAuthenticatedUser = (user: AuthUser | null) => {
	if (user) {
		auth.user = user;
		auth.status = "authenticated";
		auth.error = null;
	} else {
		auth.user = null;
		auth.status = "unauthenticated";
		auth.error = null;
	}
};

export const refreshSession = async () => {
	auth.status = auth.status === "authenticated" ? "authenticated" : "loading";
	auth.error = null;

	try {
		const response = await request("/auth/me");

		if (!response.ok) {
			throw new Error("Unable to verify session");
		}

		const data = (await response.json()) as { user: AuthUser };

		setAuthenticatedUser(data.user);
	} catch (error) {
		auth.user = null;
		auth.status = "unauthenticated";
		auth.error = error instanceof Error ? error.message : "Unable to verify session";
	}
};

export const logout = async () => {
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
