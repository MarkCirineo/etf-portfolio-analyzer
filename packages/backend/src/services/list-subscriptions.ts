import type { Server as SocketIOServer } from "socket.io";

import logger from "@logger";
import db from "@db";
import { analyzeAccounts, loadAccounts, type Account } from "@services/accounts";
import { subscribeToQuoteUpdates, type QuoteBroadcastPayload } from "@services/quote-cache";

/** Quotes arrive about once a second; batch them into one re-analysis. */
const DEBOUNCE_MS = 3000;
/** While prices are still outstanding, re-run even if no broadcast shows up. */
const INCOMPLETE_RECHECK_MS = 30 * 1000;

type Subscription = {
	listId: string;
	/** Account ids the analysis covers; null for all of them. */
	scope: string[] | null;
	sockets: Set<string>;
	accounts: Account[];
	trackedSymbols: Set<string>;
	debounce: NodeJS.Timeout | null;
	recheck: NodeJS.Timeout | null;
};

/** Keyed by subscriptionKey: one per list and scope, shared by every socket viewing it. */
const subscriptions = new Map<string, Subscription>();

let io: SocketIOServer | null = null;
let unsubscribeQuoteUpdates: (() => Promise<void>) | null = null;

/** Identifies a list viewed through some of its accounts; also names its Socket.IO room. */
export const subscriptionKey = (listId: string, scope: string[] | null | undefined) =>
	scope && scope.length > 0 ? `${listId}:${[...scope].sort().join(",")}` : listId;

