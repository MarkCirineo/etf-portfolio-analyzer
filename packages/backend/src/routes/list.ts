import { Request, Router } from "express";
import logger from "@logger";
import { HttpError } from "@utils/error";

type ListPayload = {
	tickers: string[];
};

type ListState = {
	tickers: string[];
	updatedAt: string | null;
};

const router = Router();

let listState: ListState = {
	tickers: [],
	updatedAt: null
};

const sanitizeTickers = (tickers: string[]): string[] => {
	const uniqueTickers = new Set<string>();

	for (const rawTicker of tickers) {
		if (typeof rawTicker !== "string") {
			throw new HttpError("All tickers must be strings", 400);
		}

		const ticker = rawTicker.trim().toUpperCase();

		if (!ticker) {
			continue;
		}

		uniqueTickers.add(ticker);
	}

	return Array.from(uniqueTickers);
};

router.get("/", (_req, res) => {
	res.status(200).send({ data: listState });
});

router.post("/", (req: Request<{}, {}, ListPayload>, res, next) => {
	try {
		const { tickers } = req.body;

		if (!tickers || !Array.isArray(tickers)) {
			throw new HttpError("Request body must include an array of tickers", 400);
		}

		const sanitizedTickers = sanitizeTickers(tickers);

		listState = {
			tickers: sanitizedTickers,
			updatedAt: new Date().toISOString()
		};

		logger.info(
			`List updated with ${listState.tickers.length} tickers: ${listState.tickers.join(", ")}`
		);

		res.status(200).send({ data: listState });
	} catch (error) {
		if (error instanceof HttpError) {
			return next(error);
		}

		next(new HttpError("Failed to save list", 500));
	}
});

export default router;
