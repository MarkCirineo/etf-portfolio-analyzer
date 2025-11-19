export type SearchItem = {
	description: string;
	displaySymbol: string;
	symbol: string;
	type: string;
};

export type AuthUser = {
	id: number;
	email: string;
	username: string;
	role: string;
	avatar: string | null;
};

export type List = {
	id: string;
	name: string;
	content: Record<string, number>;
	ownerId: number;
	createdAt: string;
	updatedAt: string;
};
