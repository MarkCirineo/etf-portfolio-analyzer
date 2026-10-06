import {
	getCachedQuotes,
	getQuoteFailures,
	isQuoteFresh,
	type QuoteCacheEntry
} from "@services/quote-cache";
import { isQuoteQueued, scheduleQuoteFetch } from "@services/quote-queue";

export type PriceStatus =
	/** Cached and within its refresh window. */
	| "fresh"
	/** Cached but past its refresh window; still usable, a refresh is queued if requested. */
	| "stale"
	/** No price yet; a fetch is queued or in flight. */
	| "pending"
	/** The provider could not price it recently; not retried until that cools off. */
	| "unavailable"
	/** No price and nobody asked for one (below the fetch cap). */
	| "not-requested"
	/** Reported under a foreign exchange ticker, which the quote provider cannot resolve. */
	| "foreign-listing";

export type QuoteSnapshot = {
	symbol: string;
	price: number | null;
	previousClose: number | null;
	updatedAt: number | null;
	status: PriceStatus;
};

/**
 * Reads cached prices for `symbols` in one round trip and queues a fetch for any that are
 * missing or stale — but only for symbols present in `priorities`. Symbols without a
 * priority are still looked up (a price cached for another list is just as good) but are
 * never fetched on this list's behalf.
 */
export const getQuoteSnapshots = async (
	symbols: string[],
	priorities: Map<string, number>
): Promise<Map<string, QuoteSnapshot>> => {
	const uniqueSymbols = Array.from(
		new Set(symbols.map(normalizeSymbol).filter((symbol): symbol is string => Boolean(symbol)))
	);
	const result = new Map<string, QuoteSnapshot>();

	if (uniqueSymbols.length === 0) {
		return result;
	}

	const [cached, failures] = await Promise.all([
		getCachedQuotes(uniqueSymbols),
		getQuoteFailures(uniqueSymbols)
	]);

	for (const symbol of uniqueSymbols) {
		const entry = cached.get(symbol);
		const failed = failures.has(symbol);
		const priority = priorities.get(symbol);
		const requested = priority !== undefined;

		if (entry && isQuoteFresh(entry)) {
			result.set(symbol, snapshot(symbol, entry, "fresh"));
			continue;
		}

		if (entry) {
			// Serve the stale price and refresh it in the background, unless the last
			// refresh just failed, in which case the stale price is the best we have.
			if (requested && !failed) {
				scheduleQuoteFetch(symbol, priority);
			}
			result.set(symbol, snapshot(symbol, entry, "stale"));
			continue;
		}

		if (failed) {
			result.set(symbol, snapshot(symbol, null, "unavailable"));
			continue;
		}

		if (requested) {
			scheduleQuoteFetch(symbol, priority);
			result.set(symbol, snapshot(symbol, null, "pending"));
			continue;
		}

		result.set(
			symbol,
			snapshot(symbol, null, isQuoteQueued(symbol) ? "pending" : "not-requested")
		);
	}

	return result;
};

const snapshot = (
	symbol: string,
	entry: QuoteCacheEntry | null,
	status: PriceStatus
): QuoteSnapshot => ({
	symbol,
	price: entry?.price ?? null,
	previousClose: entry?.previousClose ?? null,
	updatedAt: entry?.updatedAt ?? null,
	status
});

const normalizeSymbol = (symbol: string) => symbol?.trim().toUpperCase();
