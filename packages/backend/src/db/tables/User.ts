import { Generated } from "kysely";

export default interface UserTable {
	id: Generated<number>;
	username: string;
	email: string;
	password: string;
	role: "admin" | "user";
	createdAt: Generated<Date>;
	updatedAt: Generated<Date>;
}

export type User = {
	id: number;
	username: string;
	email: string;
	password: string;
	role: "admin" | "user";
	createdAt: Date;
	updatedAt: Date;
};
