import type { EtfHoldingsRecord } from "@services/etf-holdings";
import type { Breakdown, FundProfile } from "@services/fund-profile";

export type BreakdownRow = { name: string; exposure: number; percent: number };

export type BreakdownSet = {
	rows: BreakdownRow[];
	/**
	 * Value no fund attributed to a named row: weight a fund left unlabelled, plus
	 * positions without fund data (directly held stocks, funds whose profile failed).
	 */
	unclassified: { exposure: number; percent: number };
};

export type PortfolioBreakdown = {
	/** GICS sectors from a company-by-company look-through; FactSet's when GICS is unavailable. */
	sectors: BreakdownSet;
	sectorScheme: "gics" | "factset";
	countries: BreakdownSet;
	regions: BreakdownSet;
	marketCap: BreakdownSet;
	/** Positions with no fund profile, so missing from the breakdowns above. */
	unprofiled: { symbol: string; value: number }[];
	/** Directly held stocks pay no fund fee, so they count as covered. */
	fees: { annual: number; expenseRatio: number; complete: boolean };
	/** Yield is over the covered value only; directly held stocks have no yield data yet. */
	income: { annual: number; yield: number | null; coveredPercent: number };
	valuation: {
		/** Harmonic mean, the correct way to combine P/E (and P/B) across holdings. */
		priceToEarnings: number | null;
		priceToBook: number | null;
		weightedAvgMarketCap: number | null;
		coveredPercent: number;
	};
	/**
	 * matrix[i][j] = percent of fund i's weight held in securities fund j also holds.
	 * Asymmetric: QQQ can sit almost entirely inside VTI while VTI is mostly outside QQQ.
	 */
	overlap: { funds: string[]; matrix: (number | null)[][] };
	backtest: Backtest | null;
};

export type Backtest = {
	/** Month keys, "YYYY-MM". */
	start: string;
	end: string;
	/** Growth of $10,000 holding today's mix, rebalanced monthly. */
	points: { month: string; value: number }[];
	annualizedReturn: number | null;
	/** The youngest fund, whose launch sets the start. */
	limitedBy: string;
	/** Share of the portfolio's value the backtest covers. */
	coveredPercent: number;
};

/** One priced position as analyzeList sees it. */
export type PricedInput = {
	symbol: string;
	kind: "etf" | "stock" | "unknown";
	value: number | null;
};

export const buildPortfolioBreakdown = (
	inputs: PricedInput[],
	profiles: Map<string, FundProfile>,
	holdings: Map<string, EtfHoldingsRecord>,
	totalValue: number,
	/** Sectors classified company by company; null falls back to the funds' own (FactSet) breakdowns. */
	gicsSectors: BreakdownSet | null = null
): PortfolioBreakdown => {
	const priced = inputs.filter(
		(input): input is PricedInput & { value: number } => input.value !== null && input.value > 0
	);
	const profiled = priced.filter((input) => usableProfile(profiles.get(input.symbol)));
	const unprofiled = priced
		.filter((input) => !usableProfile(profiles.get(input.symbol)))
		.map((input) => ({ symbol: input.symbol, value: round(input.value, 2) }));

	const breakdown = (pick: (profile: FundProfile) => Breakdown) =>
		combineBreakdowns(
			profiled.map((input) => ({
				value: input.value,
				rows: pick(profiles.get(input.symbol)!)
			})),
			totalValue
		);

	return {
		sectors: gicsSectors ?? breakdown((profile) => profile.sectors),
		sectorScheme: gicsSectors ? "gics" : "factset",
		countries: breakdown((profile) => profile.countries),
		regions: breakdown((profile) => profile.regions),
		marketCap: breakdown((profile) => profile.marketCap),
		unprofiled,
		fees: computeFees(priced, profiles, totalValue),
		income: computeIncome(priced, profiles, totalValue),
		valuation: computeValuation(priced, profiles, totalValue),
		overlap: computeOverlap(priced, holdings),
		backtest: computeBacktest(priced, profiles, totalValue)
	};
};

const usableProfile = (profile: FundProfile | undefined): profile is FundProfile => {
	return profile !== undefined && profile.status === "etf";
};

/** Spread each fund's value over its breakdown; whatever is left over is unclassified. */
export const combineBreakdowns = (
	funds: { value: number; rows: Breakdown }[],
	totalValue: number
): BreakdownSet => {
	const exposures = new Map<string, number>();

	for (const fund of funds) {
		for (const row of fund.rows) {
			exposures.set(
				row.name,
				(exposures.get(row.name) ?? 0) + (fund.value * row.weight) / 100
			);
		}
	}

	const classified = Array.from(exposures.values()).reduce((sum, exposure) => sum + exposure, 0);
	// Fund weights can total a hair over 100 from rounding; never report a negative remainder
	const unclassified = Math.max(totalValue - classified, 0);

	return {
		rows: Array.from(exposures.entries())
			.map(([name, exposure]) => ({
				name,
				exposure: round(exposure, 2),
				percent: percentOf(exposure, totalValue)
			}))
			.sort((a, b) => b.exposure - a.exposure),
		unclassified: {
			exposure: round(unclassified, 2),
			percent: percentOf(unclassified, totalValue)
		}
	};
};

const computeFees = (
	priced: (PricedInput & { value: number })[],
	profiles: Map<string, FundProfile>,
	totalValue: number
): PortfolioBreakdown["fees"] => {
	let annual = 0;
	let complete = true;

	for (const input of priced) {
		if (input.kind === "stock") {
			continue;
		}

		const expenseRatio = profiles.get(input.symbol)?.expenseRatio ?? null;

		if (expenseRatio === null) {
			complete = false;
			continue;
		}

		annual += (input.value * expenseRatio) / 100;
	}

	return {
		annual: round(annual, 2),
		expenseRatio: totalValue > 0 ? round((annual / totalValue) * 100, 4) : 0,
		complete
	};
};

