import logger from "@logger";
import db from "@db";
import { analyzeList, extractListSymbols } from "@services/list-analysis";
import { subscribeToQuoteUpdates } from "@services/quote-cache";
import { getSocketIO } from "./socket";
import type { QuoteBroadcastPayload } from "./quote-cache";

const THROTTLE_MS = 5000; // 5 seconds

// Track which sockets are subscribed to which lists
const listSubscriptions = new Map<string, Set<string>>(); // listId -> Set<socketId>

// Track which symbols are in each list (for fast lookup)
const listSymbols = new Map<string, Set<string>>(); // listId -> Set<symbol>

// Track pending update timers for throttling
const pendingUpdates = new Map<string, NodeJS.Timeout>(); // listId -> timeout

// Track list content cache (to avoid re-fetching from DB)
const listContentCache = new Map<string, Record<string, number>>(); // listId -> content

let unsubscribeQuoteUpdates: (() => Promise<void>) | null = null;

export const initListSubscriptions = () => {
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
	// Verify user has access to this list
	const list = await db
		.selectFrom("lists")
		.select(["publicId", "content", "ownerId"])
		.where("publicId", "=", listId)
		.where("ownerId", "=", userId)
		.executeTakeFirst();

	if (!list) {
		logger.warn(
			`[list-subscriptions] List ${listId} not found or access denied for user ${userId}`
		);
		return;
	}

	// Add subscription
	if (!listSubscriptions.has(listId)) {
		listSubscriptions.set(listId, new Set());
	}
	listSubscriptions.get(listId)!.add(socketId);

	// Cache list content
	listContentCache.set(listId, list.content);

	// Determine symbols in this list (direct + via ETFs)
	const symbols = await extractListSymbols(list.content);
	listSymbols.set(listId, symbols);

	logger.info(
		`[list-subscriptions] Socket ${socketId} subscribed to list ${listId} (${symbols.size} symbols)`
	);
};

export const unsubscribeFromList = (listId: string, socketId: string): void => {
	const subscribers = listSubscriptions.get(listId);

	if (!subscribers) {
		return;
	}

	subscribers.delete(socketId);

	if (subscribers.size === 0) {
		// Clean up if no more subscribers
		listSubscriptions.delete(listId);
		listSymbols.delete(listId);
		listContentCache.delete(listId);

		// Clear any pending update
		const timeout = pendingUpdates.get(listId);
		if (timeout) {
			clearTimeout(timeout);
			pendingUpdates.delete(listId);
		}
	}

	logger.info(`[list-subscriptions] Socket ${socketId} unsubscribed from list ${listId}`);
};

export const unsubscribeSocket = (socketId: string): void => {
	const listsToCleanup: string[] = [];

	for (const [listId, subscribers] of listSubscriptions.entries()) {
		if (subscribers.has(socketId)) {
			listsToCleanup.push(listId);
		}
	}

	for (const listId of listsToCleanup) {
		unsubscribeFromList(listId, socketId);
	}
};

const handleQuoteUpdate = (payload: QuoteBroadcastPayload): void => {
	const { symbol } = payload;

	// Find all lists that contain this symbol
	for (const [listId, symbols] of listSymbols.entries()) {
		if (symbols.has(symbol)) {
			// This list is affected by the quote update
			scheduleListUpdate(listId);
		}
	}
};

const scheduleListUpdate = (listId: string): void => {
	// If there's already a pending update, don't schedule another (throttling)
	if (pendingUpdates.has(listId)) {
		return;
	}

	// Check if there are any subscribers
	const subscribers = listSubscriptions.get(listId);
	if (!subscribers || subscribers.size === 0) {
		return;
	}

	// Schedule update after throttle period
	const timeout = setTimeout(() => {
		pendingUpdates.delete(listId);
		void processListUpdate(listId);
	}, THROTTLE_MS);

	pendingUpdates.set(listId, timeout);
};

const processListUpdate = async (listId: string): Promise<void> => {
	const subscribers = listSubscriptions.get(listId);

	if (!subscribers || subscribers.size === 0) {
		return;
	}

	const content = listContentCache.get(listId);

	if (!content) {
		logger.warn(`[list-subscriptions] No cached content for list ${listId}`);
		return;
	}

	try {
		// Recalculate analysis (uses cached quotes, allows stale)
		const analysis = await analyzeList(content, { allowStale: true });

		// Send update to all subscribed sockets via room
		const io = getSocketIO();
		if (!io) {
			logger.warn("[list-subscriptions] Socket.IO server not available");
			return;
		}

		const payload = {
			listId,
			analysis
		};

		// Emit to the room for this list (all sockets subscribed to this list are in the room)
		const roomName = `list:${listId}`;
		io.to(roomName).emit("list:analysis:update", payload);

		logger.debug(
			`[list-subscriptions] Sent analysis update for list ${listId} to ${subscribers.size} subscribers`
		);
	} catch (error) {
		logger.error(
			`[list-subscriptions] Failed to process update for list ${listId}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
};
