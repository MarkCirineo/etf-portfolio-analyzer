import { Router, type Request, type Response, type NextFunction } from "express";
import db from "@db";
import { HttpError } from "@utils/error";
import logger from "@logger";
import type { ListContent } from "@db/tables/List";
import { etfScraper } from "@api/etf-scraper";
import { fetchQuotes } from "@utils/quotes";
import { resolveOwnerId } from "./_shared";

type NormalizedEtfHolding = {
	symbol: string;
	weight: number;
	name?: string;
};

type AggregatedHolding = {
	symbol: string;
	totalShares: number;
	directShares: number;
	viaEtfs: string[];
	name?: string;
};

type ListAnalysis = {
	holdings: AggregatedHolding[];
	failedTickers: string[];
	generatedAt: string;
	usedPlaceholders: string[];
	quoteFailures: string[];
};

type FetchHoldingsResult = {
	holdings: NormalizedEtfHolding[];
	failed: boolean;
	usedPlaceholder: boolean;
};

type EtfDecompositionInput = {
	symbol: string;
	shares: number;
	holdings: NormalizedEtfHolding[];
};

const router = Router();

router.get("/:publicId/analysis", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const ownerId = resolveOwnerId(req);
		const publicId = req.params.publicId?.trim();

		if (!publicId) {
			throw new HttpError("List id is required", 400);
		}

		const list = await db
			.selectFrom("lists")
			.select((eb) => [
				eb.ref("publicId").as("id"),
				"name",
				"content",
				"ownerId",
				"createdAt",
				"updatedAt"
			])
			.where("ownerId", "=", ownerId)
			.where("publicId", "=", publicId)
			.executeTakeFirst();

		if (!list) {
			throw new HttpError("List not found", 404);
		}

		const analysis = await analyzeList(list.content);

		res.status(200).send({
			data: {
				list,
				analysis
			}
		});
	} catch (error) {
		if (error instanceof HttpError) {
			return next(error);
		}

		logger.error(
			`[list] Failed to fetch list detail: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		next(new HttpError("Failed to fetch list detail", 500));
	}
});

const analyzeList = async (content: ListContent): Promise<ListAnalysis> => {
	const aggregated = new Map<
		string,
		{
			symbol: string;
			totalShares: number;
			directShares: number;
			viaEtfs: Set<string>;
			name?: string;
		}
	>();
	const failedTickers = new Set<string>();
	const placeholderTickers = new Set<string>();
	const quoteFailures = new Set<string>();
	const etfInputs: EtfDecompositionInput[] = [];
	const symbolsNeedingQuotes = new Set<string>();

	const entries = Object.entries(content ?? {});

	await Promise.all(
		entries.map(async ([rawTicker, rawShares]) => {
			const ticker = rawTicker.trim().toUpperCase();
			const shares = Number(rawShares);

			if (!ticker || !Number.isFinite(shares) || shares <= 0) {
				return;
			}

			const { holdings, failed, usedPlaceholder } = (await fetchEtfHoldings(ticker)) ?? {};

			if (failed) {
				failedTickers.add(ticker);
			}

			if (usedPlaceholder) {
				placeholderTickers.add(ticker);
			}

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

			symbolsNeedingQuotes.add(ticker);
			holdings.forEach((holding) => symbolsNeedingQuotes.add(holding.symbol));
		})
	);

	if (symbolsNeedingQuotes.size > 0) {
		const quotes = await fetchQuotes(Array.from(symbolsNeedingQuotes));

		for (const etf of etfInputs) {
			const etfPrice = quotes.get(etf.symbol);

			if (!isValidPrice(etfPrice)) {
				failedTickers.add(etf.symbol);
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

				const entry = getOrCreateAggregate(aggregated, holding.symbol);
				entry.totalShares += derivedShares;
				entry.viaEtfs.add(etf.symbol);
				// Preserve name if available (use first one we encounter)
				if (holding.name && !entry.name) {
					entry.name = holding.name;
				}
			}
		}
	}

	const holdings = Array.from(aggregated.values())
		.map((holding) => ({
			symbol: holding.symbol,
			totalShares: roundToFourDecimals(holding.totalShares),
			directShares: roundToFourDecimals(holding.directShares),
			viaEtfs: Array.from(holding.viaEtfs).sort(),
			...(holding.name && { name: holding.name }) // Include name if available
		}))
		.sort((a, b) => b.totalShares - a.totalShares);

	return {
		holdings,
		failedTickers: Array.from(failedTickers),
		usedPlaceholders: Array.from(placeholderTickers),
		quoteFailures: Array.from(quoteFailures),
		generatedAt: new Date().toISOString()
	};
};

const fetchEtfHoldings = async (symbol: string): Promise<FetchHoldingsResult | undefined> => {
	try {
		const response = await etfScraper(symbol);

		// The Python service returns { holdings: [...], failed: boolean }
		// Holdings are already normalized to { symbol, weight } format
		if (!isRecord(response)) {
			logger.warn(`[list] Invalid response from ETF scraper for ${symbol}`);
			return {
				holdings: [],
				failed: true,
				usedPlaceholder: false
			};
		}

		const failed = response.failed === true;

		// Normalize holdings to ensure correct format
		const normalizedHoldings = parseHoldings(response);

		return {
			holdings: normalizedHoldings,
			failed,
			usedPlaceholder: false
		};
	} catch (error) {
		logger.warn(
			`[list] Failed to fetch ETF holdings for ${symbol}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		return {
			holdings: [],
			failed: true,
			usedPlaceholder: false
		};
	}
};

const parseHoldings = (payload: unknown): NormalizedEtfHolding[] => {
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
			...(name && { name }) // Include name if available
		});
	}

	return normalized;
};

const isRecord = (value: unknown): value is Record<string, any> => {
	return typeof value === "object" && value !== null;
};

const getOrCreateAggregate = (
	aggregated: Map<
		string,
		{
			symbol: string;
			totalShares: number;
			directShares: number;
			viaEtfs: Set<string>;
			name?: string;
		}
	>,
	symbol: string
): {
	symbol: string;
	totalShares: number;
	directShares: number;
	viaEtfs: Set<string>;
	name?: string;
} => {
	const existing = aggregated.get(symbol);

	if (existing) {
		return existing;
	}

	const newEntry: {
		symbol: string;
		totalShares: number;
		directShares: number;
		viaEtfs: Set<string>;
		name?: string;
	} = {
		symbol,
		totalShares: 0,
		directShares: 0,
		viaEtfs: new Set<string>()
	};

	aggregated.set(symbol, newEntry);

	return newEntry;
};

const roundToFourDecimals = (value: number) => {
	return Math.round(value * 10000) / 10000;
};

const isValidPrice = (price: number | undefined): price is number => {
	return typeof price === "number" && Number.isFinite(price) && price > 0;
};

export default router;