const computeIncome = (
	priced: (PricedInput & { value: number })[],
	profiles: Map<string, FundProfile>,
	totalValue: number
): PortfolioBreakdown["income"] => {
	let annual = 0;
	let covered = 0;

	for (const input of priced) {
		const distributionYield = profiles.get(input.symbol)?.distributionYield ?? null;

		if (distributionYield === null) {
			continue;
		}

		annual += (input.value * distributionYield) / 100;
		covered += input.value;
	}

	return {
		annual: round(annual, 2),
		yield: covered > 0 ? round((annual / covered) * 100, 4) : null,
		coveredPercent: percentOf(covered, totalValue)
	};
};

const computeValuation = (
	priced: (PricedInput & { value: number })[],
	profiles: Map<string, FundProfile>,
	totalValue: number
): PortfolioBreakdown["valuation"] => {
	const harmonic = (pick: (profile: FundProfile) => number | null) => {
		let weight = 0;
		let inverse = 0;

		for (const input of priced) {
			const profile = profiles.get(input.symbol);
			const ratio = profile ? pick(profile) : null;

			if (ratio !== null && ratio > 0) {
				weight += input.value;
				inverse += input.value / ratio;
			}
		}

		return { value: inverse > 0 ? round(weight / inverse, 2) : null, weight };
	};

	const earnings = harmonic((profile) => profile.priceToEarnings);
	const book = harmonic((profile) => profile.priceToBook);

	let capWeight = 0;
	let capSum = 0;

	for (const input of priced) {
		const cap = profiles.get(input.symbol)?.weightedAvgMarketCap ?? null;

		if (cap !== null && cap > 0) {
			capWeight += input.value;
			capSum += input.value * cap;
		}
	}

	return {
		priceToEarnings: earnings.value,
		priceToBook: book.value,
		weightedAvgMarketCap: capWeight > 0 ? Math.round(capSum / capWeight) : null,
		coveredPercent: percentOf(earnings.weight, totalValue)
	};
};

export const computeOverlap = (
	priced: PricedInput[],
	holdings: Map<string, EtfHoldingsRecord>
): PortfolioBreakdown["overlap"] => {
	const funds = priced
		.filter((input) => {
			const record = holdings.get(input.symbol);
			return record?.status === "etf" && record.holdings.length > 0;
		})
		.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
		.map((input) => input.symbol);

	// By security, not ticker: VTI's MRK (Merck & Co.) is not VXUS's MRK (Merck KGaA)
	const held = new Map(
		funds.map((fund) => [
			fund,
			new Set(holdings.get(fund)!.holdings.map((holding) => holding.key))
		])
	);

	const matrix = funds.map((row) =>
		funds.map((column) => {
			if (row === column) {
				return null;
			}

			const columnHolds = held.get(column)!;
			const shared = holdings
				.get(row)!
				.holdings.reduce(
					(sum, holding) => (columnHolds.has(holding.key) ? sum + holding.weight : sum),
					0
				);

			return round(Math.min(shared, 100), 2);
		})
	);

	return { funds, matrix };
};

/**
 * Growth of $10,000 holding today's mix, rebalanced monthly, from each fund's
 * growth-of-$10k series. Directly held stocks have no history here and are left out.
 */
export const computeBacktest = (
	priced: (PricedInput & { value: number })[],
	profiles: Map<string, FundProfile>,
	totalValue: number
): Backtest | null => {
	const series = priced
		.map((input) => {
			const growth = profiles.get(input.symbol)?.growth ?? [];
			const byMonth = new Map(growth.map((point) => [point.date.slice(0, 7), point.value]));
			return { symbol: input.symbol, value: input.value, byMonth };
		})
		.filter((fund) => fund.byMonth.size >= 2);

	if (series.length === 0) {
		return null;
	}

	const coveredValue = series.reduce((sum, fund) => sum + fund.value, 0);
	const weights = series.map((fund) => fund.value / coveredValue);

	const months = Array.from(series[0].byMonth.keys())
		.filter((month) => series.every((fund) => fund.byMonth.has(month)))
		.sort();

	if (months.length < 2) {
		return null;
	}

	const firstMonths = series.map((fund) => Array.from(fund.byMonth.keys()).sort()[0]);
	const youngest = series[firstMonths.indexOf(firstMonths.reduce((a, b) => (a > b ? a : b)))];

	const points = [{ month: months[0], value: 10000 }];
	let value = 10000;

	for (let index = 1; index < months.length; index += 1) {
		const previous = months[index - 1];
		const current = months[index];
		const monthReturn = series.reduce(
			(sum, fund, fundIndex) =>
				sum +
				weights[fundIndex] * (fund.byMonth.get(current)! / fund.byMonth.get(previous)! - 1),
			0
		);

		value *= 1 + monthReturn;
		points.push({ month: current, value: round(value, 2) });
	}

	const years = monthsBetween(months[0], months[months.length - 1]) / 12;

	return {
		start: months[0],
		end: months[months.length - 1],
		points,
		annualizedReturn:
			years >= 1 ? round((Math.pow(value / 10000, 1 / years) - 1) * 100, 2) : null,
		limitedBy: youngest.symbol,
		coveredPercent: percentOf(coveredValue, totalValue)
	};
};

const monthsBetween = (from: string, to: string) => {
	const [fromYear, fromMonth] = from.split("-").map(Number);
	const [toYear, toMonth] = to.split("-").map(Number);
	return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

const percentOf = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100, 4) : 0);

const round = (value: number, decimals: number) => {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
};
