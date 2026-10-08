import config from "@config";
import logger from "@logger";
import { redisGetJSON, redisSetJSON } from "@redis";

/** Name → percent of the fund (0-100). */
export type Breakdown = { name: string; weight: number }[];

/** Fund-level facts from etf.com, fetched through the holdings service. */
export type FundProfile = {
	/** "not-etf" is a definitive answer from the provider (a stock, or an unknown symbol). */
	status: "etf" | "not-etf" | "error";
	issuer: string | null;
	/** ISO date. */
	inceptionDate: string | null;
	/** Percent per year, e.g. 0.03 for VTI. */
	expenseRatio: number | null;
	/** Dollars. */
	assetsUnderManagement: number | null;
	indexTracked: string | null;
	/** Percent per year. */
	distributionYield: number | null;
	priceToEarnings: number | null;
	priceToBook: number | null;
	/** Dollars. */
	weightedAvgMarketCap: number | null;
	/** FactSet's economic sectors ("Finance", "Electronic Technology", …), as the provider reports them. */
	sectors: Breakdown;
	countries: Breakdown;
	regions: Breakdown;
	/** Large / Mid / Small / Micro. */
	marketCap: Breakdown;
	/** Month-end value of $10,000 invested at inception, oldest first. */
	growth: { date: string; value: number }[];
	competitors: {
		symbol: string;
		expenseRatio: number | null;
		assetsUnderManagement: number | null;
	}[];
	fetchedAt: number;
	error?: string;
};

const REQUEST_TIMEOUT_MS = 60 * 1000;
const CACHE_PREFIX = "etf:profile";
/** Providers update these at most daily; refresh after this. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** Keep serving an old profile until this long after it was fetched. */
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A failed lookup with nothing cached is retried after this. */
const ERROR_TTL_MS = 10 * 60 * 1000;

const buildCacheKey = (symbol: string) => `${CACHE_PREFIX}:${symbol}`;

// A profile is six requests to etf.com, so lookups run one fund at a time and concurrent
// analyses share a lookup already underway.
const inFlight = new Map<string, Promise<FundProfile>>();
let providerQueue: Promise<unknown> = Promise.resolve();

export const getFundProfile = async (symbol: string): Promise<FundProfile> => {
	const normalized = symbol.trim().toUpperCase();
	const cacheKey = buildCacheKey(normalized);
	let cached: FundProfile | null = null;

	try {
		const entry = await redisGetJSON<FundProfile>(cacheKey);

		if (entry && isProfileShape(entry)) {
			cached = entry;
		}
	} catch (error) {
		logger.warn(`[fund-profile] Failed to read cache for ${normalized}: ${describe(error)}`);
	}

	if (cached && Date.now() - cached.fetchedAt < REFRESH_AFTER_MS) {
		return cached;
	}

	const profile = await lookupOnce(normalized);

	if (profile.status === "error" && cached && cached.status !== "error") {
		logger.warn(`[fund-profile] Refresh failed for ${normalized}, serving cached profile`);
		return cached;
	}

	const ttl = profile.status === "error" ? ERROR_TTL_MS : HARD_TTL_MS;

	await redisSetJSON(cacheKey, profile, ttl).catch((error) => {
		logger.warn(`[fund-profile] Failed to cache ${normalized}: ${describe(error)}`);
	});

	return profile;
};

const lookupOnce = (symbol: string): Promise<FundProfile> => {
	const existing = inFlight.get(symbol);

	if (existing) {
		return existing;
	}

	const run = providerQueue.then(() => fetchFundProfile(symbol));
	providerQueue = run.catch(() => undefined);

	const pending = run.finally(() => inFlight.delete(symbol));
	inFlight.set(symbol, pending);

	return pending;
};

type ScraperProfileResponse = {
	status?: string;
	sections?: Record<string, unknown>;
	errors?: Record<string, string>;
	error?: unknown;
};

