import { type Request, type Response, type NextFunction, Router } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { generatePublicId } from "@utils/id";
import { resolveOwnerId, sanitizeHoldings } from "./_shared";

type ListPayload = {
	name?: string;
	holdings: Record<string, number | string>;
};

const router = Router();

router.post("/", async (req: Request<{}, {}, ListPayload>, res: Response, next: NextFunction) => {
	try {
		const ownerId = resolveOwnerId(req);
		const { name, holdings } = req.body;

		if (!holdings) {
			throw new HttpError("Request body must include holdings", 400);
		}

		const sanitizedHoldings = sanitizeHoldings(holdings);
		const trimmedName = typeof name === "string" ? name.trim() : "";
		const listName = trimmedName.length > 0 ? trimmedName : "Untitled List";
		const publicId = generatePublicId();

		const insertedList = await db
			.insertInto("lists")
			.values({
				publicId,
				name: listName,
				content: sanitizedHoldings,
				ownerId
			})
			.returning((eb) => [
				eb.ref("publicId").as("id"),
				"name",
				"content",
				"ownerId",
				"createdAt",
				"updatedAt"
			])
			.executeTakeFirst();

		if (!insertedList) {
			throw new HttpError("Unable to save list", 500);
		}

		logger.info(
			`[list] User ${ownerId} saved list ${insertedList.id} with ${
				Object.keys(sanitizedHoldings).length
			} holdings`
		);

		res.status(201).send({ data: insertedList });
	} catch (error) {
		if (error instanceof HttpError) {
			return next(error);
		}

		logger.error(
			`[list] Failed to save list: ${error instanceof Error ? error.message : String(error)}`
		);
		next(new HttpError("Failed to save list", 500));
	}
});

export default router;
