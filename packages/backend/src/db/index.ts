import pg from "pg";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import config from "@config.js";
import UserTable from "@db/tables/User.js";
import { createTables } from "@db/tables";

const { Pool } = pg;

export interface Database {
	users: UserTable;
}

const db = new Kysely<Database>({
	dialect: new PostgresDialect({
		pool: new Pool({
			host: config.db.host,
			port: config.db.port,
			user: config.db.user,
			password: config.db.password,
			database: config.db.database
		})
	}),
	plugins: [new CamelCasePlugin()]
});

await createTables(db);

export default db;
