import type { ListContent } from "@db/tables/List";
import { getEtfHoldings, type EtfHoldingsRecord } from "@services/etf-holdings";
import { getFundProfile, type FundProfile } from "@services/fund-profile";
import { buildPortfolioBreakdown, type PortfolioBreakdown } from "@services/portfolio-breakdown";
import { getUsListings, isUsListing } from "@services/us-listings";
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
	previousClose: number | null;
	/** Dollar change since the previous close for this position. */
	dayChange: number | null;
	percentOfPortfolio: number | null;
	holdingsCount: number | null;
	holdingsAsOf: string | null;
	leveraged: boolean;
	/**
	 * Percent of this ETF's weight the holdings provider actually accounted for. Well under
	 * 100 means the provider omitted positions (it only reports US-listed tickers, so
	 * international funds come back badly incomplete) and this fund's look-through is
	 * partial. Null for anything that is not an ETF.
	 */
	weightCovered: number | null;
	/** Percent per year; null for stocks and when the fund profile is unavailable. */
	expenseRatio: number | null;
	distributionYield: number | null;
};

export type EtfContribution = {
	etf: string;
	/** Percent of the ETF this holding represents. */
	weight: number;
	exposure: number;
};

/** One security the user is exposed to, directly and/or through ETFs. */
export type AnalyzedHolding = {
	/** Unique per security. Tickers are not: MRK is Merck & Co. and Merck KGaA. */
	id: string;
	symbol: string;
	name: string | null;
	/** Whether it can be priced as a US listing; when false, there is no share count. */
	usListed: boolean;
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
	/**
	 * Change since the previous close across the inputs that have one. `complete` is false
	 * when some input has no previous close yet, so the figure is partial.
	 */
	dayChange: { amount: number; percent: number | null; complete: boolean };
	inputs: ListInput[];
	holdings: AnalyzedHolding[];
	/** Holdings beyond MAX_RETURNED_HOLDINGS. */
	tail: ExposureBucket & { count: number };
	/** Cash, treasuries, swaps and other identified positions that are not listed equities. */
	cashAndOther: ExposureBucket & { items: { name: string; exposure: number }[] };
	/**
	 * Portfolio value the holdings data could not account for at all. This is missing
	 * information, not a position: it is what the provider did not report for each ETF.
	 */
	unaccounted: ExposureBucket & {
		byInput: { symbol: string; exposure: number; weightMissing: number }[];
	};
	/** Inputs whose holdings lookup failed; treated as directly held stock for now. */
	failedTickers: string[];
	/** Sectors, geography, fees, income, valuation, fund overlap and backtest. */
	breakdown: PortfolioBreakdown;
	quotes: {
		requested: number;
		priced: number;
		/** Priced, but past the refresh window; a refresh is queued. */
		stale: number;
		pending: number;
		unavailable: number;
	};
	pendingQuotes: string[];
	quoteFailures: string[];
};

export type ListAnalysisResult = {
	analysis: ListAnalysis;
	/** Every symbol whose price feeds this analysis; a quote update for one warrants a re-run. */
	trackedSymbols: Set<string>;
};

type ExposureEntry = {
	key: string;
	symbol: string;
	name: string | null;
	/** Some fund reports it under a US-shaped ticker. */
	usStyleTicker: boolean;
	/** Held by a fund that is almost entirely North American. */
	inUsFund: boolean;
	/** Can be priced as a US listing; decided once every input is spread. */
	usListed: boolean;
	directShares: number;
	directExposure: number;
	viaExposure: number;
	viaEtfs: EtfContribution[];
};

