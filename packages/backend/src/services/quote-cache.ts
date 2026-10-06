import logger from "@logger";
import { publishMessage, redisDel, redisMGetJSON, redisSetJSON, subscribeToChannel } from "@redis";
import { getQuoteTtlMs } from "@utils/market-hours";

export type QuoteCacheEntry = {
	symbol: string;
	price: number;
	/** When we fetched it. */
	updatedAt: number;
	/** When it should be refreshed. Stale entries are still served while a refresh is queued. */
	staleAt: number;
	/** Timestamp of the trade the price came from, when the provider reports it. */
	tradedAt: number | null;
	/** The prior session's close, for today's change. Absent on entries cached before it existed. */
	previousClose?: number | null;
};

export type QuoteFailureEntry = {
	symbol: string;
	failedAt: number;
	reason: string;
};

export type QuoteBroadcastPayload =
	| { type: "quote"; symbol: string; price: number; updatedAt: number; staleAt: number }
	| { type: "failure"; symbol: string; reason: string };

const CACHE_PREFIX = "quotes";
const FAILURE_PREFIX = "quotes:failed";
const BROADCAST_CHANNEL = "quotes:update";

/**
 * How long a price is considered current while the market is open. Prices only feed
 * share-count estimates whose dominant error is the age of the ETF weights (weeks), so
 * a half-hour refresh is plenty and keeps the fetch budget well under Finnhub's limit.
 */
const OPEN_MARKET_STALE_MS = 30 * 60 * 1000;
/** A stale price is far better than none; keep entries long after they go stale. */
const QUOTE_HARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Symbols the provider cannot price (delisted, foreign listings) are not retried for a while. */
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;

const buildCacheKey = (symbol: string) => `${CACHE_PREFIX}:${symbol}`;
const buildFailureKey = (symbol: string) => `${FAILURE_PREFIX}:${symbol}`;

export const getCachedQuotes = async (symbols: string[]): Promise<Map<string, QuoteCacheEntry>> => {
	const normalized = normalizeSymbols(symbols);
	const entries = await redisMGetJSON<QuoteCacheEntry>(normalized.map(buildCacheKey));
	const result = new Map<string, QuoteCacheEntry>();

	for (const entry of entries.values()) {
		if (isValidEntry(entry)) {
			result.set(entry.symbol, entry);
		}
	}

	return result;
};

export const getQuoteFailures = async (
	symbols: string[]
): Promise<Map<string, QuoteFailureEntry>> => {
	const normalized = normalizeSymbols(symbols);
	const entries = await redisMGetJSON<QuoteFailureEntry>(normalized.map(buildFailureKey));
	const result = new Map<string, QuoteFailureEntry>();

	for (const entry of entries.values()) {
		result.set(entry.symbol, entry);
	}

	return result;
};

export const saveQuoteToCache = async (
	symbol: string,
	price: number,
	previousClose: number | null = null,
	tradedAt: number | null = null
) => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized) {
		return;
	}

	const now = Date.now();
	const entry: QuoteCacheEntry = {
		symbol: normalized,
		price,
		updatedAt: now,
		staleAt: now + getQuoteTtlMs(OPEN_MARKET_STALE_MS, new Date(now)),
		tradedAt,
		previousClose
	};

	await redisSetJSON(buildCacheKey(normalized), entry, QUOTE_HARD_TTL_MS);
	// A successful fetch supersedes any earlier failure
	await redisDel(buildFailureKey(normalized));
	await publishMessage(BROADCAST_CHANNEL, {
		type: "quote",
		symbol: normalized,
		price,
		updatedAt: entry.updatedAt,
		staleAt: entry.staleAt
	} satisfies QuoteBroadcastPayload);
};

export const saveQuoteFailure = async (symbol: string, reason: string) => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized) {
		return;
	}

	const entry: QuoteFailureEntry = {
		symbol: normalized,
		failedAt: Date.now(),
		reason
	};

	await redisSetJSON(buildFailureKey(normalized), entry, FAILURE_TTL_MS);
	await publishMessage(BROADCAST_CHANNEL, {
		type: "failure",
		symbol: normalized,
		reason
	} satisfies QuoteBroadcastPayload);
};

export const isQuoteFresh = (entry: QuoteCacheEntry | null | undefined) => {
	if (!entry) {
		return false;
	}

	return entry.staleAt > Date.now();
};

export const subscribeToQuoteUpdates = async (
	handler: (payload: QuoteBroadcastPayload) => void
) => {
	return await subscribeToChannel(BROADCAST_CHANNEL, (message) => {
		try {
			const payload = JSON.parse(message) as QuoteBroadcastPayload;
			handler(payload);
		} catch (error) {
			logger.warn(`[quote-cache] Failed to parse broadcast: ${String(error)}`);
		}
	});
};

const isValidEntry = (entry: QuoteCacheEntry) => {
	return (
		typeof entry.symbol === "string" &&
		typeof entry.price === "number" &&
		Number.isFinite(entry.price) &&
		entry.price > 0 &&
		typeof entry.staleAt === "number"
	);
};

const normalizeSymbol = (symbol: string) => symbol?.trim().toUpperCase();

const normalizeSymbols = (symbols: string[]) => {
	return Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
};
