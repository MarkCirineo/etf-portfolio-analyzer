import config from "@config";
import logger from "@logger";
import { redisGetJSON, redisSetJSON } from "@redis";

export type EtfHolding = {
	symbol: string;
	/** Percent of the fund, 0-100. */
	weight: number;
	name?: string;
	/**
	 * Whether the symbol can plausibly be priced as a US listing. Funds report foreign
	 * positions under their local exchange ticker (2330 for TSMC, 005930 for Samsung),
	 * which the quote provider cannot resolve.
	 */
	usListed: boolean;
};

/** Cash, treasuries, swaps and other rows the fund reports without a ticker. */
export type NonEquityHolding = {
	name: string;
	weight: number;
};

export type HoldingsSource = "etf.com" | "alphavantage";

export type EtfHoldingsRecord = {
	/** "not-etf" is a definitive answer from the provider (a stock, or an unknown symbol). */
	status: "etf" | "not-etf" | "error";
	holdings: EtfHolding[];
	nonEquity: NonEquityHolding[];
	/** Rows the provider reported, including ones too small to carry a weight. */
	totalRows: number;
	asOf: string | null;
	/** Leveraged and inverse funds hold swaps, so their reported holdings understate exposure. */
	leveraged: boolean;
	source: HoldingsSource | null;
	fetchedAt: number;
	error?: string;
};

const REQUEST_TIMEOUT_MS = 45 * 1000;
const CACHE_PREFIX = "etf:holdings";
/** Providers publish holdings at most daily; refresh after this. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** Keep serving an old snapshot until this long after it was fetched. */
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A failed lookup with nothing cached is retried after this. */
const ERROR_TTL_MS = 10 * 60 * 1000;
/** Alpha Vantage's free tier rejects bursts, so provider calls are spaced out. */
const PROVIDER_MIN_INTERVAL_MS = 1100;

const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";

/**
 * Letters with an optional dot or dash, which is what US tickers look like (BRK-B, BF.B).
 * Numeric tickers (2330, 005930, 700) are always foreign listings. Some letter-only
 * foreign tickers slip through; those fail their quote once and are negative-cached.
 */
const US_SYMBOL_PATTERN = /^[A-Z][A-Z.-]{0,6}$/;

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
		logger.warn(`[etf-holdings] Failed to read cache for ${normalized}: ${describe(error)}`);
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
		logger.warn(`[etf-holdings] Failed to cache ${normalized}: ${describe(error)}`);
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

/**
 * etf.com reports every position a fund holds, including foreign listings, so it is the
 * primary source. Alpha Vantage only reports positions with a US-listed ticker — VXUS comes
 * back 5% covered instead of 94% — so it is a fallback for when the holdings service is not
 * running.
 */
export const fetchEtfHoldingsFromProvider = async (symbol: string): Promise<EtfHoldingsRecord> => {
	const fromScraper = await fetchFromScraper(symbol);

	if (fromScraper.status !== "error") {
		return fromScraper;
	}

	const fromAlphaVantage = await fetchFromAlphaVantage(symbol);

	if (fromAlphaVantage.status !== "error") {
		logger.warn(
			`[etf-holdings] ${symbol}: holdings service unavailable (${fromScraper.error}), fell back to Alpha Vantage — coverage may be incomplete`
		);
		return fromAlphaVantage;
	}

	return {
		...fromScraper,
		error: `etf.com: ${fromScraper.error}; alphavantage: ${fromAlphaVantage.error}`
	};
};

type ScraperResponse = {
	status?: string;
	rows?: unknown;
	asOf?: unknown;
	error?: unknown;
};

