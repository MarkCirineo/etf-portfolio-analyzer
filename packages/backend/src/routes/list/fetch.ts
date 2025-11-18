import { type Request, type Response, type NextFunction, Router } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { resolveOwnerId } from "./_shared";

const router = Router();

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const ownerId = resolveOwnerId(req);

		const lists = await db
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
			.orderBy("updatedAt", "desc")
			.execute();

		res.status(200).send({ data: lists });
	} catch (error) {
		if (error instanceof HttpError) {
			return next(error);
		}

		logger.error(
			`[list] Failed to fetch lists: ${error instanceof Error ? error.message : String(error)}`
		);
		next(new HttpError("Failed to fetch lists", 500));
	}
});

export default router;
