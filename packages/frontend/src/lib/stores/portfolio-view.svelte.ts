import { io, type Socket } from "socket.io-client";
import { API_BASE_URL, request } from "$lib/request";
import type { AccountSummary, ListAnalysis, ListDetail } from "$lib/types";

type AnalysisUpdate = {
	listId: string;
	scope: string[] | null;
	analysis: ListAnalysis;
	accounts: AccountSummary[];
};

const scopeKey = (scope: string[] | null) => (scope ? [...scope].sort().join(",") : "");

const getSocketUrl = (): string | null => {
	if (!API_BASE_URL) {
		return null;
	}

	// A full URL points at the API host; a relative path means same origin
	if (API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")) {
		try {
			return new URL(API_BASE_URL).origin;
		} catch {
			return API_BASE_URL;
		}
	}

	return typeof window !== "undefined" ? window.location.origin : API_BASE_URL;
};

/**
 * A list's analysis, kept live: loaded over HTTP, then updated over Socket.IO as prices
 * arrive. `scope` narrows it to some of the list's accounts.
 */
export class PortfolioView {
	detail = $state<ListDetail | null>(null);
	/** True until the first load finishes. */
	loading = $state(true);
	/** A reload (refresh or scope change) is in flight. */
	refreshing = $state(false);
	error = $state<string | null>(null);
	scope = $state<string[] | null>(null);
	/** Loaded, but the user has no main portfolio yet. */
	empty = $state(false);

	#endpoint: string;
	#socket: Socket | null = null;
	#subscribed: { listId: string; scope: string[] | null } | null = null;
	#request = 0;

	/** `endpoint` is "/portfolio" or "/list/:id/analysis". */
	constructor(endpoint: string) {
		this.#endpoint = endpoint;
	}

	load = async () => {
		const requestId = ++this.#request;
		this.refreshing = !this.loading;
		this.error = null;

		try {
			const query = this.scope ? `?accounts=${encodeURIComponent(this.scope.join(","))}` : "";
			const response = await request(`${this.#endpoint}${query}`);
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				throw new Error(body?.message ?? "Failed to load portfolio");
			}

			if (requestId !== this.#request) {
				return;
			}

			const detail = body?.data as ListDetail | undefined;

			if (!detail?.list) {
				this.detail = null;
				this.empty = true;
				return;
			}

			this.empty = false;
			this.#apply(detail.list.id, detail);
			this.#subscribe(detail.list.id, detail.scope);
		} catch (err) {
			if (requestId === this.#request) {
				this.error = err instanceof Error ? err.message : "Failed to load portfolio";
			}
		} finally {
			if (requestId === this.#request) {
				this.loading = false;
				this.refreshing = false;
			}
		}
	};

	setScope = (scope: string[] | null) => {
		const next = scope && scope.length > 0 ? scope : null;

		if (scopeKey(next) === scopeKey(this.scope)) {
			return;
		}

		this.scope = next;
		void this.load();
	};

	destroy = () => {
		this.#unsubscribe();
		this.#socket?.disconnect();
		this.#socket = null;
	};

	#apply(
		listId: string,
		incoming: Pick<ListDetail, "analysis" | "accounts" | "scope"> & Partial<ListDetail>
	) {
		const current = this.detail;

		// The HTTP response and a socket push can race; keep the newer analysis
		if (
			current &&
			current.list.id === listId &&
			scopeKey(current.scope) === scopeKey(incoming.scope) &&
			incoming.analysis.generatedAt < current.analysis.generatedAt
		) {
			return;
		}

		this.detail = {
			list: incoming.list ?? current!.list,
			analysis: incoming.analysis,
			accounts: incoming.accounts,
			scope: incoming.scope
		};
	}

	#subscribe(listId: string, scope: string[] | null) {
		const same =
			this.#subscribed?.listId === listId &&
			scopeKey(this.#subscribed.scope) === scopeKey(scope);

		if (same) {
			return;
		}

		this.#unsubscribe();
		this.#subscribed = { listId, scope };

		const socket = this.#ensureSocket();

		if (socket?.connected) {
			socket.emit("list:subscribe", { listId, accounts: scope ?? undefined });
		}
	}

	#unsubscribe() {
		if (this.#subscribed && this.#socket?.connected) {
			this.#socket.emit("list:unsubscribe", {
				listId: this.#subscribed.listId,
				accounts: this.#subscribed.scope ?? undefined
			});
		}

		this.#subscribed = null;
	}

	#ensureSocket() {
		if (this.#socket) {
			return this.#socket;
		}

		const socketUrl = getSocketUrl();

		if (!socketUrl) {
			return null;
		}

		const socket = io(socketUrl, {
			withCredentials: true,
			transports: ["websocket", "polling"]
		});

		socket.on("connect_error", (err) => {
			console.error("Socket connection error:", err?.message);
		});

		// Also re-subscribes after a reconnect
		socket.on("connect", () => {
			if (this.#subscribed) {
				socket.emit("list:subscribe", {
					listId: this.#subscribed.listId,
					accounts: this.#subscribed.scope ?? undefined
				});
			}
		});

		socket.on("list:analysis:update", (payload: AnalysisUpdate) => {
			const subscribed = this.#subscribed;

			if (
				subscribed &&
				payload.listId === subscribed.listId &&
				scopeKey(payload.scope) === scopeKey(subscribed.scope)
			) {
				this.#apply(payload.listId, payload);
			}
		});

		this.#socket = socket;
		return socket;
	}
}

/** The view the page is showing, so the header's account switcher can drive it. */
export const activeView = $state<{ current: PortfolioView | null }>({ current: null });
