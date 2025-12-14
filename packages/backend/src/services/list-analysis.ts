import logger from "@logger";
import type { ListContent } from "@db/tables/List";
import { etfScraper } from "@api/etf-scraper";
import { fetchQuotes } from "@utils/quotes";

export type NormalizedEtfHolding = {
	symbol: string;
	weight: number;
	name?: string;
};

export type AggregatedHolding = {
	symbol: string;
	totalShares: number;
	directShares: number;
	viaEtfs: string[];
	name?: string;
};

export type ListAnalysis = {
	holdings: AggregatedHolding[];
	failedTickers: string[];
	quoteFailures: string[];
	generatedAt: string;
};

export type FetchHoldingsResult = {
	holdings: NormalizedEtfHolding[];
	failed: boolean;
};

export type AggregatedEntry = {
	symbol: string;
	totalShares: number;
	directShares: number;
	viaEtfs: Set<string>;
	name?: string;
};

export type EtfDecompositionInput = {
	symbol: string;
	shares: number;
	holdings: NormalizedEtfHolding[];
};

export type DecompositionPlan = {
	aggregated: Map<string, AggregatedEntry>;
	etfInputs: EtfDecompositionInput[];
	failedTickers: Set<string>;
	symbolsNeedingQuotes: Set<string>;
};

export const analyzeList = async (
	content: ListContent,
	options?: { allowStale?: boolean }
): Promise<ListAnalysis> => {
	const plan = await collectDecompositionPlan(content);
	const quoteFailures = new Set<string>();

	if (plan.symbolsNeedingQuotes.size > 0) {
		const quotes = await fetchQuotes(Array.from(plan.symbolsNeedingQuotes), options);

		for (const etf of plan.etfInputs) {
			const etfPrice = quotes.get(etf.symbol);

			if (!isValidPrice(etfPrice)) {
				plan.failedTickers.add(etf.symbol);
				quoteFailures.add(etf.symbol);
				continue;
			}

			for (const holding of etf.holdings) {
				const holdingPrice = quotes.get(holding.symbol);

				if (!isValidPrice(holdingPrice)) {
					quoteFailures.add(holding.symbol);
					continue;
				}

				const capitalAllocation = etf.shares * etfPrice * (holding.weight / 100);
				const derivedShares = capitalAllocation / holdingPrice;

				if (!Number.isFinite(derivedShares) || derivedShares <= 0) {
					continue;
				}

				const entry = getOrCreateAggregate(plan.aggregated, holding.symbol);
				entry.totalShares += derivedShares;
				entry.viaEtfs.add(etf.symbol);
				if (holding.name && !entry.name) {
					entry.name = holding.name;
				}
			}
		}
	}

	return buildListAnalysis(plan.aggregated, {
		failedTickers: plan.failedTickers,
		quoteFailures
	});
};

export const buildListAnalysis = (
	aggregated: Map<string, AggregatedEntry>,
	metadata: {
		failedTickers: Set<string>;
		quoteFailures: Set<string>;
	}
): ListAnalysis => {
	return {
		holdings: serializeAggregatedHoldings(aggregated),
		failedTickers: Array.from(metadata.failedTickers),
		quoteFailures: Array.from(metadata.quoteFailures),
		generatedAt: new Date().toISOString()
	};
};

export const serializeAggregatedHoldings = (
	aggregated: Map<string, AggregatedEntry>
): AggregatedHolding[] => {
	return Array.from(aggregated.values())
		.map((holding) => ({
			symbol: holding.symbol,
			totalShares: roundToFourDecimals(holding.totalShares),
			directShares: roundToFourDecimals(holding.directShares),
			viaEtfs: Array.from(holding.viaEtfs).sort(),
			...(holding.name && { name: holding.name })
		}))
		.sort((a, b) => b.totalShares - a.totalShares);
};

export const collectDecompositionPlan = async (
	content: ListContent
): Promise<DecompositionPlan> => {
	const aggregated = new Map<string, AggregatedEntry>();
	const failedTickers = new Set<string>();
	const symbolsNeedingQuotes = new Set<string>();
	const etfInputs: EtfDecompositionInput[] = [];

	const entries = Object.entries(content ?? {});

	await Promise.all(
		entries.map(async ([rawTicker, rawShares]) => {
			const ticker = rawTicker.trim().toUpperCase();
			const shares = Number(rawShares);

			if (!ticker || !Number.isFinite(shares) || shares <= 0) {
				return;
			}

			const { holdings, failed } = (await fetchEtfHoldings(ticker)) ?? {};

			if (failed) {
				failedTickers.add(ticker);
			}

			// No holdings found, add shares as direct shares
			if (!holdings || holdings.length === 0) {
				const entry = getOrCreateAggregate(aggregated, ticker);
				entry.totalShares += shares;
				entry.directShares += shares;
				return;
			}

			etfInputs.push({
				symbol: ticker,
				shares,
				holdings
			});

			// Add ETFs to quote fetch AND their holdings
			symbolsNeedingQuotes.add(ticker);
			holdings.forEach((holding) => symbolsNeedingQuotes.add(holding.symbol));
		})
	);

	return {
		aggregated,
		etfInputs,
		failedTickers,
		symbolsNeedingQuotes
	};
};

export const fetchEtfHoldings = async (
	symbol: string
): Promise<FetchHoldingsResult | undefined> => {
	try {
		const response = await etfScraper(symbol);

		if (!isRecord(response)) {
			logger.warn(`[list] Invalid response from ETF scraper for ${symbol}`);
			return {
				holdings: [],
				failed: true
			};
		}

		const failed = response.failed === true;
		const normalizedHoldings = parseHoldings(response);

		return {
			holdings: normalizedHoldings,
			failed
		};
	} catch (error) {
		logger.warn(
			`[list] Failed to fetch ETF holdings for ${symbol}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		return {
			holdings: [],
			failed: true
		};
	}
};

export const parseHoldings = (payload: unknown): NormalizedEtfHolding[] => {
	if (!isRecord(payload)) {
		return [];
	}

	const holdingsRaw = payload.holdings;

	if (!Array.isArray(holdingsRaw)) {
		return [];
	}

	const normalized: NormalizedEtfHolding[] = [];

	for (const item of holdingsRaw) {
		if (!isRecord(item)) {
			continue;
		}

		const symbol = typeof item.symbol === "string" ? item.symbol.trim().toUpperCase() : "";
		const weight =
			typeof item.weight === "number"
				? item.weight
				: typeof item.weight === "string"
					? parseFloat(item.weight.replace("%", ""))
					: 0;
		const name = typeof item.name === "string" ? item.name.trim() : undefined;

		if (!symbol || !Number.isFinite(weight) || weight <= 0) {
			continue;
		}

		normalized.push({
			symbol,
			weight,
			...(name && { name })
		});
	}

	return normalized;
};

export const getOrCreateAggregate = (
	aggregated: Map<string, AggregatedEntry>,
	symbol: string
): AggregatedEntry => {
	const existing = aggregated.get(symbol);

	if (existing) {
		return existing;
	}

	const newEntry: AggregatedEntry = {
		symbol,
		totalShares: 0,
		directShares: 0,
		viaEtfs: new Set<string>()
	};

	aggregated.set(symbol, newEntry);

	return newEntry;
};

export const roundToFourDecimals = (value: number) => {
	return Math.round(value * 10000) / 10000;
};

export const isValidPrice = (price: number | undefined): price is number => {
	return typeof price === "number" && Number.isFinite(price) && price > 0;
};

const isRecord = (value: unknown): value is Record<string, any> => {
	return typeof value === "object" && value !== null;
};
