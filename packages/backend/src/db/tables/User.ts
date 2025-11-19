import { Generated } from "kysely";

export default interface UserTable {
	id: Generated<number>;
	publicId: string;
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
	publicId: string;
	username: string;
	email: string;
	password: string;
	role: "admin" | "user";
	avatar: string | null;
	createdAt: Date;
	updatedAt: Date;
};
