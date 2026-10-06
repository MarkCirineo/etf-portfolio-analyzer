import { Generated } from "kysely";

export const ACCOUNT_TYPES = [
	"taxable",
	"roth_ira",
	"traditional_ira",
	"401k",
	"hsa",
	"other"
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** One brokerage account within a list. A list's holdings are its accounts' combined. */
export default interface AccountTable {
	id: Generated<number>;
	publicId: string;
	listId: number;
	name: string;
	/** The brokerage, free text; null when the user leaves it out. */
	institution: string | null;
	type: AccountType;
	/** Display order within the list. */
	position: Generated<number>;
	createdAt: Generated<Date>;
	updatedAt: Generated<Date>;
}

export interface AccountHoldingTable {
	accountId: number;
	symbol: string;
	shares: number;
}
