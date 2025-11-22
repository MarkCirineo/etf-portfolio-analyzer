import { Router, type Request, type Response, type NextFunction } from "express";
import db from "@db";
import { HttpError } from "@utils/error";
import logger from "@logger";
import { resolveOwnerId } from "./_shared";
import type { ListContent } from "@db/tables/List";
import { alphavantage } from "@api/alphavantage";

type NormalizedEtfHolding = {
	symbol: string;
	weight: number;
};

type AggregatedHolding = {
	symbol: string;
	totalShares: number;
	directShares: number;
	viaEtfs: string[];
};

type ListAnalysis = {
	holdings: AggregatedHolding[];
	failedTickers: string[];
	generatedAt: string;
	usedPlaceholders: string[];
};

type FetchHoldingsResult = {
	holdings: NormalizedEtfHolding[];
	failed: boolean;
	usedPlaceholder: boolean;
};

const PLACEHOLDER_HOLDINGS: Record<string, NormalizedEtfHolding[]> = {
	SPY: [
		{ symbol: "AAPL", weight: 7.0 },
		{ symbol: "MSFT", weight: 6.5 },
		{ symbol: "NVDA", weight: 5.5 },
		{ symbol: "AMZN", weight: 3.2 },
		{ symbol: "META", weight: 2.0 }
	],
	QQQ: [
		{ symbol: "AAPL", weight: 11.0 },
		{ symbol: "MSFT", weight: 9.5 },
		{ symbol: "NVDA", weight: 8.0 },
		{ symbol: "AMZN", weight: 5.0 },
		{ symbol: "META", weight: 4.5 }
	],
	VOO: [
		{ symbol: "AAPL", weight: 7.5 },
		{ symbol: "MSFT", weight: 6.7 },
		{ symbol: "AMZN", weight: 3.3 },
		{ symbol: "NVDA", weight: 3.0 },
		{ symbol: "GOOGL", weight: 1.8 }
	]
};

const router = Router();

router.get("/:publicId", async (req: Request, res: Response, next: NextFunction) => {
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
		{ symbol: string; totalShares: number; directShares: number; viaEtfs: Set<string> }
	>();
	const failedTickers: string[] = [];
	const placeholderTickers: string[] = [];

	const entries = Object.entries(content ?? {});

	await Promise.all(
		entries.map(async ([rawTicker, rawShares]) => {
			const ticker = rawTicker.trim().toUpperCase();
			const shares = Number(rawShares);

			if (!ticker || !Number.isFinite(shares) || shares <= 0) {
				return;
			}

			const { holdings, failed, usedPlaceholder } = await fetchEtfHoldings(ticker);

			if (failed) {
				failedTickers.push(ticker);
			}

			if (usedPlaceholder) {
				placeholderTickers.push(ticker);
			}

			if (holdings.length === 0) {
				const entry = getOrCreateAggregate(aggregated, ticker);
				entry.totalShares += shares;
				entry.directShares += shares;
				return;
			}

			for (const holding of holdings) {
				const effectiveShares = (shares * holding.weight) / 100;

				if (!Number.isFinite(effectiveShares) || effectiveShares <= 0) {
					continue;
				}

				const entry = getOrCreateAggregate(aggregated, holding.symbol);
				entry.totalShares += effectiveShares;
				entry.viaEtfs.add(ticker);
			}
		})
	);

	const holdings = Array.from(aggregated.values())
		.map((holding) => ({
			symbol: holding.symbol,
			totalShares: roundToFourDecimals(holding.totalShares),
			directShares: roundToFourDecimals(holding.directShares),
			viaEtfs: Array.from(holding.viaEtfs).sort()
		}))
		.sort((a, b) => b.totalShares - a.totalShares);

	return {
		holdings,
		failedTickers: Array.from(new Set(failedTickers)),
		usedPlaceholders: Array.from(new Set(placeholderTickers)),
		generatedAt: new Date().toISOString()
	};
};

const fetchEtfHoldings = async (symbol: string): Promise<FetchHoldingsResult> => {
	const path = `/query?function=ETF_HOLDINGS&symbol=${encodeURIComponent(symbol)}`;

	try {
		const response = await alphavantage(path);

		if (isRateLimitResponse(response)) {
			logger.warn(`[list] AlphaVantage rate limit hit while fetching ${symbol}`);
			return fallbackResult(symbol, true);
		}

		if (hasErrorMessage(response)) {
			logger.debug(`[list] AlphaVantage reported no holdings for ${symbol}`);
			return fallbackResult(symbol, false);
		}

		const holdings = parseHoldings(response);

		if (holdings.length === 0) {
			return fallbackResult(symbol, false);
		}

		return {
			holdings,
			failed: false,
			usedPlaceholder: false
		};
	} catch (error) {
		logger.warn(
			`[list] Failed to fetch ETF holdings for ${symbol}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		return fallbackResult(symbol, true);
	}
};

const fallbackResult = (symbol: string, failed: boolean): FetchHoldingsResult => {
	const placeholder = PLACEHOLDER_HOLDINGS[symbol];

	if (placeholder) {
		return {
			holdings: placeholder,
			failed: false,
			usedPlaceholder: true
		};
	}

	return {
		holdings: [],
		failed,
		usedPlaceholder: false
	};
};

const parseHoldings = (payload: unknown): NormalizedEtfHolding[] => {
	if (!isRecord(payload)) {
		return [];
	}

	const holdingsRaw = payload.holdings ?? payload.Holdings ?? payload["ETF Holdings"];

	if (!Array.isArray(holdingsRaw)) {
		return [];
	}

	const normalized: NormalizedEtfHolding[] = [];

	for (const item of holdingsRaw) {
		if (!isRecord(item)) {
			continue;
		}

		const symbol =
			typeof item.symbol === "string"
				? item.symbol.trim().toUpperCase()
				: typeof item.ticker === "string"
					? item.ticker.trim().toUpperCase()
					: "";
		const rawWeight =
			item.weight ??
			item.weight_percentage ??
			item.weightPercentage ??
			item.weightPercent ??
			item.percentage ??
			item.percent;
		const weight = typeof rawWeight === "number" ? rawWeight : parseFloat(String(rawWeight).replace("%", ""));

		if (!symbol || !Number.isFinite(weight) || weight <= 0) {
			continue;
		}

		normalized.push({
			symbol,
			weight
		});
	}

	return normalized;
};

const isRateLimitResponse = (payload: unknown): payload is Record<string, string> => {
	return (
		isRecord(payload) &&
		(typeof payload.Note === "string" || typeof payload.Information === "string")
	);
};

const hasErrorMessage = (payload: unknown): payload is Record<string, string> => {
	return isRecord(payload) && typeof payload["Error Message"] === "string";
};

const isRecord = (value: unknown): value is Record<string, any> => {
	return typeof value === "object" && value !== null;
};

const getOrCreateAggregate = (
	aggregated: Map<
		string,
		{ symbol: string; totalShares: number; directShares: number; viaEtfs: Set<string> }
	>,
	symbol: string
) => {
	const existing = aggregated.get(symbol);

	if (existing) {
		return existing;
	}

	const newEntry = {
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

export default router;
