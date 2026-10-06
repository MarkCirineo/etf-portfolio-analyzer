import { Kysely, sql } from "kysely";
import { Database } from "@db";
import logger from "@logger";
import { generatePublicId } from "@utils/id";

/** What an account is called when the user hasn't named it. */
export const DEFAULT_ACCOUNT_NAME = "Brokerage account";

export const createTables = async (db: Kysely<Database>): Promise<void> => {
	// Users table
	try {
		await db.schema
			.createTable("users")
			.ifNotExists()
			.addColumn("id", "serial", (c) => c.unique().primaryKey())
			.addColumn("public_id", "varchar(12)", (c) => c.notNull().unique())
			.addColumn("username", "varchar(25)", (c) => c.notNull().unique())
			.addColumn("email", "varchar(100)", (c) => c.notNull().unique())
			.addColumn("password", "varchar(64)", (c) => c.notNull())
			.addColumn("role", "varchar(5)", (c) => c.notNull().defaultTo("user"))
			.addColumn("avatar", "text")
			.addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`NOW()`))
			.addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`NOW()`))
			.execute();
	} catch (error: any) {
		logger.warn(`Failed to create tables: ${error.message}`);
	}

	// Lists table
	try {
		await db.schema
			.createTable("lists")
			.ifNotExists()
			.addColumn("id", "serial", (c) => c.unique().primaryKey())
			.addColumn("public_id", "varchar(12)", (c) => c.notNull().unique())
			.addColumn("name", "varchar(100)", (c) => c.notNull())
			.addColumn("content", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
			.addColumn("owner_id", "integer", (c) =>
				c.notNull().references("users.id").onDelete("cascade")
			)
			.addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`NOW()`))
			.addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`NOW()`))
			.execute();
	} catch (error: any) {
		logger.warn(`Failed to create lists table: ${error.message}`);
	}

	// Each user has at most one main portfolio; their other lists are scenarios. The
	// partial unique index enforces "at most one" in the database rather than in code.
	try {
		await sql`alter table lists add column if not exists is_primary boolean not null default false`.execute(
			db
		);
		await sql`create unique index if not exists lists_one_primary_per_owner on lists (owner_id) where is_primary`.execute(
			db
		);
	} catch (error: any) {
		logger.warn(`Failed to add the main portfolio flag to lists: ${error.message}`);
	}

	// A list is made of accounts (a Roth IRA at one brokerage, a taxable account at
	// another), each with its own holdings
	try {
		await db.schema
			.createTable("accounts")
			.ifNotExists()
			.addColumn("id", "serial", (c) => c.primaryKey())
			.addColumn("public_id", "varchar(12)", (c) => c.notNull().unique())
			.addColumn("list_id", "integer", (c) =>
				c.notNull().references("lists.id").onDelete("cascade")
			)
			.addColumn("name", "varchar(100)", (c) => c.notNull())
			.addColumn("institution", "varchar(100)")
			.addColumn("type", "varchar(20)", (c) => c.notNull().defaultTo("other"))
			.addColumn("position", "integer", (c) => c.notNull().defaultTo(0))
			.addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`NOW()`))
			.addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`NOW()`))
			.execute();
		await sql`create index if not exists accounts_list_id on accounts (list_id)`.execute(db);

		await db.schema
			.createTable("account_holdings")
			.ifNotExists()
			.addColumn("account_id", "integer", (c) =>
				c.notNull().references("accounts.id").onDelete("cascade")
			)
			.addColumn("symbol", "varchar(20)", (c) => c.notNull())
			.addColumn("shares", "double precision", (c) => c.notNull())
			.addPrimaryKeyConstraint("account_holdings_pkey", ["account_id", "symbol"])
			.execute();
	} catch (error: any) {
		logger.warn(`Failed to create accounts tables: ${error.message}`);
	}

	try {
		await moveListContentIntoAccounts(db);
	} catch (error: any) {
		logger.warn(`Failed to move list holdings into accounts: ${error.message}`);
	}
};

/** Lists from before accounts existed become a single account holding what the list did. */
const moveListContentIntoAccounts = async (db: Kysely<Database>) => {
	const lists = await db
		.selectFrom("lists")
		.select(["id", "content"])
		.where(({ not, exists, selectFrom }) =>
			not(
				exists(
					selectFrom("accounts")
						.select("accounts.id")
						.whereRef("accounts.listId", "=", "lists.id")
				)
			)
		)
		.execute();

	for (const list of lists) {
		await db.transaction().execute(async (trx) => {
			const account = await trx
				.insertInto("accounts")
				.values({
					publicId: generatePublicId(),
					listId: list.id,
					name: DEFAULT_ACCOUNT_NAME,
					type: "other"
				})
				.returning("id")
				.executeTakeFirstOrThrow();

			const holdings = Object.entries(list.content ?? {})
				.map(([symbol, shares]) => ({
					accountId: account.id,
					symbol: symbol.trim().toUpperCase(),
					shares: Number(shares)
				}))
				.filter((row) => row.symbol && Number.isFinite(row.shares) && row.shares >= 0);

			if (holdings.length > 0) {
				await trx.insertInto("account_holdings").values(holdings).execute();
			}
		});
	}

	if (lists.length > 0) {
		logger.info(`Moved ${lists.length} list(s) into single accounts`);
	}
};
