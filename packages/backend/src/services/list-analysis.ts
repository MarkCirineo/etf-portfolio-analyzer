import type { ListContent } from "@db/tables/List";
import { getEtfHoldings, type EtfHoldingsRecord } from "@services/etf-holdings";
import { getMarketSession } from "@utils/market-hours";
import { getQuoteSnapshots, type PriceStatus, type QuoteSnapshot } from "@utils/quotes";

/**
 * Finnhub's free tier allows ~60 quotes a minute, so only the holdings that matter most
 * get a live price. Every holding still gets a dollar exposure and portfolio percentage,
 * which only need the ETF's own price, but the long tail gets no share count.
 */
export const MAX_QUOTED_HOLDINGS = 300;
/** Rows returned per analysis; anything beyond is summarised in `tail`. */
export const MAX_RETURNED_HOLDINGS = 500;
/** The list's own symbols are priced first: their prices unlock everything else. */
const INPUT_PRIORITY = 1000;

export type InputKind = "etf" | "stock" | "unknown";

/** One row of the user's list, as they entered it. */
export type ListInput = {
	symbol: string;
	shares: number;
	kind: InputKind;
	price: number | null;
	priceStatus: PriceStatus;
	value: number | null;
	percentOfPortfolio: number | null;
	holdingsCount: number | null;
	holdingsAsOf: string | null;
	leveraged: boolean;
};

export type EtfContribution = {
	etf: string;
	/** Percent of the ETF this holding represents. */
	weight: number;
	exposure: number;
};

/** One security the user is exposed to, directly and/or through ETFs. */
export type AnalyzedHolding = {
	symbol: string;
	name: string | null;
	exposure: number;
	percentOfPortfolio: number;
	directShares: number;
	derivedShares: number | null;
	totalShares: number | null;
	price: number | null;
	priceStatus: PriceStatus;
	viaEtfs: EtfContribution[];
};

export type ExposureBucket = {
	exposure: number;
	percentOfPortfolio: number;
};

export type ListAnalysis = {
	generatedAt: string;
	marketOpen: boolean;
	/** Market value of the priced inputs. */
	totalValue: number;
	/** False while any input is still waiting for a price. */
	totalValueComplete: boolean;
	inputs: ListInput[];
	holdings: AnalyzedHolding[];
	/** Holdings beyond MAX_RETURNED_HOLDINGS. */
	tail: ExposureBucket & { count: number };
	/** Cash, swaps, positions without a US ticker, and weight the provider left unattributed. */
	cashAndOther: ExposureBucket & { items: { name: string; exposure: number }[] };
	/** Inputs whose holdings lookup failed; treated as directly held stock for now. */
	failedTickers: string[];
	quotes: { requested: number; priced: number; pending: number; unavailable: number };
	pendingQuotes: string[];
	quoteFailures: string[];
};

export type ListAnalysisResult = {
	analysis: ListAnalysis;
	/** Every symbol whose price feeds this analysis; a quote update for one warrants a re-run. */
	trackedSymbols: Set<string>;
};

type ExposureEntry = {
	symbol: string;
	name: string | null;
	directShares: number;
	directExposure: number;
	viaExposure: number;
	viaEtfs: EtfContribution[];
};

