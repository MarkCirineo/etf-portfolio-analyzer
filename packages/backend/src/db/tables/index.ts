import { Kysely, sql } from "kysely";
import { Database } from "@db";
import logger from "@logger";

export const createTables = async (db: Kysely<Database>): Promise<void> => {
	// Users table
	try {
		await db.schema
			.createTable("users")
			.addColumn("id", "serial", (c) => c.unique().primaryKey())
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

	try {
		await db.schema.alterTable("users").addColumn("avatar", "text").execute();
	} catch (error: any) {
		if (!error?.message?.includes("column") || !error?.message?.includes("already exists")) {
			logger.warn(`Failed to ensure avatar column: ${error?.message ?? error}`);
		}
	}
};
