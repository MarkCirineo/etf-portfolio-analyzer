import { Router, type NextFunction, type Request, type Response } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { analyzeList } from "@services/list-analysis";
import { resolveOwnerId } from "@routes/list/_shared";

const router = Router();

/**
 * The user's main portfolio with its analysis. `list` is null when they have not created
 * one yet (or have lists but none marked as main), so the page can prompt for it.
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const ownerId = resolveOwnerId(req);

		const list = await db
			.selectFrom("lists")
			.select((eb) => [
				eb.ref("publicId").as("id"),
				"name",
				"content",
				"ownerId",
				"isPrimary",
				"createdAt",
				"updatedAt"
			])
			.where("ownerId", "=", ownerId)
			.where("isPrimary", "=", true)
			.executeTakeFirst();

		if (!list) {
			res.status(200).send({ data: { list: null, analysis: null } });
			return;
		}

		const { analysis } = await analyzeList(list.content);

		res.status(200).send({ data: { list, analysis } });
	} catch (error) {
		if (error instanceof HttpError) {
			return next(error);
		}

		logger.error(
			`[portfolio] Failed to load main portfolio: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		next(new HttpError("Failed to load portfolio", 500));
	}
});

export default router;
