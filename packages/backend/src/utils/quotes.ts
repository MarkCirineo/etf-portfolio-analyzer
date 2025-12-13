import logger from "@logger";
import { getCachedQuote, isQuoteFresh, type QuoteCacheEntry } from "@services/quote-cache";
import { requestFreshQuote, scheduleQuoteFetch } from "@services/quote-queue";

type QuoteSnapshot = {
	symbol: string;
	price: number | null;
	updatedAt: number | null;
	isFresh: boolean;
	isUpdating: boolean;
};

export const fetchQuotes = async (
	symbols: string[],
	options?: { allowStale?: boolean }
): Promise<Map<string, number>> => {
	const snapshots = await getQuoteSnapshots(symbols, options);
	const result = new Map<string, number>();

	for (const snapshot of snapshots.values()) {
		if (typeof snapshot.price === "number" && Number.isFinite(snapshot.price)) {
			result.set(snapshot.symbol, snapshot.price);
		}
	}

	return result;
};

export const getQuoteSnapshots = async (
	symbols: string[],
	options?: { allowStale?: boolean }
): Promise<Map<string, QuoteSnapshot>> => {
	if (!symbols || symbols.length === 0) {
		return new Map();
	}

	const uniqueSymbols = Array.from(
		new Set(
			symbols
				.map((symbol) => normalizeSymbol(symbol))
				.filter((symbol): symbol is string => Boolean(symbol))
		)
	);

	if (uniqueSymbols.length === 0) {
		return new Map();
	}

	const result = new Map<string, QuoteSnapshot>();
	const pendingFetches: Promise<void>[] = [];

	for (const symbol of uniqueSymbols) {
		pendingFetches.push(
			resolveSnapshot(symbol, options).then((snapshot) => {
				result.set(symbol, snapshot);
			})
		);
	}

	await Promise.all(pendingFetches);

	return result;
};

const resolveSnapshot = async (
	symbol: string,
	options?: { allowStale?: boolean }
): Promise<QuoteSnapshot> => {
	const cached = await getCachedQuote(symbol);

	if (cached && isQuoteFresh(cached)) {
		return serializeSnapshot(symbol, cached, true, false);
	}

	if (cached && options?.allowStale) {
		scheduleQuoteFetch(symbol);
		return serializeSnapshot(symbol, cached, false, true);
	}

	const fetched = await requestFreshQuote(symbol);

	if (fetched.success && typeof fetched.price === "number" && Number.isFinite(fetched.price)) {
		return {
			symbol,
			price: fetched.price,
			updatedAt: fetched.fetchedAt,
			isFresh: true,
			isUpdating: false
		};
	}

	if (cached) {
		logger.warn(
			`[quotes] Falling back to cached price for ${symbol} after fetch failure (${fetched.error ?? "unknown error"})`
		);
		return serializeSnapshot(symbol, cached, false, false);
	}

	return {
		symbol,
		price: null,
		updatedAt: null,
		isFresh: false,
		isUpdating: false
	};
};

const serializeSnapshot = (
	symbol: string,
	entry: QuoteCacheEntry,
	isFresh: boolean,
	isUpdating: boolean
): QuoteSnapshot => {
	return {
		symbol,
		price: entry.price,
		updatedAt: entry.updatedAt,
		isFresh,
		isUpdating
	};
};

const normalizeSymbol = (symbol: string) => symbol?.trim().toUpperCase();