const fetchFromScraper = async (symbol: string): Promise<EtfHoldingsRecord> => {
	const fetchedAt = Date.now();
	const baseUrl = config.etf_scraper_url;

	if (!baseUrl) {
		return errorRecord(symbol, fetchedAt, "etf_scraper_url is not configured", false);
	}

	try {
		const payload = await getJSON<ScraperResponse>(
			`${baseUrl.replace(/\/$/, "")}/etf-holdings/${encodeURIComponent(symbol)}`
		);

		if (payload.status === "not-etf") {
			logger.debug(`[etf-holdings] ${symbol} is not an ETF`);
			return notEtfRecord(fetchedAt, "etf.com");
		}

		if (payload.status !== "etf" || !Array.isArray(payload.rows)) {
			const reason =
				typeof payload.error === "string" ? payload.error : "unexpected_response";
			return errorRecord(symbol, fetchedAt, reason, false);
		}

		const parsed = parseEtfComRows(payload.rows);
		const asOf = typeof payload.asOf === "string" ? payload.asOf.slice(0, 10) : null;

		logReceived(symbol, parsed, payload.rows.length, asOf, "etf.com");

		return {
			status: "etf",
			...parsed,
			totalRows: payload.rows.length,
			asOf,
			// etf.com reports the swaps a leveraged fund holds, so no separate flag is needed
			leveraged: false,
			source: "etf.com",
			fetchedAt
		};
	} catch (error) {
		return errorRecord(symbol, fetchedAt, describe(error), false);
	}
};

const fetchFromAlphaVantage = async (symbol: string): Promise<EtfHoldingsRecord> => {
	const fetchedAt = Date.now();
	const apiKey = config.alpha_vantage_api_key;

	if (!apiKey) {
		return errorRecord(symbol, fetchedAt, "Alpha Vantage API key is not configured", false);
	}

	try {
		const url = new URL(ALPHA_VANTAGE_URL);
		url.searchParams.set("function", "ETF_PROFILE");
		url.searchParams.set("symbol", symbol);
		url.searchParams.set("apikey", apiKey);

		const payload = await getJSON<Record<string, any>>(url);

		// Rate limiting and bad requests come back as 200 with a message field
		const message = payload.Information ?? payload.Note ?? payload["Error Message"];

		if (typeof message === "string") {
			return errorRecord(symbol, fetchedAt, message.slice(0, 160), false);
		}

		// Anything that is not a fund gets an empty object
		if (!Array.isArray(payload.holdings)) {
			return notEtfRecord(fetchedAt, "alphavantage");
		}

		const parsed = parseAlphaVantageRows(payload.holdings);
		const asOf =
			typeof payload.last_updated === "string" ? payload.last_updated.slice(0, 10) : null;

		logReceived(symbol, parsed, payload.holdings.length, asOf, "alphavantage");

		return {
			status: "etf",
			...parsed,
			totalRows: payload.holdings.length,
			asOf,
			leveraged: String(payload.leveraged ?? "").toUpperCase() === "YES",
			source: "alphavantage",
			fetchedAt
		};
	} catch (error) {
		return errorRecord(symbol, fetchedAt, describe(error), false);
	}
};

const getJSON = async <T>(url: string | URL): Promise<T> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(url, { signal: controller.signal });

		if (!response.ok) {
			throw new Error(`http_${response.status}`);
		}

		const payload = await response.json();

		if (!isRecord(payload)) {
			throw new Error("unexpected_response");
		}

		return payload as T;
	} finally {
		clearTimeout(timeout);
	}
};

/** etf.com rows: `{ symbol: "2330", name: "Taiwan Semi...", weight: "3.94%" }`. */
export const parseEtfComRows = (rows: unknown[]) => {
	return collectHoldings(rows, (row) => ({
		symbol: cleanText(row.symbol).toUpperCase(),
		name: cleanText(row.name),
		weight: parsePercentString(row.weight)
	}));
};

/**
 * Alpha Vantage rows: `{ symbol: "NVDA", description: "NVIDIA CORP", weight: "0.064" }`,
 * with the weight as a fraction of the fund and no ticker rendered as "n/a".
 */
export const parseAlphaVantageRows = (rows: unknown[]) => {
	return collectHoldings(rows, (row) => ({
		symbol: cleanText(row.symbol).toUpperCase(),
		name: cleanText(row.description),
		weight: parseFraction(row.weight)
	}));
};

