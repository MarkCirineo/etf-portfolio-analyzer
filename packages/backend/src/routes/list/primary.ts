import { Router, type NextFunction, type Request, type Response } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { resolveOwnerId, withAccounts } from "./_shared";

const router = Router();

/** Make a list the user's main portfolio; their previous one becomes a scenario. */
router.post(
	"/:publicId/primary",
	async (req: Request<{ publicId?: string }>, res: Response, next: NextFunction) => {
		try {
			const ownerId = resolveOwnerId(req);
			const publicId = req.params.publicId?.trim();

			if (!publicId) {
				throw new HttpError("List id is required", 400);
			}

			const list = await db.transaction().execute(async (trx) => {
				const target = await trx
					.selectFrom("lists")
					.select("id")
					.where("ownerId", "=", ownerId)
					.where("publicId", "=", publicId)
					.executeTakeFirst();

				if (!target) {
					return undefined;
				}

				// Clear the current one first: the unique index allows at most one per user
				await trx
					.updateTable("lists")
					.set({ isPrimary: false })
					.where("ownerId", "=", ownerId)
					.where("isPrimary", "=", true)
					.execute();

				return await trx
					.updateTable("lists")
					.set({ isPrimary: true })
					.where("id", "=", target.id)
					.returning((eb) => [
						eb.ref("publicId").as("id"),
						"name",
						"content",
						"ownerId",
						"isPrimary",
						"createdAt",
						"updatedAt"
					])
					.executeTakeFirst();
			});

			if (!list) {
				throw new HttpError("List not found", 404);
			}

			logger.info(`[list] User ${ownerId} made list ${list.id} their main portfolio`);

			const [listWithAccounts] = await withAccounts([list]);

			res.status(200).send({ data: listWithAccounts });
		} catch (error) {
			if (error instanceof HttpError) {
				return next(error);
			}

			logger.error(
				`[list] Failed to set main portfolio: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			next(new HttpError("Failed to set main portfolio", 500));
		}
	}
);

export default router;
