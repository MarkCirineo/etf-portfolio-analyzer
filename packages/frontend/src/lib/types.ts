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
	/** The user's main portfolio; every other list is a scenario. */
	isPrimary: boolean;
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
	| "foreign-listing"
	/** A US-style ticker registered to a differently named company; not priced. */
	| "unconfirmed-listing";

export type InputKind = "etf" | "stock" | "unknown";

/** One row of the list as the user entered it, priced. */
export type ListInput = {
	symbol: string;
	shares: number;
	kind: InputKind;
	price: number | null;
	priceStatus: PriceStatus;
	value: number | null;
	previousClose: number | null;
	/** Dollar change since the previous close for this position. */
	dayChange: number | null;
	percentOfPortfolio: number | null;
	holdingsCount: number | null;
	holdingsAsOf: string | null;
	leveraged: boolean;
	/** Percent of the ETF's weight the holdings provider accounted for; null for non-ETFs. */
	weightCovered: number | null;
	/** Percent per year; null for stocks and when the fund profile is unavailable. */
	expenseRatio: number | null;
	distributionYield: number | null;
};

export type EtfContribution = {
	etf: string;
	/** Percent of the ETF this holding represents. */
	weight: number;
	exposure: number;
};

/** One security the user is exposed to, directly and/or through ETFs. */
export type AnalyzedHolding = {
	/** Unique per security. Tickers are not: MRK is both Merck & Co. and Merck KGaA. */
	id: string;
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
	/** Change since the previous close; `complete` is false when some input lacks one. */
	dayChange: { amount: number; percent: number | null; complete: boolean };
	inputs: ListInput[];
	holdings: AnalyzedHolding[];
	tail: ExposureBucket & { count: number };
	cashAndOther: ExposureBucket & { items: { name: string; exposure: number }[] };
	unaccounted: ExposureBucket & {
		byInput: { symbol: string; exposure: number; weightMissing: number }[];
	};
	failedTickers: string[];
	breakdown: PortfolioBreakdown;
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

export type BreakdownRow = { name: string; exposure: number; percent: number };

export type BreakdownSet = {
	rows: BreakdownRow[];
	/** Value no fund attributed to a named row, plus positions without fund data. */
	unclassified: { exposure: number; percent: number };
};

/** Portfolio-level view, weighted by each fund's dollar value. */
export type PortfolioBreakdown = {
	/** FactSet economic sectors, as etf.com reports them. */
	sectors: BreakdownSet;
	countries: BreakdownSet;
	regions: BreakdownSet;
	marketCap: BreakdownSet;
	unprofiled: { symbol: string; value: number }[];
	fees: { annual: number; expenseRatio: number; complete: boolean };
	income: { annual: number; yield: number | null; coveredPercent: number };
	valuation: {
		priceToEarnings: number | null;
		priceToBook: number | null;
		weightedAvgMarketCap: number | null;
		coveredPercent: number;
	};
	/** matrix[i][j] = percent of fund i's weight held in securities fund j also holds. */
	overlap: { funds: string[]; matrix: (number | null)[][] };
	/** Growth of $10,000 holding today's mix, rebalanced monthly. Not actual returns. */
	backtest: {
		start: string;
		end: string;
		points: { month: string; value: number }[];
		annualizedReturn: number | null;
		limitedBy: string;
		coveredPercent: number;
	} | null;
};
