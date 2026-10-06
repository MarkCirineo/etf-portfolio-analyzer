import { finnhubQuote } from "@api/finnhub";
import logger from "@logger";
import { saveQuoteFailure, saveQuoteToCache } from "@services/quote-cache";

/**
 * Finnhub's free tier allows 60 calls/minute and the symbol search shares that budget,
 * so dispatch a little slower than one per second.
 */
const RATE_INTERVAL_MS = 1100;
/** Dispatch on the interval without waiting for the previous response to come back. */
const MAX_IN_FLIGHT = 3;
const TICK_MS = 100;
const RATE_LIMIT_PAUSE_MS = 15 * 1000;
const NETWORK_RETRIES = 2;
const NETWORK_RETRY_DELAY_MS = 500;

type FetchOutcome =
	| { kind: "ok"; price: number; previousClose: number | null; tradedAt: number | null }
	| { kind: "rate-limited"; retryAfterMs: number }
	| { kind: "failed"; reason: string };

// symbol -> priority; higher fetches sooner. Re-scheduling only ever raises the priority.
const queued = new Map<string, number>();
const inFlight = new Set<string>();

let workerTimer: NodeJS.Timeout | null = null;
let lastDispatchedAt = 0;
let pausedUntil = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const scheduleQuoteFetch = (symbol: string, priority = 0) => {
	const normalized = normalizeSymbol(symbol);

	if (!normalized || inFlight.has(normalized)) {
		return;
	}

	const existing = queued.get(normalized);

	if (existing === undefined || priority > existing) {
		queued.set(normalized, priority);
	}

	ensureWorker();
};

export const isQuoteQueued = (symbol: string) => {
	const normalized = normalizeSymbol(symbol);
	return queued.has(normalized) || inFlight.has(normalized);
};

const ensureWorker = () => {
	if (workerTimer) {
		return;
	}

	workerTimer = setInterval(tick, TICK_MS);

	if (typeof workerTimer.unref === "function") {
		workerTimer.unref();
	}
};

const stopWorker = () => {
	if (workerTimer) {
		clearInterval(workerTimer);
		workerTimer = null;
	}
};

const tick = () => {
	if (queued.size === 0) {
		if (inFlight.size === 0) {
			stopWorker();
		}
		return;
	}

	const now = Date.now();

	if (now < pausedUntil || inFlight.size >= MAX_IN_FLIGHT) {
		return;
	}

	if (now - lastDispatchedAt < RATE_INTERVAL_MS) {
		return;
	}

	const next = takeHighestPriority();

	if (!next) {
		return;
	}

	const [symbol, priority] = next;
	lastDispatchedAt = now;
	inFlight.add(symbol);
	void processSymbol(symbol, priority);
};

const takeHighestPriority = (): [string, number] | undefined => {
	let best: string | undefined;
	let bestPriority = -Infinity;

	for (const [symbol, priority] of queued) {
		if (priority > bestPriority) {
			best = symbol;
			bestPriority = priority;
		}
	}

	if (best === undefined) {
		return undefined;
	}

	queued.delete(best);
	return [best, bestPriority];
};

const processSymbol = async (symbol: string, priority: number) => {
	try {
		const outcome = await fetchQuote(symbol);

		switch (outcome.kind) {
			case "ok":
				await saveQuoteToCache(
					symbol,
					outcome.price,
					outcome.previousClose,
					outcome.tradedAt
				);
				break;
			case "rate-limited":
				pauseFor(outcome.retryAfterMs);
				// Put it back so it is retried once the pause lifts
				queued.set(symbol, Math.max(queued.get(symbol) ?? -Infinity, priority));
				break;
			case "failed":
				logger.warn(`[quote-queue] No price for ${symbol}: ${outcome.reason}`);
				await saveQuoteFailure(symbol, outcome.reason);
				break;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(`[quote-queue] Failed to process ${symbol}: ${message}`);
		await saveQuoteFailure(symbol, "error").catch(() => {});
	} finally {
		inFlight.delete(symbol);
	}
};

const pauseFor = (ms: number) => {
	const until = Date.now() + ms;

	if (until > pausedUntil) {
		pausedUntil = until;
		logger.warn(`[quote-queue] Rate limited by Finnhub, pausing for ${Math.round(ms / 1000)}s`);
	}
};

const fetchQuote = async (symbol: string): Promise<FetchOutcome> => {
	let lastError = "unknown";

	for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt += 1) {
		try {
			const response = await finnhubQuote(symbol);

			if (response.status === 429) {
				return { kind: "rate-limited", retryAfterMs: readRetryAfterMs(response) };
			}

			if (!response.ok) {
				return { kind: "failed", reason: `http_${response.status}` };
			}

			respectRemainingBudget(response);

			const payload = await response.json();
			const price = parsePrice(payload);

			if (price === undefined) {
				// Finnhub answers 200 with all-zero fields for symbols it does not know
				return { kind: "failed", reason: "unknown_symbol" };
			}

			return {
				kind: "ok",
				price,
				previousClose: parsePreviousClose(payload),
				tradedAt: parseTradedAt(payload)
			};
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			await sleep(NETWORK_RETRY_DELAY_MS * (attempt + 1));
		}
	}

	return { kind: "failed", reason: `network: ${lastError}` };
};

const readRetryAfterMs = (response: Response) => {
	const retryAfter = Number(response.headers.get("retry-after"));

	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return retryAfter * 1000;
	}

	return RATE_LIMIT_PAUSE_MS;
};

/** Finnhub reports the remaining per-minute budget; stop early instead of tripping a 429. */
const respectRemainingBudget = (response: Response) => {
	const remainingHeader = response.headers.get("x-ratelimit-remaining");

	if (remainingHeader === null) {
		return;
	}

	const remaining = Number(remainingHeader);
	const resetAt = Number(response.headers.get("x-ratelimit-reset"));

	if (!Number.isFinite(remaining) || remaining > 2) {
		return;
	}

	const resetMs = Number.isFinite(resetAt) ? resetAt * 1000 - Date.now() : NaN;
	pauseFor(Number.isFinite(resetMs) && resetMs > 0 ? resetMs + 500 : RATE_LIMIT_PAUSE_MS);
};

const parsePrice = (payload: any): number | undefined => {
	const current = typeof payload?.c === "number" ? payload.c : undefined;

	if (current && current > 0) {
		return current;
	}

	const previousClose = typeof payload?.pc === "number" ? payload.pc : undefined;

	if (previousClose && previousClose > 0) {
		return previousClose;
	}

	return undefined;
};

const parsePreviousClose = (payload: any): number | null => {
	const previousClose = typeof payload?.pc === "number" ? payload.pc : 0;
	return previousClose > 0 ? previousClose : null;
};

const parseTradedAt = (payload: any): number | null => {
	const seconds = typeof payload?.t === "number" ? payload.t : 0;
	return seconds > 0 ? seconds * 1000 : null;
};

const normalizeSymbol = (symbol: string) => symbol?.trim().toUpperCase();
