import { Router, type Request, type Response, type NextFunction } from "express";
import db from "@db";
import { HttpError } from "@utils/error";
import logger from "@logger";
import { analyzeList } from "@services/list-analysis";
import { resolveOwnerId } from "./_shared";

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

		// Analyze list with cached data, allowing stale data for immediate results
		// Missing quotes will be queued and fetched via quote-queue
		// Updates will be broadcast via quote-cache pub/sub → Socket.IO
		const analysis = await analyzeList(list.content, { allowStale: true });

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

export default router;
