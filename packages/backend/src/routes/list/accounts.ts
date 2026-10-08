import { Router, type NextFunction, type Request, type Response } from "express";
import type { Kysely } from "kysely";
import db, { type Database } from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { generatePublicId } from "@utils/id";
import { loadAccounts, syncListContent, writeAccountHoldings } from "@services/accounts";
import { refreshListSubscriptions } from "@services/list-subscriptions";
import { resolveOwnerId, sanitizeAccount, type AccountPayload } from "./_shared";

const router = Router();

type AccountParams = { publicId?: string; accountId?: string };

const findList = async (executor: Kysely<Database>, ownerId: number, publicId?: string) => {
	const id = publicId?.trim();

	if (!id) {
		throw new HttpError("List id is required", 400);
	}

	const list = await executor
		.selectFrom("lists")
		.select(["id", "publicId"])
		.where("ownerId", "=", ownerId)
		.where("publicId", "=", id)
		.executeTakeFirst();

	if (!list) {
		throw new HttpError("List not found", 404);
	}

	return list;
};

const findAccount = async (executor: Kysely<Database>, listId: number, accountId?: string) => {
	const id = accountId?.trim();

	const account = id
		? await executor
				.selectFrom("accounts")
				.select("id")
				.where("listId", "=", listId)
				.where("publicId", "=", id)
				.executeTakeFirst()
		: undefined;

	if (!account) {
		throw new HttpError("Account not found", 404);
	}

	return account;
};

/** The saved account as the list routes return it, after the list's content is resynced. */
const respondWithAccount = async (listPublicId: string, accountPublicId: string) => {
	const accounts = (await loadAccounts([listPublicId])).get(listPublicId) ?? [];
	return accounts.find((account) => account.id === accountPublicId);
};

const handleError = (action: string, error: unknown, next: NextFunction) => {
	if (error instanceof HttpError) {
		return next(error);
	}

	logger.error(
		`[list] Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`
	);
	next(new HttpError(`Failed to ${action}`, 500));
};

router.post(
	"/:publicId/accounts",
	async (req: Request<AccountParams, {}, AccountPayload>, res: Response, next: NextFunction) => {
		try {
			const ownerId = resolveOwnerId(req);
			const fields = sanitizeAccount(req.body ?? {});

			const { list, accountId } = await db.transaction().execute(async (trx) => {
				const list = await findList(trx, ownerId, req.params.publicId);
				const last = await trx
					.selectFrom("accounts")
					.select((eb) => eb.fn.max("position").as("position"))
					.where("listId", "=", list.id)
					.executeTakeFirst();

				const accountId = generatePublicId();
				const account = await trx
					.insertInto("accounts")
					.values({
						publicId: accountId,
						listId: list.id,
						name: fields.name,
						institution: fields.institution,
						type: fields.type,
						position: (last?.position ?? -1) + 1
					})
					.returning("id")
					.executeTakeFirstOrThrow();

				await writeAccountHoldings(trx, account.id, fields.holdings);
				await syncListContent(trx, list.id);

				return { list, accountId };
			});

			refreshListSubscriptions(list.publicId);
			logger.info(
				`[list] User ${ownerId} added account ${accountId} to list ${list.publicId}`
			);

			res.status(201).send({ data: await respondWithAccount(list.publicId, accountId) });
		} catch (error) {
			handleError("add account", error, next);
		}
	}
);

router.patch(
	"/:publicId/accounts/:accountId",
	async (req: Request<AccountParams, {}, AccountPayload>, res: Response, next: NextFunction) => {
		try {
			const ownerId = resolveOwnerId(req);
			const { holdings, ...details } = sanitizeAccount(req.body ?? {}, true);

			const list = await db.transaction().execute(async (trx) => {
				const list = await findList(trx, ownerId, req.params.publicId);
				const account = await findAccount(trx, list.id, req.params.accountId);

				await trx
					.updateTable("accounts")
					.set({ ...details, updatedAt: new Date() })
					.where("id", "=", account.id)
					.execute();

				if (holdings) {
					await writeAccountHoldings(trx, account.id, holdings);
				}

				await syncListContent(trx, list.id);

				return list;
			});

			refreshListSubscriptions(list.publicId);
			logger.info(
				`[list] User ${ownerId} updated account ${req.params.accountId} in list ${list.publicId}`
			);

			res.status(200).send({
				data: await respondWithAccount(list.publicId, req.params.accountId!.trim())
			});
		} catch (error) {
			handleError("update account", error, next);
		}
	}
);

router.delete(
	"/:publicId/accounts/:accountId",
	async (req: Request<AccountParams>, res: Response, next: NextFunction) => {
		try {
			const ownerId = resolveOwnerId(req);

			const list = await db.transaction().execute(async (trx) => {
				const list = await findList(trx, ownerId, req.params.publicId);
				const account = await findAccount(trx, list.id, req.params.accountId);
				const count = await trx
					.selectFrom("accounts")
					.select((eb) => eb.fn.countAll<number>().as("count"))
					.where("listId", "=", list.id)
					.executeTakeFirstOrThrow();

				if (Number(count.count) <= 1) {
					throw new HttpError("A list needs at least one account", 409);
				}

				await trx.deleteFrom("accounts").where("id", "=", account.id).execute();
				await syncListContent(trx, list.id);

				return list;
			});

			refreshListSubscriptions(list.publicId);
			logger.info(
				`[list] User ${ownerId} removed account ${req.params.accountId} from list ${list.publicId}`
			);

			res.status(204).send();
		} catch (error) {
			handleError("remove account", error, next);
		}
	}
);

export default router;