const collectHoldings = (
	rows: unknown[],
	read: (row: Record<string, any>) => { symbol: string; name: string; weight: number }
) => {
	const bySymbol = new Map<string, EtfHolding>();
	const nonEquity: NonEquityHolding[] = [];

	for (const row of rows) {
		if (!isRecord(row)) {
			continue;
		}

		const { symbol, name, weight } = read(row);

		if (!Number.isFinite(weight) || weight <= 0) {
			continue;
		}

		if (!symbol) {
			nonEquity.push({ name: name || "Unlisted", weight });
			continue;
		}

		const existing = bySymbol.get(symbol);

		if (existing) {
			// The same security can appear more than once (share classes, lots)
			existing.weight = round(existing.weight + weight);
			continue;
		}

		bySymbol.set(symbol, {
			symbol,
			weight,
			usListed: US_SYMBOL_PATTERN.test(symbol),
			...(name && { name })
		});
	}

	const holdings = Array.from(bySymbol.values()).sort((a, b) => b.weight - a.weight);

	return { holdings, nonEquity };
};

const logReceived = (
	symbol: string,
	parsed: { holdings: EtfHolding[]; nonEquity: NonEquityHolding[] },
	totalRows: number,
	asOf: string | null,
	source: HoldingsSource
) => {
	const covered =
		parsed.holdings.reduce((sum, holding) => sum + holding.weight, 0) +
		parsed.nonEquity.reduce((sum, item) => sum + item.weight, 0);
	const foreign = parsed.holdings.filter((holding) => !holding.usListed).length;

	logger.info(
		`[etf-holdings] ${symbol} via ${source}: ${parsed.holdings.length} holdings (${foreign} foreign-listed), ${parsed.nonEquity.length} other, ${totalRows} rows, ${covered.toFixed(2)}% of fund covered (as of ${asOf ?? "unknown"})`
	);
};

const notEtfRecord = (fetchedAt: number, source: HoldingsSource): EtfHoldingsRecord => ({
	status: "not-etf",
	holdings: [],
	nonEquity: [],
	totalRows: 0,
	asOf: null,
	leveraged: false,
	source,
	fetchedAt
});

const errorRecord = (
	symbol: string,
	fetchedAt: number,
	error: string,
	shouldLog = true
): EtfHoldingsRecord => {
	if (shouldLog) {
		logger.warn(`[etf-holdings] Failed to fetch holdings for ${symbol}: ${error}`);
	}

	return {
		status: "error",
		holdings: [],
		nonEquity: [],
		totalRows: 0,
		asOf: null,
		leveraged: false,
		source: null,
		fetchedAt,
		error
	};
};

/** "3.94%" to 3.94. */
const parsePercentString = (value: unknown): number => {
	const percent =
		typeof value === "number" ? value : parseFloat(String(value ?? "").replace("%", ""));
	return Number.isFinite(percent) ? round(percent) : NaN;
};

/** Fraction of the fund ("0.064") to a percentage (6.4). */
const parseFraction = (value: unknown): number => {
	const fraction = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(fraction) ? round(fraction * 100) : NaN;
};

const round = (value: number) => Math.round(value * 10000) / 10000;

const cleanText = (value: unknown) => {
	if (typeof value !== "string") {
		return "";
	}

	const trimmed = value.trim();
	return trimmed.toLowerCase() === "n/a" ? "" : trimmed;
};

const describe = (error: unknown) => {
	if (error instanceof Error) {
		return error.name === "AbortError" ? "timeout" : error.message;
	}

	return String(error);
};

const isRecordShape = (value: unknown): value is EtfHoldingsRecord => {
	return (
		isRecord(value) &&
		typeof value.status === "string" &&
		Array.isArray(value.holdings) &&
		typeof value.fetchedAt === "number" &&
		// Entries cached before holdings carried a source or listing flags
		"source" in value
	);
};

const isRecord = (value: unknown): value is Record<string, any> => {
	return typeof value === "object" && value !== null;
};
