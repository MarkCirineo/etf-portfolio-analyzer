import config from "@config";
import logger from "@logger";
import { redisGetJSON, redisSetJSON } from "@redis";
import { matchesRegisteredName } from "@utils/security-identity";

/**
 * Every US-listed ticker and the company registered under it, from the SEC. Used to tell
 * which of a fund's holdings can be priced as a US listing: a foreign company that shares
 * a ticker with a US one (Merck KGaA's MRK) must not be priced as the US company.
 */
const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const CACHE_KEY = "sec:tickers";
/** New listings appear daily but rarely matter here; a weekly refresh is plenty. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** After a failed fetch with nothing cached, wait this long before trying again. */
const RETRY_AFTER_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
/** The SEC asks automated clients to identify themselves; config can add contact details. */
const DEFAULT_USER_AGENT = "etf-portfolio-analyzer";

type Snapshot = { fetchedAt: number; titles: Record<string, string> };

let memory: { snapshot: Snapshot; map: Map<string, string> } | null = null;
let pending: Promise<void> | null = null;
let lastFailureAt = 0;

/** Ticker → registered company name, or null when the list cannot be loaded. */
export const getUsListings = async (): Promise<Map<string, string> | null> => {
	if (!memory || isDue(memory.snapshot)) {
		await refresh();
	}

	return memory?.map ?? null;
};

/**
 * Whether a fund's (ticker, name) is the company registered in the US under that ticker.
 * Funds write share classes with a dot (BRK.B); the SEC uses a dash (BRK-B).
 */
export const isUsListing = (
	listings: Map<string, string>,
	symbol: string,
	name: string | null | undefined
): boolean => {
	const registered = registeredName(listings, symbol);
	return registered !== undefined && matchesRegisteredName(name, registered);
};

/** The company the SEC registers under a ticker, if any. */
export const registeredName = (listings: Map<string, string>, symbol: string) =>
	listings.get(symbol.replace(/\./g, "-"));

const isDue = (snapshot: Snapshot) => Date.now() - snapshot.fetchedAt >= REFRESH_AFTER_MS;

const refresh = async () => {
	if (pending) {
		return pending;
	}

	pending = (async () => {
		if (!memory) {
			const cached = await redisGetJSON<Snapshot>(CACHE_KEY).catch(() => null);

			if (cached && typeof cached.fetchedAt === "number" && cached.titles) {
				remember(cached);

				if (!isDue(cached)) {
					return;
				}
			}
		}

		if (Date.now() - lastFailureAt < RETRY_AFTER_MS) {
			return;
		}

		const fetched = await fetchFromSec();

		if (!fetched) {
			lastFailureAt = Date.now();
			return;
		}

		remember(fetched);
		await redisSetJSON(CACHE_KEY, fetched, HARD_TTL_MS).catch((error) => {
			logger.warn(`[us-listings] Failed to cache SEC tickers: ${describe(error)}`);
		});
	})().finally(() => {
		pending = null;
	});

	return pending;
};

const remember = (snapshot: Snapshot) => {
	memory = { snapshot, map: new Map(Object.entries(snapshot.titles)) };
};

const fetchFromSec = async (): Promise<Snapshot | null> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(SEC_TICKERS_URL, {
			headers: {
				// Optional, so read defensively: older config files don't have it
				"User-Agent":
					(config as { sec_user_agent?: string }).sec_user_agent || DEFAULT_USER_AGENT,
				Accept: "application/json"
			},
			signal: controller.signal
		});

		if (!response.ok) {
			logger.warn(`[us-listings] SEC ticker list returned HTTP ${response.status}`);
			return null;
		}

		// { "0": { cik_str, ticker, title }, "1": … }
		const payload = (await response.json()) as Record<
			string,
			{ ticker?: unknown; title?: unknown }
		>;
		const titles: Record<string, string> = {};

		for (const entry of Object.values(payload)) {
			if (typeof entry?.ticker === "string" && typeof entry.title === "string") {
				titles[entry.ticker.toUpperCase()] = entry.title;
			}
		}

		logger.info(`[us-listings] Loaded ${Object.keys(titles).length} US tickers from the SEC`);

		return { fetchedAt: Date.now(), titles };
	} catch (error) {
		logger.warn(`[us-listings] Failed to load SEC tickers: ${describe(error)}`);
		return null;
	} finally {
		clearTimeout(timeout);
	}
};

const describe = (error: unknown) => {
	if (error instanceof Error) {
		return error.name === "AbortError" ? "timeout" : error.message;
	}

	return String(error);
};
