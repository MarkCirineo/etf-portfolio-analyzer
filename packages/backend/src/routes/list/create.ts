import { type Request, type Response, type NextFunction, Router } from "express";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { generatePublicId } from "@utils/id";
import { syncListContent, writeAccountHoldings } from "@services/accounts";
import {
	resolveOwnerId,
	sanitizeAccount,
	sanitizeHoldings,
	withAccounts,
	type AccountFields,
	type AccountPayload
} from "./_shared";

type ListPayload = {
	name?: string;
	/** Shorthand for a list with a single account. */
	holdings?: Record<string, number | string>;
	accounts?: AccountPayload[];
};

const router = Router();

router.post("/", async (req: Request<{}, {}, ListPayload>, res: Response, next: NextFunction) => {
	try {
		const ownerId = resolveOwnerId(req);
		const { name, holdings, accounts } = req.body ?? {};

		let accountFields: AccountFields[];

		if (Array.isArray(accounts) && accounts.length > 0) {
			accountFields = accounts.map((account) => sanitizeAccount(account));
		} else if (holdings) {
			accountFields = [sanitizeAccount({ holdings: sanitizeHoldings(holdings) })];
		} else {
			throw new HttpError("Request body must include holdings or accounts", 400);
		}

		if (accountFields.every((account) => Object.keys(account.holdings).length === 0)) {
			throw new HttpError("Provide at least one holding to save a list", 400);
		}

		const trimmedName = typeof name === "string" ? name.trim() : "";
		const listName = trimmedName.length > 0 ? trimmedName : "Untitled List";

		const insertedList = await db.transaction().execute(async (trx) => {
			// Becomes the main portfolio if the user doesn't have one yet
			const currentPrimary = await trx
				.selectFrom("lists")
				.select("id")
				.where("ownerId", "=", ownerId)
				.where("isPrimary", "=", true)
				.executeTakeFirst();

			const list = await trx
				.insertInto("lists")
				.values({
					publicId: generatePublicId(),
					name: listName,
					content: {},
					ownerId,
					isPrimary: !currentPrimary
				})
				.returning("id")
				.executeTakeFirstOrThrow();

			for (const [position, fields] of accountFields.entries()) {
				const account = await trx
					.insertInto("accounts")
					.values({
						publicId: generatePublicId(),
						listId: list.id,
						name: fields.name,
						institution: fields.institution,
						type: fields.type,
						position
					})
					.returning("id")
					.executeTakeFirstOrThrow();

				await writeAccountHoldings(trx, account.id, fields.holdings);
			}

			await syncListContent(trx, list.id);

			return await trx
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
				.where("id", "=", list.id)
				.executeTakeFirstOrThrow();
		});

		const [list] = await withAccounts([insertedList]);

		logger.info(
			`[list] User ${ownerId} saved list ${list.id} with ${list.accounts.length} account(s) and ${
				Object.keys(list.content).length
			} holdings`
		);

		res.status(201).send({ data: list });
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
