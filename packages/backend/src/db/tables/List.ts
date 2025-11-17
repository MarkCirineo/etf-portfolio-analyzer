import { Generated } from "kysely";

export type ListContent = Record<string, number>;

export default interface ListTable {
	id: Generated<number>;
	name: string;
	content: ListContent;
	ownerId: number;
	createdAt: Generated<Date>;
	updatedAt: Generated<Date>;
}

export type List = {
	id: number;
	name: string;
	content: ListContent;
	ownerId: number;
	createdAt: Date;
	updatedAt: Date;
};
