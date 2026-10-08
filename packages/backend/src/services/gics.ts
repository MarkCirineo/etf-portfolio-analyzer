import logger from "@logger";
import { redisGetJSON, redisSetJSON } from "@redis";
import { getEtfHoldings } from "@services/etf-holdings";

/**
 * GICS sectors, the 11-sector standard most brokerages and fund factsheets use. etf.com
 * only reports FactSet's own 20-odd sectors, so the GICS sector of each company comes
 * from the holdings of sector funds instead: Vanguard's sector funds hold every US company
 * in their MSCI US IMI GICS sector, and iShares' global sector funds the largest ~1,200
 * companies worldwide in their S&P Global 1200 GICS sector.
 */
export const GICS_SECTORS = [
	"Information Technology",
	"Financials",
	"Health Care",
	"Consumer Discretionary",
	"Communication Services",
	"Industrials",
	"Consumer Staples",
	"Energy",
	"Utilities",
	"Real Estate",
	"Materials"
] as const;

export type GicsSector = (typeof GICS_SECTORS)[number];

/** US funds first: where two funds disagree, the broader US classification wins. */
const SECTOR_FUNDS: [string, GicsSector][] = [
	["VGT", "Information Technology"],
	["VFH", "Financials"],
	["VHT", "Health Care"],
	["VCR", "Consumer Discretionary"],
	["VOX", "Communication Services"],
	["VIS", "Industrials"],
	["VDC", "Consumer Staples"],
	["VDE", "Energy"],
	["VPU", "Utilities"],
	["VNQ", "Real Estate"],
	["VAW", "Materials"],
	["IXN", "Information Technology"],
	["IXG", "Financials"],
	["IXJ", "Health Care"],
	["RXI", "Consumer Discretionary"],
	["IXP", "Communication Services"],
	["EXI", "Industrials"],
	["KXI", "Consumer Staples"],
	["IXC", "Energy"],
	["JXI", "Utilities"],
	["REET", "Real Estate"],
	["MXI", "Materials"]
];

const CACHE_KEY = "gics:sectors";
/** Index membership changes quarterly at most; a weekly refresh is plenty. */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 30 * 60 * 1000;
/** A build that loses more funds than this is too patchy to replace a good one. */
const MIN_FUNDS = SECTOR_FUNDS.length - 3;
const SNAPSHOT_VERSION = 2;

type Snapshot = {
	version: number;
	fetchedAt: number;
	/** Security key (ticker + name words) → sector. */
	byKey: Record<string, GicsSector>;
	/** Ticker → sector, for tickers every fund agrees on. */
	bySymbol: Record<string, GicsSector>;
	/**
	 * Name words → sector, for names every fund agrees on. Issuers write foreign tickers
	 * differently (Nordea is NDA.FI to one, NDA-FI to another), so the name is a fallback.
	 */
	byName: Record<string, GicsSector>;
};

export type GicsClassifier = {
	/** A security's sector by its key, else its ticker, else its name; null if unknown. */
	sectorOf: (key: string, symbol: string) => GicsSector | null;
};

let memory: { snapshot: Snapshot; classifier: GicsClassifier } | null = null;
let cacheRead: Promise<void> | null = null;
let pending: Promise<void> | null = null;
let lastFailureAt = 0;

/**
 * The classifier, or null while none has been built yet. Building reads 22 funds'
 * holdings (about half a minute through the holdings service), so it never holds up an
 * analysis: it runs in the background, and a stale copy is served meanwhile.
 */
export const getGicsClassifier = async (): Promise<GicsClassifier | null> => {
	if (!memory) {
		cacheRead ??= loadCached();
		await cacheRead;
	}

	if (!memory || isDue(memory.snapshot)) {
		void refresh();
	}

	return memory?.classifier ?? null;
};

const loadCached = async () => {
	const cached = await redisGetJSON<Snapshot>(CACHE_KEY).catch(() => null);

	if (cached?.version === SNAPSHOT_VERSION && cached.byKey && cached.bySymbol && cached.byName) {
		remember(cached);
	}
};

const isDue = (snapshot: Snapshot) => Date.now() - snapshot.fetchedAt >= REFRESH_AFTER_MS;

const refresh = () => {
	if (pending) {
		return pending;
	}

	pending = (async () => {
		if (Date.now() - lastFailureAt < RETRY_AFTER_MS) {
			return;
		}

		const built = await build();

		if (!built) {
			lastFailureAt = Date.now();
			return;
		}

		remember(built);
		await redisSetJSON(CACHE_KEY, built, HARD_TTL_MS).catch((error) => {
			logger.warn(`[gics] Failed to cache sectors: ${describe(error)}`);
		});
	})()
		.catch((error) => {
			lastFailureAt = Date.now();
			logger.warn(`[gics] Failed to build sectors: ${describe(error)}`);
		})
		.finally(() => {
			pending = null;
		});

	return pending;
};

const build = async (): Promise<Snapshot | null> => {
	const byKey: Record<string, GicsSector> = {};
	const symbolSectors = new Map<string, Set<GicsSector>>();
	const nameSectors = new Map<string, Set<GicsSector>>();
	let loaded = 0;

	// One at a time: the holdings service is rate limited, and this runs in the background
	for (const [fund, sector] of SECTOR_FUNDS) {
		const record = await getEtfHoldings(fund);

		// Alpha Vantage only lists US positions, which would quietly drop every
		// international company; if etf.com is down, try again later instead
		if (record.status !== "etf" || record.source !== "etf.com") {
			logger.warn(`[gics] No etf.com holdings for ${fund} (${record.status})`);

			if (loaded === 0) {
				return null;
			}

			continue;
		}

		loaded += 1;

		for (const holding of record.holdings) {
			if (!holding.symbol) {
				continue;
			}

			byKey[holding.key] ??= sector;

			addTo(symbolSectors, holding.symbol, sector);

			const name = nameOf(holding.key);
			if (name) {
				addTo(nameSectors, name, sector);
			}
		}
	}

	if (loaded < MIN_FUNDS) {
		logger.warn(`[gics] Only ${loaded} of ${SECTOR_FUNDS.length} sector funds loaded`);
		return null;
	}

	const bySymbol = unambiguous(symbolSectors);
	const byName = unambiguous(nameSectors);

	logger.info(
		`[gics] Classified ${Object.keys(byKey).length} securities from ${loaded} sector funds`
	);

	return { version: SNAPSHOT_VERSION, fetchedAt: Date.now(), byKey, bySymbol, byName };
};

const remember = (snapshot: Snapshot) => {
	memory = {
		snapshot,
		classifier: {
			sectorOf: (key, symbol) =>
				snapshot.byKey[key] ??
				snapshot.bySymbol[symbol] ??
				snapshot.byName[nameOf(key)] ??
				null
		}
	};
};

/** The name part of a security key ("NDA.FI|abp bank nordea" → "abp bank nordea"). */
const nameOf = (key: string) => key.slice(key.indexOf("|") + 1);

const addTo = (map: Map<string, Set<GicsSector>>, key: string, sector: GicsSector) => {
	const sectors = map.get(key) ?? new Set();
	sectors.add(sector);
	map.set(key, sectors);
};

/** Keep only the entries every fund puts in the same sector. */
const unambiguous = (map: Map<string, Set<GicsSector>>) => {
	const result: Record<string, GicsSector> = {};

	for (const [key, sectors] of map) {
		if (sectors.size === 1) {
			result[key] = sectors.values().next().value!;
		}
	}

	return result;
};

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
