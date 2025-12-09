import { Router, type NextFunction, type Request, type Response } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { resolveOwnerId, sanitizeHoldings } from "./_shared";

const router = Router();

type UpdateListPayload = {
	name?: string;
	holdings?: Record<string, number | string>;
};

router.patch(
	"/:publicId",
	async (
		req: Request<{ publicId?: string }, {}, UpdateListPayload>,
		res: Response,
		next: NextFunction
	) => {
		try {
			const ownerId = resolveOwnerId(req);
			const publicId = req.params.publicId?.trim();
			const { name, holdings } = req.body ?? {};

			if (!publicId) {
				throw new HttpError("List id is required", 400);
			}

			if (!holdings) {
				throw new HttpError("Request body must include holdings", 400);
			}

			const sanitizedHoldings = sanitizeHoldings(holdings);

			let resolvedName: string | undefined;

			if (typeof name === "string") {
				const trimmed = name.trim();
				resolvedName = trimmed.length > 0 ? trimmed : "Untitled List";
			}

			const updatedList = await db
				.updateTable("lists")
				.set({
					content: sanitizedHoldings,
					...(resolvedName ? { name: resolvedName } : {}),
					updatedAt: new Date()
				})
				.where("ownerId", "=", ownerId)
				.where("publicId", "=", publicId)
				.returning((eb) => [
					eb.ref("publicId").as("id"),
					"name",
					"content",
					"ownerId",
					"createdAt",
					"updatedAt"
				])
				.executeTakeFirst();

			if (!updatedList) {
				throw new HttpError("List not found", 404);
			}

			logger.info(
				`[list] User ${ownerId} updated list ${updatedList.id} with ${Object.keys(sanitizedHoldings).length} holdings`
			);

			res.status(200).send({ data: updatedList });
		} catch (error) {
			if (error instanceof HttpError) {
				return next(error);
			}

			logger.error(
				`[list] Failed to update list: ${error instanceof Error ? error.message : String(error)}`
			);
			next(new HttpError("Failed to update list", 500));
		}
	}
);

export default router;
