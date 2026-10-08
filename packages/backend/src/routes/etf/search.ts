import { Router, type NextFunction, type Request, type Response } from "express";
import logger from "@logger";
import { resolveOwnerId } from "@routes/list/_shared";
import { searchListings } from "@services/symbol-directory";
import { HttpError } from "@utils/error";

const router = Router();

const MAX_QUERY_LENGTH = 50;

/**
 * Ticker search for the add-a-holding field, by ticker or company name. Runs against
 * Nasdaq's daily list of US listings held in memory, so it is instant and free.
 */
router.get(
	"/",
	async (req: Request<{}, {}, {}, { q?: string }>, res: Response, next: NextFunction) => {
		try {
			resolveOwnerId(req);

			const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

			if (!query) {
				throw new HttpError("Query parameter 'q' is required", 400);
			}

			if (query.length > MAX_QUERY_LENGTH) {
				throw new HttpError("Search is too long", 400);
			}

			const listings = await searchListings(query);

			if (!listings) {
				throw new HttpError("Search isn't available right now", 503, true);
			}

			const result = listings.map((listing) => ({
				symbol: listing.symbol,
				description: listing.name,
				type: listing.etf ? "ETF" : "Stock"
			}));

			res.status(200).send({ data: { count: result.length, result } });
		} catch (error) {
			if (error instanceof HttpError) {
				return next(error);
			}

			logger.error(
				`[search] Failed to search: ${error instanceof Error ? error.message : String(error)}`
			);
			next(new HttpError("Search failed", 500));
		}
	}
);

export default router;