export const fetchFundProfile = async (symbol: string): Promise<FundProfile> => {
	const fetchedAt = Date.now();
	const baseUrl = config.etf_scraper_url;

	if (!baseUrl) {
		return emptyProfile("error", fetchedAt, "etf_scraper_url is not configured");
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(
			`${baseUrl.replace(/\/$/, "")}/etf-profile/${encodeURIComponent(symbol)}`,
			{ signal: controller.signal }
		);

		if (!response.ok) {
			return logged(symbol, emptyProfile("error", fetchedAt, `http_${response.status}`));
		}

		const payload = (await response.json()) as ScraperProfileResponse;

		if (payload.status === "not-etf") {
			return emptyProfile("not-etf", fetchedAt);
		}

		if (payload.status !== "etf" || !isRecord(payload.sections)) {
			const reason =
				typeof payload.error === "string" ? payload.error : "unexpected_response";
			return logged(symbol, emptyProfile("error", fetchedAt, reason));
		}

		const profile = parseProfile(payload.sections, fetchedAt);
		const missing = Object.keys(payload.errors ?? {});

		logger.info(
			`[fund-profile] ${symbol}: ${profile.sectors.length} sectors, ${profile.countries.length} countries, ${profile.growth.length} months of history, expense ratio ${profile.expenseRatio ?? "unknown"}%${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`
		);

		return profile;
	} catch (error) {
		return logged(symbol, emptyProfile("error", fetchedAt, describe(error)));
	} finally {
		clearTimeout(timeout);
	}
};

/** Turns the provider's display strings into numbers; anything it cannot read becomes null. */
export const parseProfile = (sections: Record<string, unknown>, fetchedAt: number): FundProfile => {
	const summary = fieldsByName(sections.summary);
	const portfolio = fieldsByName(sections.portfolio);

	return {
		status: "etf",
		issuer: parseText(summary.issuer),
		inceptionDate: parseShortDate(summary.inceptionDate),
		expenseRatio: parsePercent(summary.expenseRatio),
		assetsUnderManagement: parseMoney(summary.aum),
		indexTracked: parseText(summary.indexTracked),
		distributionYield: parsePercent(portfolio.distributionYield),
		priceToEarnings: parsePositive(portfolio.pe),
		priceToBook: parsePositive(portfolio.pb),
		weightedAvgMarketCap: parseMoney(portfolio.weightedAvgMarketCap),
		sectors: parseBreakdown(sections.sectors, "weight"),
		countries: parseBreakdown(sections.countries, "weight"),
		regions: parseBreakdown(sections.regions, "weight"),
		marketCap: parseBreakdown(sections.marketCap, "value"),
		growth: parseGrowth(sections.growth),
		competitors: parseCompetitors(sections.competitors),
		fetchedAt
	};
};

const fieldsByName = (rows: unknown): Record<string, unknown> => {
	const result: Record<string, unknown> = {};

	if (!Array.isArray(rows)) {
		return result;
	}

	for (const row of rows) {
		if (isRecord(row) && typeof row.name === "string") {
			result[row.name] = row.value;
		}
	}

	return result;
};

const parseBreakdown = (rows: unknown, valueKey: "weight" | "value"): Breakdown => {
	if (!Array.isArray(rows)) {
		return [];
	}

	const result: Breakdown = [];

	for (const row of rows) {
		if (!isRecord(row)) {
			continue;
		}

		const name = parseText(row.name);
		const weight = parsePercent(row[valueKey]);

		if (name && weight !== null && weight > 0) {
			result.push({ name, weight });
		}
	}

	return result.sort((a, b) => b.weight - a.weight);
};

const parseGrowth = (rows: unknown): FundProfile["growth"] => {
	if (!Array.isArray(rows)) {
		return [];
	}

	const result: FundProfile["growth"] = [];

	for (const row of rows) {
		if (!isRecord(row)) {
			continue;
		}

		const date = typeof row.navDate === "string" ? row.navDate.slice(0, 10) : "";
		const value = typeof row.tenkValue === "number" ? row.tenkValue : NaN;

		if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value > 0) {
			result.push({ date, value });
		}
	}

	// The provider lists newest first
	return result.sort((a, b) => a.date.localeCompare(b.date));
};

