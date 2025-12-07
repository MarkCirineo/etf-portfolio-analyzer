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

export type AggregatedHolding = {
	symbol: string;
	totalShares: number;
	directShares: number;
	viaEtfs: string[];
	name?: string;
};

export type ListAnalysis = {
	holdings: AggregatedHolding[];
	failedTickers: string[];
	usedPlaceholders: string[];
	generatedAt: string;
};

export type ListDetail = {
	list: List;
	analysis: ListAnalysis;
};
