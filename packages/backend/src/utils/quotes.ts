import config from "@config";
import logger from "@logger";
import { HttpError } from "@utils/error";

type QuoteCacheEntry = {
	price: number;
	fetchedAt: number;
};

type FinnhubQuoteResponse = {
	c?: number; // Current price
	pc?: number; // Previous close
};

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

const quoteCache = new Map<string, QuoteCacheEntry>();
const inflightQuotes = new Map<string, Promise<number | null>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

const isCacheFresh = (entry: QuoteCacheEntry | undefined) => {
	if (!entry) {
		return false;
	}

	return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
};

const ensureFinnhubKey = () => {
	if (!config.finnhub_api_key) {
		throw new HttpError("Finnhub API key is not configured", 503);
	}
};

const fetchQuoteFromFinnhub = async (symbol: string): Promise<number | null> => {
	ensureFinnhubKey();

	const url = `${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}`;
	let lastError: string | undefined;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
		try {
			const response = await fetch(url, {
				headers: {
					"Content-Type": "application/json",
					"X-Finnhub-Token": config.finnhub_api_key
				}
			});

			if (response.status === 429) {
				const retryAfter = Number(response.headers.get("retry-after"));
				const delay = Number.isFinite(retryAfter)
					? retryAfter * 1000
					: BASE_RETRY_DELAY_MS * (attempt + 1);
				logger.warn(`[quotes] Finnhub rate limit hit while fetching ${symbol}, retrying...`);
				await sleep(delay);
				continue;
			}

			if (!response.ok) {
				const body = await response.text().catch(() => "");
				lastError = `status ${response.status} - ${body?.slice(0, 120) ?? "unknown error"}`;
				break;
			}

			const payload = (await response.json()) as FinnhubQuoteResponse;
			const price = typeof payload?.c === "number" ? payload.c : undefined;

			if (price && price > 0) {
				return price;
			}

			const fallbackPrice =
				typeof payload?.pc === "number" && payload.pc > 0 ? payload.pc : undefined;

			if (fallbackPrice) {
				logger.warn(
					`[quotes] Using previous close for ${symbol} because current price was unavailable`
				);
				return fallbackPrice;
			}

			lastError = "empty price payload";
			break;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await sleep(BASE_RETRY_DELAY_MS * (attempt + 1));
		}
	}

	if (lastError) {
		logger.warn(`[quotes] Failed to fetch quote for ${symbol}: ${lastError}`);
	}

	return null;
};

const getQuote = async (symbol: string): Promise<number | null> => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized) {
		return null;
	}

	const cached = quoteCache.get(normalized);

	if (isCacheFresh(cached)) {
		return cached!.price;
	}

	const existing = inflightQuotes.get(normalized);

	if (existing) {
		return existing;
	}

	const request = fetchQuoteFromFinnhub(normalized)
		.then((price) => {
			if (typeof price === "number" && Number.isFinite(price) && price > 0) {
				quoteCache.set(normalized, {
					price,
					fetchedAt: Date.now()
				});
				return price;
			}

			return null;
		})
		.finally(() => {
			inflightQuotes.delete(normalized);
		});

	inflightQuotes.set(normalized, request);

	return request;
};

export const fetchQuotes = async (symbols: string[]): Promise<Map<string, number>> => {
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

	const quotes = new Map<string, number>();
	const symbolsNeedingFetch: string[] = [];

	for (const symbol of uniqueSymbols) {
		const cached = quoteCache.get(symbol);

		if (isCacheFresh(cached)) {
			quotes.set(symbol, cached!.price);
			continue;
		}

		symbolsNeedingFetch.push(symbol);
	}

	if (symbolsNeedingFetch.length === 0) {
		return quotes;
	}

	const batches: string[][] = [];

	for (let i = 0; i < symbolsNeedingFetch.length; i += MAX_BATCH_SIZE) {
		batches.push(symbolsNeedingFetch.slice(i, i + MAX_BATCH_SIZE));
	}

	for (const batch of batches) {
		const results = await Promise.all(batch.map((symbol) => getQuote(symbol)));

		results.forEach((price, index) => {
			const symbol = batch[index];

			if (typeof price === "number" && Number.isFinite(price) && price > 0) {
				quotes.set(symbol, price);
			}
		});
	}

	return quotes;
};

export const clearQuoteCache = () => {
	quoteCache.clear();
	inflightQuotes.clear();
};
