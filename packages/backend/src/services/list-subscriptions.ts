import type { Server as SocketIOServer } from "socket.io";

import logger from "@logger";
import db from "@db";
import type { ListContent } from "@db/tables/List";
import { analyzeList } from "@services/list-analysis";
import { subscribeToQuoteUpdates, type QuoteBroadcastPayload } from "@services/quote-cache";

/** Quotes arrive about once a second; batch them into one re-analysis. */
const DEBOUNCE_MS = 3000;
/** While prices are still outstanding, re-run even if no broadcast shows up. */
const INCOMPLETE_RECHECK_MS = 30 * 1000;

type Subscription = {
	sockets: Set<string>;
	content: ListContent;
	trackedSymbols: Set<string>;
	debounce: NodeJS.Timeout | null;
	recheck: NodeJS.Timeout | null;
};

const subscriptions = new Map<string, Subscription>();

let io: SocketIOServer | null = null;
let unsubscribeQuoteUpdates: (() => Promise<void>) | null = null;

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

export const subscribeToList = async (
	listId: string,
	socketId: string,
	userId: number
): Promise<void> => {
	const list = await db
		.selectFrom("lists")
		.select(["publicId", "content"])
		.where("publicId", "=", listId)
		.where("ownerId", "=", userId)
		.executeTakeFirst();

	if (!list) {
		logger.warn(
			`[list-subscriptions] List ${listId} not found or access denied for user ${userId}`
		);
		return;
	}

	let subscription = subscriptions.get(listId);

	if (!subscription) {
		subscription = {
			sockets: new Set(),
			content: list.content,
			trackedSymbols: new Set(),
			debounce: null,
			recheck: null
		};
		subscriptions.set(listId, subscription);
	}

	subscription.sockets.add(socketId);
	subscription.content = list.content;

	logger.info(`[list-subscriptions] Socket ${socketId} subscribed to list ${listId}`);

	// Run once right away: it fills in trackedSymbols and catches anything that changed
	// while the socket was (re)connecting.
	scheduleUpdate(listId, 0);
};

export const unsubscribeFromList = (listId: string, socketId: string): void => {
	const subscription = subscriptions.get(listId);

	if (!subscription) {
		return;
	}

	subscription.sockets.delete(socketId);

	if (subscription.sockets.size === 0) {
		clearTimers(subscription);
		subscriptions.delete(listId);
	}

	logger.info(`[list-subscriptions] Socket ${socketId} unsubscribed from list ${listId}`);
};

export const unsubscribeSocket = (socketId: string): void => {
	for (const [listId, subscription] of subscriptions.entries()) {
		if (subscription.sockets.has(socketId)) {
			unsubscribeFromList(listId, socketId);
		}
	}
};

/** Keep a live subscription in step with an edit so viewers see the new holdings. */
export const updateSubscribedListContent = (listId: string, content: ListContent): void => {
	const subscription = subscriptions.get(listId);

	if (!subscription) {
		return;
	}

	subscription.content = content;
	scheduleUpdate(listId, 0);
};

const handleQuoteUpdate = (payload: QuoteBroadcastPayload): void => {
	for (const [listId, subscription] of subscriptions.entries()) {
		if (subscription.trackedSymbols.has(payload.symbol)) {
			scheduleUpdate(listId, DEBOUNCE_MS);
		}
	}
};

const scheduleUpdate = (listId: string, delayMs: number): void => {
	const subscription = subscriptions.get(listId);

	if (!subscription || subscription.debounce) {
		return;
	}

	subscription.debounce = setTimeout(() => {
		subscription.debounce = null;
		void processListUpdate(listId);
	}, delayMs);
};

const processListUpdate = async (listId: string): Promise<void> => {
	const subscription = subscriptions.get(listId);

	if (!subscription || subscription.sockets.size === 0) {
		return;
	}

	try {
		const { analysis, trackedSymbols } = await analyzeList(subscription.content);
		subscription.trackedSymbols = trackedSymbols;

		if (!io) {
			logger.warn("[list-subscriptions] Socket.IO server not available");
			return;
		}

		io.to(`list:${listId}`).emit("list:analysis:update", { listId, analysis });

		logger.debug(
			`[list-subscriptions] Sent analysis for list ${listId} to ${subscription.sockets.size} socket(s): ${analysis.quotes.priced}/${analysis.quotes.requested} priced`
		);

		if (subscription.recheck) {
			clearTimeout(subscription.recheck);
			subscription.recheck = null;
		}

		const incomplete =
			analysis.pendingQuotes.length > 0 ||
			analysis.failedTickers.length > 0 ||
			!analysis.totalValueComplete;

		if (incomplete) {
			subscription.recheck = setTimeout(() => {
				subscription.recheck = null;
				scheduleUpdate(listId, 0);
			}, INCOMPLETE_RECHECK_MS);
		}
	} catch (error) {
		logger.error(
			`[list-subscriptions] Failed to process update for list ${listId}: ${
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