const parseCompetitors = (rows: unknown): FundProfile["competitors"] => {
	if (!Array.isArray(rows)) {
		return [];
	}

	const result: FundProfile["competitors"] = [];

	for (const row of rows) {
		if (!isRecord(row)) {
			continue;
		}

		const symbol = parseText(row.symbol)?.toUpperCase();

		if (symbol) {
			result.push({
				symbol,
				expenseRatio: parsePercent(row.expense_ratio),
				assetsUnderManagement: parseMoney(row.aum)
			});
		}
	}

	return result;
};

/** Missing values arrive as null, "None", "None%", "--" or "". */
const isMissing = (value: unknown) => {
	if (value === null || value === undefined) {
		return true;
	}

	const text = String(value).trim().toLowerCase();
	return text === "" || text === "none" || text === "none%" || text === "--" || text === "n/a";
};

const parseText = (value: unknown): string | null => {
	return isMissing(value) || typeof value !== "string" ? null : value.trim();
};

/** "24.71%" → 24.71. */
export const parsePercent = (value: unknown): number | null => {
	if (isMissing(value)) {
		return null;
	}

	const number = typeof value === "number" ? value : parseFloat(String(value).replace("%", ""));
	return Number.isFinite(number) ? number : null;
};

const parsePositive = (value: unknown): number | null => {
	const number = parsePercent(value);
	return number !== null && number > 0 ? number : null;
};

const MONEY_SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** "$1404.32B" → 1.40432e12. */
export const parseMoney = (value: unknown): number | null => {
	if (isMissing(value)) {
		return null;
	}

	const match = String(value)
		.replace(/[$,\s]/g, "")
		.match(/^(-?\d+(?:\.\d+)?)([KMBT])?$/i);

	if (!match) {
		return null;
	}

	const scale = match[2] ? MONEY_SCALE[match[2].toUpperCase()] : 1;
	return parseFloat(match[1]) * scale;
};

/** "10/20/11" → "2011-10-20". Two-digit years below 50 are this century. */
const parseShortDate = (value: unknown): string | null => {
	const match = isMissing(value)
		? null
		: String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

	if (!match) {
		return null;
	}

	const [, month, day, rawYear] = match;
	const year = rawYear.length === 4 ? rawYear : `${Number(rawYear) < 50 ? "20" : "19"}${rawYear}`;

	return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

const emptyProfile = (
	status: FundProfile["status"],
	fetchedAt: number,
	error?: string
): FundProfile => ({
	status,
	issuer: null,
	inceptionDate: null,
	expenseRatio: null,
	assetsUnderManagement: null,
	indexTracked: null,
	distributionYield: null,
	priceToEarnings: null,
	priceToBook: null,
	weightedAvgMarketCap: null,
	sectors: [],
	countries: [],
	regions: [],
	marketCap: [],
	growth: [],
	competitors: [],
	fetchedAt,
	...(error && { error })
});

const logged = (symbol: string, profile: FundProfile) => {
	logger.warn(`[fund-profile] Failed to fetch profile for ${symbol}: ${profile.error}`);
	return profile;
};

const describe = (error: unknown) => {
	if (error instanceof Error) {
		return error.name === "AbortError" ? "timeout" : error.message;
	}

	return String(error);
};

const isProfileShape = (value: unknown): value is FundProfile => {
	return (
		isRecord(value) &&
		typeof value.status === "string" &&
		Array.isArray(value.sectors) &&
		Array.isArray(value.growth) &&
		typeof value.fetchedAt === "number"
	);
};

const isRecord = (value: unknown): value is Record<string, any> => {
	return typeof value === "object" && value !== null;
};
