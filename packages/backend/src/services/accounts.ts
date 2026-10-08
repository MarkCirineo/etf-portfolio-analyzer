import type { Kysely } from "kysely";
import db, { type Database } from "@db";
import type { AccountType } from "@db/tables/Account";
import type { ListContent } from "@db/tables/List";
import { analyzeList, INPUT_PRIORITY, type ListAnalysis } from "@services/list-analysis";
import { HttpError } from "@utils/error";
import { getQuoteSnapshots } from "@utils/quotes";

export type Account = {
	id: string;
	name: string;
	institution: string | null;
	type: AccountType;
	holdings: ListContent;
};

/** One account's value, from the same prices as the analysis. */
export type AccountSummary = {
	id: string;
	name: string;
	institution: string | null;
	type: AccountType;
	/** Market value of the positions that have a price. */
	value: number;
	/** False while any position is still waiting for a price. */
	valueComplete: boolean;
	/** Share of every account combined, not of the current scope. */
	percentOfPortfolio: number | null;
	dayChange: number | null;
	positions: {
		symbol: string;
		shares: number;
		price: number | null;
		value: number | null;
		percentOfAccount: number | null;
	}[];
};

export type AccountsAnalysis = {
	/** Analysis of the accounts in scope, combined. */
	analysis: ListAnalysis;
	/** Every account, whatever the scope, so the page can show all of them. */
	accounts: AccountSummary[];
	/** Account ids the analysis covers; null for all of them. */
	scope: string[] | null;
	trackedSymbols: Set<string>;
};

type Executor = Kysely<Database>;

/** Accounts with their holdings for each list, keyed by the list's public id. */
export const loadAccounts = async (
	listPublicIds: string[],
	executor: Executor = db
): Promise<Map<string, Account[]>> => {
	const byList = new Map<string, Account[]>(listPublicIds.map((id) => [id, []]));

	if (listPublicIds.length === 0) {
		return byList;
	}

	const rows = await executor
		.selectFrom("accounts")
		.innerJoin("lists", "lists.id", "accounts.listId")
		.select([
			"lists.publicId as listId",
			"accounts.id as internalId",
			"accounts.publicId as id",
			"accounts.name",
			"accounts.institution",
			"accounts.type"
		])
		.where("lists.publicId", "in", listPublicIds)
		.orderBy("accounts.position")
		.orderBy("accounts.id")
		.execute();

	const holdings =
		rows.length > 0
			? await executor
					.selectFrom("account_holdings")
					.select(["accountId", "symbol", "shares"])
					.where(
						"accountId",
						"in",
						rows.map((row) => row.internalId)
					)
					.orderBy("symbol")
					.execute()
			: [];

	const holdingsByAccount = new Map<number, ListContent>();

	for (const holding of holdings) {
		const content = holdingsByAccount.get(holding.accountId) ?? {};
		content[holding.symbol] = Number(holding.shares);
		holdingsByAccount.set(holding.accountId, content);
	}

	for (const row of rows) {
		byList.get(row.listId)?.push({
			id: row.id,
			name: row.name,
			institution: row.institution,
			type: row.type,
			holdings: holdingsByAccount.get(row.internalId) ?? {}
		});
	}

	return byList;
};

/** The same symbol held in several accounts counts once, with the shares added together. */
export const combineHoldings = (accounts: Account[]): ListContent => {
	const combined: ListContent = {};

	for (const account of accounts) {
		for (const [symbol, shares] of Object.entries(account.holdings)) {
			combined[symbol] = (combined[symbol] ?? 0) + shares;
		}
	}

	return combined;
};

/** Replace an account's holdings wholesale. */
export const writeAccountHoldings = async (
	executor: Executor,
	accountId: number,
	holdings: ListContent
) => {
	await executor.deleteFrom("account_holdings").where("accountId", "=", accountId).execute();

	const rows = Object.entries(holdings).map(([symbol, shares]) => ({
		accountId,
		symbol,
		shares
	}));

	if (rows.length > 0) {
		await executor.insertInto("account_holdings").values(rows).execute();
	}
};

