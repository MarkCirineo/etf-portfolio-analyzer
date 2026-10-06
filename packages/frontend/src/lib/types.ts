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

export type PriceStatus =
	| "fresh"
	| "stale"
	| "pending"
	| "unavailable"
	| "not-requested"
	/** Reported under a foreign exchange ticker, which the quote provider cannot resolve. */
	| "foreign-listing";

export type InputKind = "etf" | "stock" | "unknown";

/** One row of the list as the user entered it, priced. */
export type ListInput = {
	symbol: string;
	shares: number;
	kind: InputKind;
	price: number | null;
	priceStatus: PriceStatus;
	value: number | null;
	percentOfPortfolio: number | null;
	holdingsCount: number | null;
	holdingsAsOf: string | null;
	leveraged: boolean;
	/** Percent of the ETF's weight the holdings provider accounted for; null for non-ETFs. */
	weightCovered: number | null;
};

export type EtfContribution = {
	etf: string;
	/** Percent of the ETF this holding represents. */
	weight: number;
	exposure: number;
};

/** One security the user is exposed to, directly and/or through ETFs. */
export type AnalyzedHolding = {
	symbol: string;
	name: string | null;
	usListed: boolean;
	exposure: number;
	percentOfPortfolio: number;
	directShares: number;
	derivedShares: number | null;
	totalShares: number | null;
	price: number | null;
	priceStatus: PriceStatus;
	viaEtfs: EtfContribution[];
};

export type ExposureBucket = {
	exposure: number;
	percentOfPortfolio: number;
};

export type ListAnalysis = {
	generatedAt: string;
	marketOpen: boolean;
	totalValue: number;
	totalValueComplete: boolean;
	inputs: ListInput[];
	holdings: AnalyzedHolding[];
	tail: ExposureBucket & { count: number };
	cashAndOther: ExposureBucket & { items: { name: string; exposure: number }[] };
	unaccounted: ExposureBucket & {
		byInput: { symbol: string; exposure: number; weightMissing: number }[];
	};
	failedTickers: string[];
	quotes: {
		requested: number;
		priced: number;
		stale: number;
		pending: number;
		unavailable: number;
	};
	pendingQuotes: string[];
	quoteFailures: string[];
};

export type ListDetail = {
	list: List;
	analysis: ListAnalysis;
};
