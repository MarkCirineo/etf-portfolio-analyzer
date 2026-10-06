import { type Request, type Response, type NextFunction, Router } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { resolveOwnerId, withAccounts } from "./_shared";

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
				"isPrimary",
				"createdAt",
				"updatedAt"
			])
			.where("ownerId", "=", ownerId)
			.orderBy("updatedAt", "desc")
			.execute();

		res.status(200).send({ data: await withAccounts(lists) });
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
				"isPrimary",
				"createdAt",
				"updatedAt"
			])
			.where("ownerId", "=", ownerId)
			.where("publicId", "=", publicId)
			.executeTakeFirst();

		if (!list) {
			throw new HttpError("List not found", 404);
		}

		const [listWithAccounts] = await withAccounts([list]);

		res.status(200).send({ data: listWithAccounts });
	} catch (error) {
		if (error instanceof HttpError) {
			return next(error);
		}

		logger.error(
			`[list] Failed to fetch list: ${error instanceof Error ? error.message : String(error)}`
		);
		next(new HttpError("Failed to fetch list", 500));
	}
});

export default router;