export const analyzeList = async (content: ListContent): Promise<ListAnalysisResult> => {
	const entries = parseContent(content);
	const records = await Promise.all(entries.map((entry) => getEtfHoldings(entry.symbol)));

	// 1. Price the list's own symbols. Everything downstream hangs off these.
	const inputSymbols = entries.map((entry) => entry.symbol);
	const inputPriorities = new Map(inputSymbols.map((symbol) => [symbol, INPUT_PRIORITY]));
	const inputQuotes = await getQuoteSnapshots(inputSymbols, inputPriorities);

	// 2. Spread each input's market value over what it holds.
	const exposures = new Map<string, ExposureEntry>();
	const cashItems = new Map<string, number>();
	const inputs: ListInput[] = [];
	const failedTickers: string[] = [];
	let totalValue = 0;
	let totalValueComplete = true;

	entries.forEach((entry, index) => {
		const record = records[index];
		const quote = inputQuotes.get(entry.symbol);
		const kind = classifyInput(record);
		const price = quote?.price ?? null;
		const value = price !== null ? entry.shares * price : null;

		if (kind === "unknown") {
			failedTickers.push(entry.symbol);
		}

		if (value === null) {
			totalValueComplete = false;
		} else {
			totalValue += value;
		}

		inputs.push({
			symbol: entry.symbol,
			shares: entry.shares,
			kind,
			price,
			priceStatus: quote?.status ?? "pending",
			value,
			percentOfPortfolio: null,
			holdingsCount: kind === "etf" ? record.holdings.length : null,
			holdingsAsOf: kind === "etf" ? record.asOf : null,
			leveraged: kind === "etf" && record.leveraged
		});

		if (kind !== "etf") {
			// Directly held (or unresolvable, which is treated the same until it resolves)
			const aggregate = getOrCreateExposure(exposures, entry.symbol);
			aggregate.directShares += entry.shares;
			aggregate.directExposure += value ?? 0;
			return;
		}

		if (value === null) {
			// Nothing to spread until the ETF itself has a price
			return;
		}

		let reportedWeight = 0;

		for (const holding of record.holdings) {
			const exposure = (value * holding.weight) / 100;
			const aggregate = getOrCreateExposure(exposures, holding.symbol);
			aggregate.viaExposure += exposure;
			aggregate.viaEtfs.push({ etf: entry.symbol, weight: holding.weight, exposure });
			reportedWeight += holding.weight;

			if (holding.name && !aggregate.name) {
				aggregate.name = holding.name;
			}
		}

		for (const item of record.nonEquity) {
			addCash(cashItems, item.name, (value * item.weight) / 100);
			reportedWeight += item.weight;
		}

		// Weights rarely sum to exactly 100: positions too small to report, plus rounding
		const remainder = 100 - reportedWeight;

		if (remainder > 0.005) {
			addCash(cashItems, "Unreported / rounding", (value * remainder) / 100);
		}
	});

	for (const input of inputs) {
		input.percentOfPortfolio =
			input.value !== null && totalValue > 0
				? round((input.value / totalValue) * 100, 4)
				: null;
	}

	// 3. Rank the look-through holdings and price the ones that matter.
	const ranked = Array.from(exposures.values()).sort(
		(a, b) => totalExposure(b) - totalExposure(a)
	);
	const holdingPriorities = new Map<string, number>();

	for (const aggregate of ranked) {
		if (holdingPriorities.size >= MAX_QUOTED_HOLDINGS) {
			break;
		}

		if (inputPriorities.has(aggregate.symbol)) {
			continue;
		}

		const exposure = totalExposure(aggregate);

		if (exposure <= 0) {
			break;
		}

		holdingPriorities.set(aggregate.symbol, totalValue > 0 ? (exposure / totalValue) * 100 : 0);
	}

	const holdingSymbols = ranked
		.map((aggregate) => aggregate.symbol)
		.filter((symbol) => !inputPriorities.has(symbol));
	const holdingQuotes = await getQuoteSnapshots(holdingSymbols, holdingPriorities);
	const quoteFor = (symbol: string): QuoteSnapshot | undefined =>
		inputQuotes.get(symbol) ?? holdingQuotes.get(symbol);

	// 4. Assemble the rows.
	const rows: AnalyzedHolding[] = ranked.map((aggregate) => {
		const quote = quoteFor(aggregate.symbol);
		const price = quote?.price ?? null;
		const exposure = totalExposure(aggregate);
		const derivedShares =
			aggregate.viaEtfs.length === 0
				? 0
				: price !== null
					? aggregate.viaExposure / price
					: null;

		return {
			symbol: aggregate.symbol,
			name: aggregate.name,
			exposure: round(exposure, 2),
			percentOfPortfolio: totalValue > 0 ? round((exposure / totalValue) * 100, 4) : 0,
			directShares: round(aggregate.directShares, 4),
			derivedShares: derivedShares === null ? null : round(derivedShares, 4),
			totalShares:
				derivedShares === null ? null : round(aggregate.directShares + derivedShares, 4),
			price,
			priceStatus: quote?.status ?? "not-requested",
			viaEtfs: aggregate.viaEtfs
				.sort((a, b) => b.exposure - a.exposure)
				.map((via) => ({
					...via,
					weight: round(via.weight, 4),
					exposure: round(via.exposure, 2)
				}))
		};
	});

	const returned = rows.slice(0, MAX_RETURNED_HOLDINGS);
	const tailRows = rows.slice(MAX_RETURNED_HOLDINGS);
	const tailExposure = tailRows.reduce((sum, row) => sum + row.exposure, 0);
	const cashEntries = Array.from(cashItems.entries()).sort((a, b) => b[1] - a[1]);
	const cashExposure = cashEntries.reduce((sum, [, exposure]) => sum + exposure, 0);

	// 5. Quote bookkeeping for the UI.
	const requestedSymbols = [...inputPriorities.keys(), ...holdingPriorities.keys()];
	const pendingQuotes: string[] = [];
	const quoteFailures: string[] = [];
	let priced = 0;

	for (const symbol of requestedSymbols) {
		const status = quoteFor(symbol)?.status;

		if (status === "fresh" || status === "stale") {
			priced += 1;
		} else if (status === "pending") {
			pendingQuotes.push(symbol);
		} else if (status === "unavailable") {
			quoteFailures.push(symbol);
		}
	}

	const analysis: ListAnalysis = {
		generatedAt: new Date().toISOString(),
		marketOpen: getMarketSession().isOpen,
		totalValue: round(totalValue, 2),
		totalValueComplete,
		inputs,
		holdings: returned,
		tail: {
			count: tailRows.length,
			exposure: round(tailExposure, 2),
			percentOfPortfolio: totalValue > 0 ? round((tailExposure / totalValue) * 100, 4) : 0
		},
		cashAndOther: {
			exposure: round(cashExposure, 2),
			percentOfPortfolio: totalValue > 0 ? round((cashExposure / totalValue) * 100, 4) : 0,
			items: cashEntries.map(([name, exposure]) => ({ name, exposure: round(exposure, 2) }))
		},
		failedTickers,
		quotes: {
			requested: requestedSymbols.length,
			priced,
			pending: pendingQuotes.length,
			unavailable: quoteFailures.length
		},
		pendingQuotes,
		quoteFailures
	};

	return {
		analysis,
		trackedSymbols: new Set([...inputSymbols, ...holdingSymbols])
	};
};

