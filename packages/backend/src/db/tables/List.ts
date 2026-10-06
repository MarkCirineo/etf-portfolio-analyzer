import { Generated } from "kysely";

export type ListContent = Record<string, number>;

export default interface ListTable {
	id: Generated<number>;
	publicId: string;
	name: string;
	/**
	 * Every account's holdings added together. The accounts are the source of truth; this
	 * is rewritten whenever one changes, so the combined view is a single read.
	 */
	content: ListContent;
	ownerId: number;
	/** The user's main portfolio; every other list is a scenario. */
	isPrimary: Generated<boolean>;
	createdAt: Generated<Date>;
	updatedAt: Generated<Date>;
}

export type List = {
	id: number;
	publicId: string;
	name: string;
	content: ListContent;
	ownerId: number;
	isPrimary: boolean;
	createdAt: Date;
	updatedAt: Date;
};
