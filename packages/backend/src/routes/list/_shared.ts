import { type Request } from "express";
import { HttpError } from "@utils/error";
import { verifyToken } from "@routes/auth/_shared";
import { DEFAULT_ACCOUNT_NAME } from "@db/tables";
import { ACCOUNT_TYPES, type AccountType } from "@db/tables/Account";
import type { ListContent } from "@db/tables/List";
import { analyzeAccounts, loadAccounts, parseScope, type Account } from "@services/accounts";

export const resolveOwnerId = (req: Request): number => {
	const token = req.cookies?.token;

	if (!token) {
		throw new HttpError("Not authenticated", 401, true);
	}

	const decoded = verifyToken(token);

	return decoded.userId;
};

export const sanitizeHoldings = (
	holdings: Record<string, number | string>,
	{ allowEmpty = false }: { allowEmpty?: boolean } = {}
): ListContent => {
	if (!holdings || typeof holdings !== "object" || Array.isArray(holdings)) {
		throw new HttpError("Holdings must be an object of ticker symbols to share counts", 400);
	}

	const sanitized: ListContent = {};

	for (const [rawTicker, rawShares] of Object.entries(holdings)) {
		const ticker = rawTicker.trim().toUpperCase();

		if (!ticker) {
			continue;
		}

		if (ticker.length > 20) {
			throw new HttpError(`${ticker.slice(0, 20)}… is too long to be a ticker symbol`, 400);
		}

		const shares =
			typeof rawShares === "number" ? rawShares : Number((rawShares ?? "").toString());

		if (!Number.isFinite(shares) || shares < 0) {
			throw new HttpError("Shares must be a non-negative number", 400);
		}

		sanitized[ticker] = shares;
	}

	if (!allowEmpty && Object.keys(sanitized).length === 0) {
		throw new HttpError("Provide at least one holding to save a list", 400);
	}

	return sanitized;
};

export type AccountPayload = {
	name?: string;
	institution?: string | null;
	type?: string;
	holdings?: Record<string, number | string>;
};

export type AccountFields = {
	name: string;
	institution: string | null;
	type: AccountType;
	holdings: ListContent;
};

/** Validate an account from a request body. With `partial`, absent fields stay undefined. */
export function sanitizeAccount(payload: AccountPayload, partial: true): Partial<AccountFields>;
export function sanitizeAccount(payload: AccountPayload, partial?: false): AccountFields;
export function sanitizeAccount(payload: AccountPayload, partial = false) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new HttpError("Account must be an object", 400);
	}

	const fields: Partial<AccountFields> = {};

	if (payload.name !== undefined || !partial) {
		const name = typeof payload.name === "string" ? payload.name.trim() : "";
		fields.name = (name || DEFAULT_ACCOUNT_NAME).slice(0, 100);
	}

	if (payload.institution !== undefined || !partial) {
		const institution =
			typeof payload.institution === "string" ? payload.institution.trim() : "";
		fields.institution = institution ? institution.slice(0, 100) : null;
	}

	if (payload.type !== undefined || !partial) {
		const type = payload.type ?? "other";

		if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) {
			throw new HttpError(`Account type must be one of ${ACCOUNT_TYPES.join(", ")}`, 400);
		}

		fields.type = type as AccountType;
	}

	if (payload.holdings !== undefined || !partial) {
		fields.holdings = sanitizeHoldings(payload.holdings ?? {}, { allowEmpty: true });
	}

	return fields;
}

/** Add each list's accounts to it. */
export const withAccounts = async <T extends { id: string }>(
	lists: T[]
): Promise<(T & { accounts: Account[] })[]> => {
	const accounts = await loadAccounts(lists.map((list) => list.id));
	return lists.map((list) => ({ ...list, accounts: accounts.get(list.id) ?? [] }));
};

/**
 * A list with its analysis. `rawScope` is the `?accounts=` query: the analysis covers just
 * those accounts, while `accounts` still values every one of them.
 */
export const analyzeListView = async <T extends { id: string }>(list: T, rawScope: unknown) => {
	const [listWithAccounts] = await withAccounts([list]);
	const { analysis, accounts, scope } = await analyzeAccounts(
		listWithAccounts.accounts,
		parseScope(rawScope, listWithAccounts.accounts)
	);

	return { list: listWithAccounts, analysis, accounts, scope };
};