export const initListSubscriptions = (server: SocketIOServer) => {
	io = server;

	if (unsubscribeQuoteUpdates) {
		return;
	}

	void subscribeToQuoteUpdates(handleQuoteUpdate)
		.then((unsubscribe) => {
			unsubscribeQuoteUpdates = unsubscribe;
			logger.info("[list-subscriptions] Subscribed to quote updates");
		})
		.catch((error) => {
			logger.error(
				`[list-subscriptions] Failed to subscribe to quote updates: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		});
};

/**
 * Subscribe a socket to a list, optionally narrowed to some of its accounts. Returns the
 * subscription key (the room to join), or null if the list is not the user's or the scope
 * names an account the list does not have.
 */
export const subscribeToList = async (
	listId: string,
	scope: string[] | null,
	socketId: string,
	userId: number
): Promise<string | null> => {
	const list = await db
		.selectFrom("lists")
		.select("publicId")
		.where("publicId", "=", listId)
		.where("ownerId", "=", userId)
		.executeTakeFirst();

	if (!list) {
		logger.warn(
			`[list-subscriptions] List ${listId} not found or access denied for user ${userId}`
		);
		return null;
	}

	const accounts = (await loadAccounts([listId])).get(listId) ?? [];
	const known = new Set(accounts.map((account) => account.id));

	if (scope?.some((id) => !known.has(id))) {
		logger.warn(`[list-subscriptions] Unknown account in scope for list ${listId}`);
		return null;
	}

	// Every account is the same as no scope at all
	const unique = Array.from(new Set(scope ?? []));
	const narrowed = unique.length > 0 && unique.length < accounts.length ? unique : null;
	const key = subscriptionKey(listId, narrowed);
	let subscription = subscriptions.get(key);

	if (!subscription) {
		subscription = {
			listId,
			scope: narrowed,
			sockets: new Set(),
			accounts,
			trackedSymbols: new Set(),
			debounce: null,
			recheck: null
		};
		subscriptions.set(key, subscription);
	}

	subscription.sockets.add(socketId);
	subscription.accounts = accounts;

	logger.info(`[list-subscriptions] Socket ${socketId} subscribed to ${key}`);

	// Run once right away: it fills in trackedSymbols and catches anything that changed
	// while the socket was (re)connecting.
	scheduleUpdate(key, 0);

	return key;
};

export const unsubscribeFromList = (key: string, socketId: string): void => {
	const subscription = subscriptions.get(key);

	if (!subscription) {
		return;
	}

	subscription.sockets.delete(socketId);

	if (subscription.sockets.size === 0) {
		clearTimers(subscription);
		subscriptions.delete(key);
	}

	logger.info(`[list-subscriptions] Socket ${socketId} unsubscribed from ${key}`);
};

export const unsubscribeSocket = (socketId: string): void => {
	for (const [key, subscription] of subscriptions.entries()) {
		if (subscription.sockets.has(socketId)) {
			unsubscribeFromList(key, socketId);
		}
	}
};

/** Reload a list's accounts after an edit so everyone viewing it sees the new holdings. */
export const refreshListSubscriptions = (listId: string): void => {
	const affected = Array.from(subscriptions.entries()).filter(
		([, subscription]) => subscription.listId === listId
	);

	if (affected.length === 0) {
		return;
	}

	void loadAccounts([listId])
		.then((byList) => {
			const accounts = byList.get(listId) ?? [];
			const known = new Set(accounts.map((account) => account.id));

			for (const [key, subscription] of affected) {
				subscription.accounts = accounts;

				// An account in the scope was deleted: keep what is left of the scope
				if (subscription.scope) {
					const remaining = subscription.scope.filter((id) => known.has(id));
					subscription.scope = remaining.length > 0 ? remaining : null;
				}

				scheduleUpdate(key, 0);
			}
		})
		.catch((error) => {
			logger.error(
				`[list-subscriptions] Failed to reload accounts for list ${listId}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		});
};

const handleQuoteUpdate = (payload: QuoteBroadcastPayload): void => {
	for (const [key, subscription] of subscriptions.entries()) {
		if (subscription.trackedSymbols.has(payload.symbol)) {
			scheduleUpdate(key, DEBOUNCE_MS);
		}
	}
};

const scheduleUpdate = (key: string, delayMs: number): void => {
	const subscription = subscriptions.get(key);

	if (!subscription || subscription.debounce) {
		return;
	}

	subscription.debounce = setTimeout(() => {
		subscription.debounce = null;
		void processListUpdate(key);
	}, delayMs);
};

const processListUpdate = async (key: string): Promise<void> => {
	const subscription = subscriptions.get(key);

	if (!subscription || subscription.sockets.size === 0) {
		return;
	}

	try {
		const { analysis, accounts, scope, trackedSymbols } = await analyzeAccounts(
			subscription.accounts,
			subscription.scope
		);
		subscription.trackedSymbols = trackedSymbols;

		if (!io) {
			logger.warn("[list-subscriptions] Socket.IO server not available");
			return;
		}

		io.to(`list:${key}`).emit("list:analysis:update", {
			listId: subscription.listId,
			scope,
			analysis,
			accounts
		});

		logger.debug(
			`[list-subscriptions] Sent analysis for ${key} to ${subscription.sockets.size} socket(s): ${analysis.quotes.priced}/${analysis.quotes.requested} priced`
		);

		if (subscription.recheck) {
			clearTimeout(subscription.recheck);
			subscription.recheck = null;
		}

		const incomplete =
			analysis.pendingQuotes.length > 0 ||
			analysis.failedTickers.length > 0 ||
			!analysis.totalValueComplete ||
			accounts.some((account) => !account.valueComplete);

		if (incomplete) {
			subscription.recheck = setTimeout(() => {
				subscription.recheck = null;
				scheduleUpdate(key, 0);
			}, INCOMPLETE_RECHECK_MS);
		}
	} catch (error) {
		logger.error(
			`[list-subscriptions] Failed to process update for ${key}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};

const clearTimers = (subscription: Subscription) => {
	if (subscription.debounce) {
		clearTimeout(subscription.debounce);
		subscription.debounce = null;
	}

	if (subscription.recheck) {
		clearTimeout(subscription.recheck);
		subscription.recheck = null;
	}
};
