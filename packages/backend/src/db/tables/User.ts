import { Generated } from "kysely";

export default interface UserTable {
	id: Generated<number>;
	username: string;
	email: string;
	password: string;
	role: "admin" | "user";
	avatar: string | null;
	createdAt: Generated<Date>;
	updatedAt: Generated<Date>;
}

export type User = {
	id: number;
	username: string;
	email: string;
	password: string;
	role: "admin" | "user";
	avatar: string | null;
	createdAt: Date;
	updatedAt: Date;
};
