import { type Request, Router } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { verifyToken } from "@routes/auth/_shared";
import type { ListContent } from "@db/tables/List";

type ListPayload = {
	name?: string;
	holdings: Record<string, number | string>;
};

const router = Router();

const resolveOwnerId = (req: Request): number => {
	const token = req.cookies?.token;

	if (!token) {
		throw new HttpError("Not authenticated", 401, true);
	}

	const decoded = verifyToken(token);

	return decoded.userId;
};

const sanitizeHoldings = (holdings: Record<string, number | string>): ListContent => {
	if (!holdings || typeof holdings !== "object" || Array.isArray(holdings)) {
		throw new HttpError("Holdings must be an object of ticker symbols to share counts", 400);
	}

	const sanitized: ListContent = {};

	for (const [rawTicker, rawShares] of Object.entries(holdings)) {
		const ticker = rawTicker.trim().toUpperCase();

		if (!ticker) {
			continue;
		}

		const shares =
			typeof rawShares === "number" ? rawShares : Number((rawShares ?? "").toString());

		if (!Number.isFinite(shares) || shares < 0) {
			throw new HttpError("Shares must be a non-negative number", 400);
		}

		sanitized[ticker] = shares;
	}

	if (Object.keys(sanitized).length === 0) {
		throw new HttpError("Provide at least one holding to save a list", 400);
	}

	return sanitized;
};

router.get("/", async (req, res, next) => {
	try {
		const ownerId = resolveOwnerId(req);

		const lists = await db
			.selectFrom("lists")
			.select(["id", "name", "content", "ownerId", "createdAt", "updatedAt"])
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

router.post("/", async (req: Request<{}, {}, ListPayload>, res, next) => {
	try {
		const ownerId = resolveOwnerId(req);
		const { name, holdings } = req.body;

		if (!holdings) {
			throw new HttpError("Request body must include holdings", 400);
		}

		const sanitizedHoldings = sanitizeHoldings(holdings);
		const trimmedName = typeof name === "string" ? name.trim() : "";
		const listName = trimmedName.length > 0 ? trimmedName : "Untitled List";

		const insertedList = await db
			.insertInto("lists")
			.values({
				name: listName,
				content: sanitizedHoldings,
				ownerId
			})
			.returning(["id", "name", "content", "ownerId", "createdAt", "updatedAt"])
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
