import config from "@config";
import logger from "@logger";
import { redisGetJSON, redisSetJSON } from "@redis";

export type EtfHolding = {
	symbol: string;
	/** Percent of the fund, 0-100. */
	weight: number;
	name?: string;
};

/** Cash, treasuries, swaps and positions without a US ticker (foreign listings). */
export type NonEquityHolding = {
	name: string;
	weight: number;
};

export type EtfHoldingsRecord = {
	/** "not-etf" is a definitive answer from the provider (a stock, or an unknown symbol). */
	status: "etf" | "not-etf" | "error";
	holdings: EtfHolding[];
	nonEquity: NonEquityHolding[];
	/** Rows reported by the provider, including ones too small to carry a weight. */
	totalRows: number;
	asOf: string | null;
	/** Leveraged and inverse funds hold swaps, so their reported holdings understate exposure. */
	leveraged: boolean;
	fetchedAt: number;
	error?: string;
};

/**
 * Holdings come from Alpha Vantage's ETF_PROFILE endpoint. The free tier allows 25 calls
 * a day, so results are kept for a long time and a refresh that fails (most likely from
 * hitting that limit) falls back to whatever was cached.
 */
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const REQUEST_TIMEOUT_MS = 30 * 1000;
const CACHE_PREFIX = "etf:holdings";
/** Providers publish holdings at most daily; refresh after this. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** Keep serving an old snapshot until this long after it was fetched. */
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A failed lookup with nothing cached is retried after this. */
const ERROR_TTL_MS = 10 * 60 * 1000;
/** The free tier also rejects bursts, so provider calls are spaced out. */
const PROVIDER_MIN_INTERVAL_MS = 1100;

const buildCacheKey = (symbol: string) => `${CACHE_PREFIX}:${symbol}`;

// Lookups already underway, so concurrent analyses share one provider call per symbol
const inFlight = new Map<string, Promise<EtfHoldingsRecord>>();
let providerQueue: Promise<unknown> = Promise.resolve();
let lastProviderCallAt = 0;

export const getEtfHoldings = async (symbol: string): Promise<EtfHoldingsRecord> => {
	const normalized = symbol.trim().toUpperCase();
	const cacheKey = buildCacheKey(normalized);
	let cached: EtfHoldingsRecord | null = null;

	try {
		const entry = await redisGetJSON<EtfHoldingsRecord>(cacheKey);

		if (entry && isRecordShape(entry)) {
			cached = entry;
		}
	} catch (error) {
		logger.warn(
			`[etf-holdings] Failed to read cache for ${normalized}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}

	if (cached && Date.now() - cached.fetchedAt < REFRESH_AFTER_MS) {
		return cached;
	}

	const record = await lookupOnce(normalized);

	if (record.status === "error" && cached && cached.status !== "error") {
		logger.warn(`[etf-holdings] Refresh failed for ${normalized}, serving cached snapshot`);
		return cached;
	}

	const ttl = record.status === "error" ? ERROR_TTL_MS : HARD_TTL_MS;

	await redisSetJSON(cacheKey, record, ttl).catch((error) => {
		logger.warn(
			`[etf-holdings] Failed to cache ${normalized}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	});

	return record;
};

const lookupOnce = (symbol: string): Promise<EtfHoldingsRecord> => {
	const existing = inFlight.get(symbol);

	if (existing) {
		return existing;
	}

	const pending = withProviderSlot(() => fetchEtfHoldingsFromProvider(symbol)).finally(() => {
		inFlight.delete(symbol);
	});
	inFlight.set(symbol, pending);

	return pending;
};

/** Runs provider calls one at a time, at most one per PROVIDER_MIN_INTERVAL_MS. */
const withProviderSlot = <T>(call: () => Promise<T>): Promise<T> => {
	const run = providerQueue.then(async () => {
		const wait = lastProviderCallAt + PROVIDER_MIN_INTERVAL_MS - Date.now();

		if (wait > 0) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}

		lastProviderCallAt = Date.now();
		return call();
	});

	providerQueue = run.catch(() => undefined);

	return run;
};

