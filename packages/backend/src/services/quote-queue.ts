import { finnhubQuote } from "@api/finnhub";
import logger from "@logger";

import { clearFetching, isFetching, markFetching, saveQuoteToCache } from "@services/quote-cache";

const MAX_REQUESTS_PER_MINUTE = 60;
const RATE_INTERVAL_MS = Math.ceil((60 * 1000) / MAX_REQUESTS_PER_MINUTE);
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

type PendingResolver = {
	resolve: (payload: QuoteQueueResult) => void;
	reject: (error: Error) => void;
};

export type QuoteQueueResult = {
	symbol: string;
	price: number | null;
	fetchedAt: number;
	success: boolean;
	error?: string;
};

const queue: string[] = [];
const queuedSymbols = new Set<string>();
const pendingResolvers = new Map<string, PendingResolver[]>();

let workerTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let lastDispatchedAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureWorker = () => {
	if (workerTimer) {
		return;
	}

	workerTimer = setInterval(() => {
		void processQueue();
	}, 250);

	if (typeof workerTimer.unref === "function") {
		workerTimer.unref();
	}
};

const dequeue = () => {
	const symbol = queue.shift();

	if (symbol) {
		queuedSymbols.delete(symbol);
	}

	return symbol;
};

export const scheduleQuoteFetch = (symbol: string) => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized) {
		return;
	}

	if (isFetching(normalized)) {
		return;
	}

	markFetching(normalized);

	if (!queuedSymbols.has(normalized)) {
		queuedSymbols.add(normalized);
		queue.push(normalized);
	}

	ensureWorker();
};

export const requestFreshQuote = (symbol: string) => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized) {
		return Promise.resolve<QuoteQueueResult>({
			symbol: "",
			price: null,
			fetchedAt: Date.now(),
			success: false,
			error: "Invalid symbol"
		});
	}

	return new Promise<QuoteQueueResult>((resolve, reject) => {
		const existing = pendingResolvers.get(normalized) ?? [];
		existing.push({ resolve, reject });
		pendingResolvers.set(normalized, existing);
		scheduleQuoteFetch(normalized);
	});
};

const processQueue = async () => {
	if (isProcessing) {
		return;
	}

	if (queue.length === 0) {
		return;
	}

	const now = Date.now();

	if (now - lastDispatchedAt < RATE_INTERVAL_MS) {
		return;
	}

	const symbol = dequeue();

	if (!symbol) {
		return;
	}

	isProcessing = true;
	lastDispatchedAt = now;

	try {
		const result = await fetchQuote(symbol);

		if (result.success && typeof result.price === "number") {
			try {
				await saveQuoteToCache(symbol, result.price);
			} catch (error) {
				clearFetching(symbol);
				throw error;
			}
		} else {
			clearFetching(symbol);
		}

		resolvePending(symbol, result);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`[quote-queue] Failed to fetch ${symbol}: ${message}`);
		clearFetching(symbol);
		resolvePending(symbol, {
			symbol,
			price: null,
			fetchedAt: Date.now(),
			success: false,
			error: message
		});
	} finally {
		isProcessing = false;
	}
};

const resolvePending = (symbol: string, payload: QuoteQueueResult) => {
	const resolvers = pendingResolvers.get(symbol);

	if (!resolvers) {
		return;
	}

	pendingResolvers.delete(symbol);
	resolvers.forEach(({ resolve }) => resolve(payload));
};

const fetchQuote = async (symbol: string): Promise<QuoteQueueResult> => {
	let lastError: string | undefined;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
		try {
			const response = await finnhubQuote(symbol);

			if (response.status === 429) {
				const retryAfterHeader = Number(response.headers.get("retry-after"));
				const backoff = Number.isFinite(retryAfterHeader)
					? retryAfterHeader * 1000
					: BASE_RETRY_DELAY_MS * (attempt + 1);
				logger.warn(
					`[quote-queue] Finnhub rate limit hit for ${symbol}, retrying in ${backoff}ms`
				);
				await sleep(backoff);
				continue;
			}

			if (!response.ok) {
				const body = await response.text().catch(() => "");
				lastError = `status ${response.status} - ${body?.slice(0, 120) ?? "unknown error"}`;
				break;
			}

			const payload = await response.json();
			const price = parsePrice(payload);

			if (typeof price === "number") {
				return {
					symbol,
					price,
					fetchedAt: Date.now(),
					success: true
				};
			}

			lastError = "Payload did not include a valid price";
			break;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await sleep(BASE_RETRY_DELAY_MS * (attempt + 1));
		}
	}

	return {
		symbol,
		price: null,
		fetchedAt: Date.now(),
		success: false,
		error: lastError
	};
};

const parsePrice = (payload: any) => {
	const current = typeof payload?.c === "number" ? payload.c : undefined;

	if (current && current > 0) {
		return current;
	}

	const previousClose = typeof payload?.pc === "number" ? payload.pc : undefined;

	if (previousClose && previousClose > 0) {
		logger.warn("[quote-queue] Falling back to previous close for missing price");
		return previousClose;
	}

	return undefined;
};

const normalizeSymbol = (symbol: string) => {
	return symbol?.trim().toUpperCase();
};