export const analyzeList = async (content: ListContent): Promise<ListAnalysisResult> => {
	const entries = parseContent(content);
	const [records, profileList, listings] = await Promise.all([
		Promise.all(entries.map((entry) => getEtfHoldings(entry.symbol))),
		Promise.all(entries.map((entry) => getFundProfile(entry.symbol))),
		getUsListings()
	]);
	const profiles = new Map(entries.map((entry, index) => [entry.symbol, profileList[index]]));

	// 1. Price the list's own symbols. Everything downstream hangs off these.
	const inputSymbols = entries.map((entry) => entry.symbol);
	const inputPriorities = new Map(inputSymbols.map((symbol) => [symbol, INPUT_PRIORITY]));
	const inputQuotes = await getQuoteSnapshots(inputSymbols, inputPriorities);

	// 2. Spread each input's market value over what it holds.
	const exposures = new Map<string, ExposureEntry>();
	const cashItems = new Map<string, number>();
	const unaccountedByInput: { symbol: string; exposure: number; weightMissing: number }[] = [];
	const inputs: ListInput[] = [];
	const failedTickers: string[] = [];
	const directHoldings: { symbol: string; shares: number; value: number | null }[] = [];
	let totalValue = 0;
	let totalValueComplete = true;
	let dayChangeTotal = 0;
	let previousValue = 0;
	let dayChangeComplete = true;

	entries.forEach((entry, index) => {
		const record = records[index];
		const quote = inputQuotes.get(entry.symbol);
		const kind = classifyInput(record);
		const price = quote?.price ?? null;
		const value = price !== null ? entry.shares * price : null;
		const previousClose = quote?.previousClose ?? null;
		const dayChange =
			price !== null && previousClose !== null
				? entry.shares * (price - previousClose)
				: null;

		if (dayChange === null || previousClose === null) {
			dayChangeComplete = false;
		} else {
			dayChangeTotal += dayChange;
			previousValue += entry.shares * previousClose;
		}

		if (kind === "unknown") {
			failedTickers.push(entry.symbol);
		}

		if (value === null) {
			totalValueComplete = false;
		} else {
			totalValue += value;
		}

		const inputRow: ListInput = {
			symbol: entry.symbol,
			shares: entry.shares,
			kind,
			price,
			priceStatus: quote?.status ?? "pending",
			value,
			previousClose,
			dayChange: dayChange === null ? null : round(dayChange, 2),
			percentOfPortfolio: null,
			holdingsCount: kind === "etf" ? record.holdings.length : null,
			holdingsAsOf: kind === "etf" ? record.asOf : null,
			leveraged: kind === "etf" && record.leveraged,
			weightCovered: null,
			expenseRatio:
				kind === "etf" ? (profiles.get(entry.symbol)?.expenseRatio ?? null) : null,
			distributionYield:
				kind === "etf" ? (profiles.get(entry.symbol)?.distributionYield ?? null) : null
		};

		inputs.push(inputRow);

		if (kind !== "etf") {
			// Directly held (or unresolvable, treated the same until it resolves). Attached
			// after every fund is spread, so it can join the right listing of its ticker.
			directHoldings.push({ symbol: entry.symbol, shares: entry.shares, value });
			return;
		}

		if (value === null) {
			// Nothing to spread until the ETF itself has a price
			return;
		}

		let reportedWeight = 0;
		const usFund = isUsFund(profiles.get(entry.symbol));

		for (const holding of record.holdings) {
			const exposure = (value * holding.weight) / 100;
			const aggregate = getOrCreateExposure(exposures, holding.key, holding.symbol);
			aggregate.usStyleTicker = aggregate.usStyleTicker || holding.usStyleTicker;
			aggregate.inUsFund = aggregate.inUsFund || usFund;
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

		inputRow.weightCovered = round(reportedWeight, 4);

		// Whatever the provider did not report is unknown, not cash. Small gaps are just
		// rounding and positions too small to carry a weight; large ones mean the data is
		// incomplete for this fund.
		const missingWeight = 100 - reportedWeight;

		if (missingWeight > 0.005) {
			unaccountedByInput.push({
				symbol: entry.symbol,
				exposure: (value * missingWeight) / 100,
				weightMissing: round(missingWeight, 4)
			});
		}
	});

	for (const direct of directHoldings) {
		const aggregate = findListing(exposures, direct.symbol, listings);
		aggregate.directShares += direct.shares;
		aggregate.directExposure += direct.value ?? 0;
	}

	for (const aggregate of exposures.values()) {
		aggregate.usListed = canPriceAsUsListing(aggregate, listings);
	}

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

		if (!aggregate.usListed) {
			// The quote provider cannot resolve a foreign exchange ticker; asking would
			// only burn the rate limit. Exposure and percent still work without a price.
			continue;
		}

		const exposure = totalExposure(aggregate);

		if (exposure <= 0) {
			break;
		}

		const priority = totalValue > 0 ? (exposure / totalValue) * 100 : 0;
		// Two securities can share a priceable ticker (Rio Tinto plc and Limited)
		holdingPriorities.set(
			aggregate.symbol,
			Math.max(priority, holdingPriorities.get(aggregate.symbol) ?? 0)
		);
	}

	const holdingSymbols = Array.from(
		new Set(
			ranked
				.filter((aggregate) => aggregate.usListed && !inputPriorities.has(aggregate.symbol))
				.map((aggregate) => aggregate.symbol)
		)
	);
	const holdingQuotes = await getQuoteSnapshots(holdingSymbols, holdingPriorities);
	const quoteFor = (symbol: string): QuoteSnapshot | undefined =>
		inputQuotes.get(symbol) ?? holdingQuotes.get(symbol);

	// 4. Assemble the rows.
	const rows: AnalyzedHolding[] = ranked.map((aggregate) => {
		// Never lend a ticker's US price to a different company that shares it
		const quote = aggregate.usListed ? quoteFor(aggregate.symbol) : undefined;
		const price = quote?.price ?? null;
		const exposure = totalExposure(aggregate);
		const derivedShares =
			aggregate.viaEtfs.length === 0
				? 0
				: price !== null
					? aggregate.viaExposure / price
					: null;

		return {
			id: aggregate.key,
			symbol: aggregate.symbol,
			name: aggregate.name,
			usListed: aggregate.usListed,
			exposure: round(exposure, 2),
			percentOfPortfolio: totalValue > 0 ? round((exposure / totalValue) * 100, 4) : 0,
			directShares: round(aggregate.directShares, 4),
			derivedShares: derivedShares === null ? null : round(derivedShares, 4),
			totalShares:
				derivedShares === null ? null : round(aggregate.directShares + derivedShares, 4),
			price,
			priceStatus: aggregate.usListed
				? (quote?.status ?? "not-requested")
				: aggregate.usStyleTicker
					? "unconfirmed-listing"
					: "foreign-listing",
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
	const unaccountedExposure = unaccountedByInput.reduce((sum, item) => sum + item.exposure, 0);

	// 5. Quote bookkeeping for the UI.
	const requestedSymbols = [...inputPriorities.keys(), ...holdingPriorities.keys()];
	const pendingQuotes: string[] = [];
	const quoteFailures: string[] = [];
	let priced = 0;
	let stale = 0;

	for (const symbol of requestedSymbols) {
		const status = quoteFor(symbol)?.status;

		if (status === "fresh" || status === "stale") {
			priced += 1;
			if (status === "stale") {
				stale += 1;
			}
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
		dayChange: {
			amount: round(dayChangeTotal, 2),
			percent: previousValue > 0 ? round((dayChangeTotal / previousValue) * 100, 4) : null,
			complete: dayChangeComplete
		},
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
		unaccounted: {
			exposure: round(unaccountedExposure, 2),
			percentOfPortfolio:
				totalValue > 0 ? round((unaccountedExposure / totalValue) * 100, 4) : 0,
			byInput: unaccountedByInput
				.sort((a, b) => b.exposure - a.exposure)
				.map((item) => ({ ...item, exposure: round(item.exposure, 2) }))
		},
		failedTickers,
		breakdown: buildPortfolioBreakdown(
			inputs.map((input) => ({ symbol: input.symbol, kind: input.kind, value: input.value })),
			profiles,
			new Map(entries.map((entry, index) => [entry.symbol, records[index]])),
			totalValue
		),
		quotes: {
			requested: requestedSymbols.length,
			priced,
			stale,
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

/** North American share at or above which a fund's holdings are taken to be US listings. */
const US_FUND_THRESHOLD = 95;

const isUsFund = (profile: FundProfile | undefined) => {
	const northAmerica = profile?.regions.find((region) => region.name === "North America");
	return (northAmerica?.weight ?? 0) >= US_FUND_THRESHOLD;
};

/**
 * Whether a security can be priced under its ticker. Directly held stocks always can.
 * Otherwise the name must match the company the SEC registers under that ticker, or the
 * security must be held by a US fund — which catches renames the SEC list lags on (GE
 * Aerospace is still "GENERAL ELECTRIC CO"), while a foreign company sharing a US ticker
 * (Merck KGaA's MRK) only ever turns up in international funds.
 */
const canPriceAsUsListing = (
	aggregate: ExposureEntry,
	listings: Map<string, string> | null
): boolean => {
	if (aggregate.directShares > 0) {
		return true;
	}

	if (!aggregate.usStyleTicker) {
		return false;
	}

	if (!listings) {
		// Without the SEC list, fall back to the ticker's shape
		return true;
	}

	return isUsListing(listings, aggregate.symbol, aggregate.name) || aggregate.inUsFund;
};

/**
 * The security a directly held ticker refers to: the fund-held one the SEC confirms as
 * that ticker's US listing, else the only one there is, else a row of its own.
 */
const findListing = (
	map: Map<string, ExposureEntry>,
	symbol: string,
	listings: Map<string, string> | null
): ExposureEntry => {
	const candidates = Array.from(map.values()).filter((entry) => entry.symbol === symbol);
	const confirmed = listings
		? candidates.find((entry) => isUsListing(listings, symbol, entry.name))
		: undefined;

	if (confirmed) {
		return confirmed;
	}

	if (candidates.length === 1) {
		return candidates[0];
	}

	return getOrCreateExposure(map, `${symbol}|direct`, symbol);
};

const getOrCreateExposure = (map: Map<string, ExposureEntry>, key: string, symbol: string) => {
	let entry = map.get(key);

	if (!entry) {
		entry = {
			key,
			symbol,
			name: null,
			usStyleTicker: false,
			inUsFund: false,
			usListed: false,
			directShares: 0,
			directExposure: 0,
			viaExposure: 0,
			viaEtfs: []
		};
		map.set(key, entry);
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
