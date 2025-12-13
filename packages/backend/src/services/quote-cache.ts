import logger from "@logger";
import { publishMessage, redisGetJSON, redisSetJSON, subscribeToChannel } from "@redis";
import { getQuoteTtlMs } from "@utils/market-hours";

export type QuoteCacheEntry = {
	symbol: string;
	price: number;
	updatedAt: number;
	staleAt: number;
};

export type QuoteBroadcastPayload = {
	symbol: string;
	price: number;
	updatedAt: number;
	staleAt: number;
};

const CACHE_PREFIX = "quotes";
const BROADCAST_CHANNEL = "quotes:update";
const fetchingSymbols = new Set<string>();

const buildCacheKey = (symbol: string) => `${CACHE_PREFIX}:${symbol}`;

export const getCachedQuote = async (symbol: string): Promise<QuoteCacheEntry | null> => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized) {
		return null;
	}

	const cacheKey = buildCacheKey(normalized);
	const entry = await redisGetJSON<QuoteCacheEntry>(cacheKey);

	if (!entry) {
		return null;
	}

	return entry;
};

export const saveQuoteToCache = async (symbol: string, price: number) => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized) {
		return;
	}

	const now = Date.now();
	const ttl = getQuoteTtlMs(new Date(now));
	const entry: QuoteCacheEntry = {
		symbol: normalized,
		price,
		updatedAt: now,
		staleAt: now + ttl
	};

	await redisSetJSON(buildCacheKey(normalized), entry, ttl);
	await publishMessage(BROADCAST_CHANNEL, entry);
	clearFetching(normalized);
};

export const isQuoteFresh = (entry: QuoteCacheEntry | null) => {
	if (!entry) {
		return false;
	}

	return entry.staleAt > Date.now();
};

export const isFetching = (symbol: string) => {
	return fetchingSymbols.has(symbol);
};

export const markFetching = (symbol: string) => {
	if (fetchingSymbols.has(symbol)) {
		return false;
	}

	fetchingSymbols.add(symbol);
	return true;
};

export const clearFetching = (symbol: string) => {
	fetchingSymbols.delete(symbol);
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

const normalizeSymbol = (symbol: string) => {
	return symbol?.trim().toUpperCase();
};