export const fetchEtfHoldingsFromProvider = async (symbol: string): Promise<EtfHoldingsRecord> => {
	const fetchedAt = Date.now();
	const apiKey = config.alpha_vantage_api_key;

	if (!apiKey) {
		return errorRecord(symbol, fetchedAt, "Alpha Vantage API key is not configured");
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const url = new URL(ALPHA_VANTAGE_URL);
		url.searchParams.set("function", "ETF_PROFILE");
		url.searchParams.set("symbol", symbol);
		url.searchParams.set("apikey", apiKey);

		const response = await fetch(url, { signal: controller.signal });

		if (!response.ok) {
			return errorRecord(symbol, fetchedAt, `http_${response.status}`);
		}

		const payload = await response.json();

		if (!isRecord(payload)) {
			return errorRecord(symbol, fetchedAt, "unexpected_response");
		}

		// Rate limiting and bad requests come back as 200 with a message field
		const message = payload.Information ?? payload.Note ?? payload["Error Message"];

		if (typeof message === "string") {
			return errorRecord(symbol, fetchedAt, message.slice(0, 160));
		}

		// Anything that is not a fund gets an empty object
		if (!Array.isArray(payload.holdings)) {
			logger.debug(`[etf-holdings] ${symbol} is not an ETF`);
			return {
				status: "not-etf",
				holdings: [],
				nonEquity: [],
				totalRows: 0,
				asOf: null,
				leveraged: false,
				fetchedAt
			};
		}

		const parsed = parseRows(payload.holdings);
		const asOf =
			typeof payload.last_updated === "string" ? payload.last_updated.slice(0, 10) : null;
		const leveraged = String(payload.leveraged ?? "").toUpperCase() === "YES";

		logger.info(
			`[etf-holdings] ${symbol}: ${parsed.holdings.length} equity holdings, ${parsed.nonEquity.length} other, ${payload.holdings.length} rows (as of ${asOf ?? "unknown"})`
		);

		return {
			status: "etf",
			...parsed,
			totalRows: payload.holdings.length,
			asOf,
			leveraged,
			fetchedAt
		};
	} catch (error) {
		const reason =
			error instanceof Error && error.name === "AbortError"
				? "timeout"
				: error instanceof Error
					? error.message
					: String(error);
		return errorRecord(symbol, fetchedAt, reason);
	} finally {
		clearTimeout(timeout);
	}
};

const errorRecord = (symbol: string, fetchedAt: number, error: string): EtfHoldingsRecord => {
	logger.warn(`[etf-holdings] Failed to fetch holdings for ${symbol}: ${error}`);
	return {
		status: "error",
		holdings: [],
		nonEquity: [],
		totalRows: 0,
		asOf: null,
		leveraged: false,
		fetchedAt,
		error
	};
};

/**
 * Rows look like `{ symbol: "NVDA", description: "NVIDIA CORP", weight: "0.064" }` with
 * the weight as a fraction of the fund. Rows with no ticker carry `symbol: "n/a"`.
 */
export const parseRows = (rows: unknown[]) => {
	const bySymbol = new Map<string, EtfHolding>();
	const nonEquity: NonEquityHolding[] = [];

	for (const row of rows) {
		if (!isRecord(row)) {
			continue;
		}

		const weight = parseWeight(row.weight);

		if (!Number.isFinite(weight) || weight <= 0) {
			continue;
		}

		const name = cleanText(row.description);
		const symbol = cleanText(row.symbol).toUpperCase();

		if (!symbol) {
			nonEquity.push({ name: name || "Unlisted", weight });
			continue;
		}

		const existing = bySymbol.get(symbol);

		if (existing) {
			// The same security can appear more than once (share classes, lots)
			existing.weight += weight;
			continue;
		}

		bySymbol.set(symbol, { symbol, weight, ...(name && { name }) });
	}

	const holdings = Array.from(bySymbol.values()).sort((a, b) => b.weight - a.weight);

	return { holdings, nonEquity };
};

/** Fraction of the fund as a string ("0.064") to a percentage (6.4). */
const parseWeight = (value: unknown): number => {
	const fraction = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(fraction) ? Math.round(fraction * 100 * 10000) / 10000 : NaN;
};

const cleanText = (value: unknown) => {
	if (typeof value !== "string") {
		return "";
	}

	const trimmed = value.trim();
	return trimmed.toLowerCase() === "n/a" ? "" : trimmed;
};

const isRecordShape = (value: unknown): value is EtfHoldingsRecord => {
	return (
		isRecord(value) &&
		typeof value.status === "string" &&
		Array.isArray(value.holdings) &&
		typeof value.fetchedAt === "number"
	);
};

const isRecord = (value: unknown): value is Record<string, any> => {
	return typeof value === "object" && value !== null;
};