const parseContent = (content: ListContent) => {
	const entries: { symbol: string; shares: number }[] = [];

	for (const [rawTicker, rawShares] of Object.entries(content ?? {})) {
		const symbol = rawTicker.trim().toUpperCase();
		const shares = Number(rawShares);

		if (symbol && Number.isFinite(shares) && shares > 0) {
			entries.push({ symbol, shares });
		}
	}

	return entries;
};

const classifyInput = (record: EtfHoldingsRecord): InputKind => {
	if (record.status === "error") {
		return "unknown";
	}

	return record.status === "etf" && record.holdings.length > 0 ? "etf" : "stock";
};

const getOrCreateExposure = (map: Map<string, ExposureEntry>, symbol: string) => {
	let entry = map.get(symbol);

	if (!entry) {
		entry = {
			symbol,
			name: null,
			directShares: 0,
			directExposure: 0,
			viaExposure: 0,
			viaEtfs: []
		};
		map.set(symbol, entry);
	}

	return entry;
};

const totalExposure = (entry: ExposureEntry) => entry.directExposure + entry.viaExposure;

const addCash = (map: Map<string, number>, name: string, exposure: number) => {
	map.set(name, (map.get(name) ?? 0) + exposure);
};

const round = (value: number, decimals: number) => {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
};