/** Recompute the list's combined holdings after one of its accounts changed. */
export const syncListContent = async (executor: Executor, listId: number) => {
	const rows = await executor
		.selectFrom("account_holdings")
		.innerJoin("accounts", "accounts.id", "account_holdings.accountId")
		.select(["account_holdings.symbol", "account_holdings.shares"])
		.where("accounts.listId", "=", listId)
		.execute();

	const content: ListContent = {};

	for (const row of rows) {
		content[row.symbol] = (content[row.symbol] ?? 0) + Number(row.shares);
	}

	await executor
		.updateTable("lists")
		.set({ content, updatedAt: new Date() })
		.where("id", "=", listId)
		.execute();

	return content;
};

/**
 * Account ids from a `?accounts=a,b` query. Null means every account; an id the list
 * does not have is an error rather than silently analysing less than was asked for.
 */
export const parseScope = (raw: unknown, accounts: Account[]): string[] | null => {
	if (raw === undefined || raw === null || raw === "") {
		return null;
	}

	if (typeof raw !== "string") {
		throw new HttpError("accounts must be a comma-separated list of account ids", 400);
	}

	const ids = Array.from(
		new Set(
			raw
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean)
		)
	);
	const known = new Set(accounts.map((account) => account.id));
	const unknown = ids.filter((id) => !known.has(id));

	if (unknown.length > 0) {
		throw new HttpError(`Unknown account: ${unknown.join(", ")}`, 400);
	}

	return ids.length === 0 || ids.length === accounts.length ? null : ids;
};

/**
 * Analyse the accounts in scope as one portfolio, and value every account so the page can
 * show where the money sits even while focused on a subset.
 */
export const analyzeAccounts = async (
	accounts: Account[],
	scope: string[] | null
): Promise<AccountsAnalysis> => {
	const inScope = scope ? accounts.filter((account) => scope.includes(account.id)) : accounts;
	const { analysis, trackedSymbols } = await analyzeList(combineHoldings(inScope));

	const prices = new Map(
		analysis.inputs.map((input) => [
			input.symbol,
			{ price: input.price, previousClose: input.previousClose }
		])
	);

	// Accounts outside the scope can hold symbols the analysis never priced
	const missing = Array.from(
		new Set(accounts.flatMap((account) => Object.keys(account.holdings)))
	).filter((symbol) => !prices.has(symbol));

	if (missing.length > 0) {
		const snapshots = await getQuoteSnapshots(
			missing,
			new Map(missing.map((symbol) => [symbol, INPUT_PRIORITY]))
		);

		for (const symbol of missing) {
			const snapshot = snapshots.get(symbol);
			prices.set(symbol, {
				price: snapshot?.price ?? null,
				previousClose: snapshot?.previousClose ?? null
			});
			trackedSymbols.add(symbol);
		}
	}

	return {
		analysis,
		accounts: summarizeAccounts(accounts, prices),
		scope,
		trackedSymbols
	};
};

export const summarizeAccounts = (
	accounts: Account[],
	prices: Map<string, { price: number | null; previousClose: number | null }>
): AccountSummary[] => {
	const summaries = accounts.map((account) => {
		let value = 0;
		let valueComplete = true;
		let dayChange: number | null = 0;

		const positions = Object.entries(account.holdings).map(([symbol, shares]) => {
			const { price, previousClose } = prices.get(symbol) ?? {
				price: null,
				previousClose: null
			};
			const positionValue = price !== null ? shares * price : null;

			if (positionValue === null) {
				valueComplete = false;
			} else {
				value += positionValue;
			}

			if (dayChange !== null) {
				dayChange =
					price !== null && previousClose !== null
						? dayChange + shares * (price - previousClose)
						: null;
			}

			return { symbol, shares, price, value: positionValue };
		});

		return { account, value, valueComplete, dayChange, positions };
	});

	const total = summaries.reduce((sum, summary) => sum + summary.value, 0);

	return summaries.map(({ account, value, valueComplete, dayChange, positions }) => ({
		id: account.id,
		name: account.name,
		institution: account.institution,
		type: account.type,
		value: round(value, 2),
		valueComplete,
		percentOfPortfolio: total > 0 ? round((value / total) * 100, 4) : null,
		dayChange: dayChange === null ? null : round(dayChange, 2),
		positions: positions
			.map((position) => ({
				...position,
				value: position.value === null ? null : round(position.value, 2),
				percentOfAccount:
					position.value !== null && value > 0
						? round((position.value / value) * 100, 4)
						: null
			}))
			.sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
	}));
};

const round = (value: number, decimals: number) => {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
};
