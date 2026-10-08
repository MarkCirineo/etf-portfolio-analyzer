import logger from "@logger";
import { redisGetJSON, redisSetJSON } from "@redis";

/**
 * Every US-listed security (Nasdaq, NYSE, Arca, Cboe) with its full name and an ETF flag,
 * from Nasdaq's daily symbol directory. Ticker search runs against it locally, so it costs
 * no quote-provider calls: Finnhub's search shares the price budget and knows funds only by
 * abbreviations ("VG MORNINGSTAR TS MKT ET" for VTI).
 */
const DIRECTORY_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt";
const CACHE_KEY = "symbols:directory";
/** Nasdaq rebuilds the file daily; new listings (an IPO) show up the next day. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const HARD_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const SNAPSHOT_VERSION = 1;

export type Listing = { symbol: string; name: string; etf: boolean };

type Snapshot = { version: number; fetchedAt: number; listings: Listing[] };

type Indexed = Listing & { symbolLower: string; words: string[]; minor: boolean };

let memory: { snapshot: Snapshot; indexed: Indexed[] } | null = null;
let cacheRead: Promise<void> | null = null;
let pending: Promise<void> | null = null;
let lastFailureAt = 0;

/** Listings matching a ticker or name, best first; null while the directory is unavailable. */
export const searchListings = async (query: string, limit = 10): Promise<Listing[] | null> => {
	if (!memory) {
		cacheRead ??= loadCached();
		await cacheRead;
	}

	if (!memory) {
		// Nothing cached yet: this first download is quick (about a megabyte)
		await refresh();
	} else if (Date.now() - memory.snapshot.fetchedAt >= REFRESH_AFTER_MS) {
		void refresh();
	}

	return memory ? rank(memory.indexed, query, limit) : null;
};

/**
 * Exact ticker, then tickers starting with the query, then names whose words start with
 * every word of the query. Ordinary shares and funds come before warrants, rights, units
 * and preferreds, then shorter tickers and names.
 */
const rank = (indexed: Indexed[], query: string, limit: number): Listing[] => {
	const needle = query.trim().toLowerCase();
	const tokens = needle.split(/[^a-z0-9]+/).filter(Boolean);

	if (!needle || tokens.length === 0) {
		return [];
	}

	const scored: { entry: Indexed; score: number }[] = [];

	for (const entry of indexed) {
		let score: number;

		if (entry.symbolLower === needle) {
			score = 0;
		} else if (entry.symbolLower.startsWith(needle)) {
			score = 1;
		} else if (tokens.every((token) => entry.words.some((word) => word.startsWith(token)))) {
			score = 2;
		} else {
			continue;
		}

		scored.push({ entry, score: score * 2 + (entry.minor ? 1 : 0) });
	}

	return scored
		.sort(
			(a, b) =>
				a.score - b.score ||
				a.entry.symbol.length - b.entry.symbol.length ||
				a.entry.name.length - b.entry.name.length
		)
		.slice(0, limit)
		.map(({ entry }) => ({ symbol: entry.symbol, name: entry.name, etf: entry.etf }));
};

const MINOR_ISSUE = /\b(warrants?|rights?|units?|preferred|depositary shares? each|notes? due)\b/i;

const remember = (snapshot: Snapshot) => {
	memory = {
		snapshot,
		indexed: snapshot.listings.map((listing) => ({
			...listing,
			symbolLower: listing.symbol.toLowerCase(),
			words: listing.name
				.toLowerCase()
				.split(/[^a-z0-9]+/)
				.filter(Boolean),
			minor: MINOR_ISSUE.test(listing.name)
		}))
	};
};

const loadCached = async () => {
	const cached = await redisGetJSON<Snapshot>(CACHE_KEY).catch(() => null);

	if (cached?.version === SNAPSHOT_VERSION && Array.isArray(cached.listings)) {
		remember(cached);
	}
};

const refresh = () => {
	if (pending) {
		return pending;
	}

	pending = (async () => {
		if (Date.now() - lastFailureAt < RETRY_AFTER_MS) {
			return;
		}

		const listings = await download();

		if (!listings) {
			lastFailureAt = Date.now();
			return;
		}

		const snapshot: Snapshot = { version: SNAPSHOT_VERSION, fetchedAt: Date.now(), listings };
		remember(snapshot);
		await redisSetJSON(CACHE_KEY, snapshot, HARD_TTL_MS).catch((error) => {
			logger.warn(`[symbols] Failed to cache the directory: ${describe(error)}`);
		});
	})().finally(() => {
		pending = null;
	});

	return pending;
};

/**
 * Pipe-delimited, one security per line: "Y|VTI|Vanguard Total Stock Market ETF|P| |Y|…",
 * with a header row and a "File Creation Time" footer.
 */
const download = async (): Promise<Listing[] | null> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(DIRECTORY_URL, {
			headers: { "User-Agent": "etf-portfolio-analyzer" },
			signal: controller.signal
		});

		if (!response.ok) {
			logger.warn(`[symbols] Symbol directory returned HTTP ${response.status}`);
			return null;
		}

		const [header, ...lines] = (await response.text()).split(/\r?\n/);
		const columns = header.split("|");
		const at = (name: string) => columns.indexOf(name);
		const [symbolAt, nameAt, etfAt, testAt] = [
			at("Symbol"),
			at("Security Name"),
			at("ETF"),
			at("Test Issue")
		];

		if ([symbolAt, nameAt, etfAt, testAt].includes(-1)) {
			logger.warn(`[symbols] Unexpected directory header: ${header}`);
			return null;
		}

		const listings: Listing[] = [];

		for (const line of lines) {
			const fields = line.split("|");
			const symbol = fields[symbolAt]?.trim();

			if (!symbol || fields[testAt] === "Y" || line.startsWith("File Creation Time")) {
				continue;
			}

			listings.push({
				symbol,
				name: cleanName(fields[nameAt] ?? ""),
				etf: fields[etfAt] === "Y"
			});
		}

		logger.info(`[symbols] Loaded ${listings.length} US listings`);

		return listings.length > 1000 ? listings : null;
	} catch (error) {
		logger.warn(`[symbols] Failed to load the symbol directory: ${describe(error)}`);
		return null;
	} finally {
		clearTimeout(timeout);
	}
};

/** "Apple Inc. - Common Stock" → "Apple Inc."; keeps "Class A", which tells GOOGL from GOOG. */
const cleanName = (name: string) =>
	name
		.replace(/\s*-?\s*(Common Stock|Ordinary Shares|Common Shares)\s*$/i, "")
		.replace(/\s+-\s*$/, "")
		.trim();

const describe = (error: unknown) => {
	if (error instanceof Error) {
		return error.name === "AbortError" ? "timeout" : error.message;
	}

	return String(error);
};
