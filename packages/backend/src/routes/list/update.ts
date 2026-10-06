import { Router, type NextFunction, type Request, type Response } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { syncListContent, writeAccountHoldings } from "@services/accounts";
import { refreshListSubscriptions } from "@services/list-subscriptions";
import { resolveOwnerId, sanitizeHoldings, withAccounts } from "./_shared";

const router = Router();

type UpdateListPayload = {
	name?: string;
	/** Only for a list with a single account; otherwise edit each account. */
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

			if (name === undefined && holdings === undefined) {
				throw new HttpError("Request body must include a name or holdings", 400);
			}

			const sanitizedHoldings =
				holdings === undefined ? undefined : sanitizeHoldings(holdings);

			let resolvedName: string | undefined;

			if (typeof name === "string") {
				const trimmed = name.trim();
				resolvedName = trimmed.length > 0 ? trimmed : "Untitled List";
			}

			const updatedList = await db.transaction().execute(async (trx) => {
				const list = await trx
					.selectFrom("lists")
					.select("id")
					.where("ownerId", "=", ownerId)
					.where("publicId", "=", publicId)
					.executeTakeFirst();

				if (!list) {
					return undefined;
				}

				if (sanitizedHoldings) {
					const accounts = await trx
						.selectFrom("accounts")
						.select("id")
						.where("listId", "=", list.id)
						.execute();

					if (accounts.length !== 1) {
						throw new HttpError(
							"This list has several accounts; edit the holdings of each account instead",
							409
						);
					}

					await writeAccountHoldings(trx, accounts[0].id, sanitizedHoldings);
					await syncListContent(trx, list.id);
				}

				return await trx
					.updateTable("lists")
					.set({
						...(resolvedName ? { name: resolvedName } : {}),
						updatedAt: new Date()
					})
					.where("id", "=", list.id)
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

			if (!updatedList) {
				throw new HttpError("List not found", 404);
			}

			if (sanitizedHoldings) {
				refreshListSubscriptions(updatedList.id);
			}

			const [listWithAccounts] = await withAccounts([updatedList]);

			logger.info(
				`[list] User ${ownerId} updated list ${updatedList.id} (${Object.keys(updatedList.content).length} holdings)`
			);

			res.status(200).send({ data: listWithAccounts });
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
