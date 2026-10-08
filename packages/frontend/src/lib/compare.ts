import type { AnalyzedHolding, BreakdownSet, ListAnalysis } from "$lib/types";

export type SetChange = { name: string; base: number; scenario: number; delta: number };

/** Each row's share of the portfolio before and after, in percentage points. */
export const compareSets = (base: BreakdownSet, scenario: BreakdownSet): SetChange[] => {
	const names = new Set([...base.rows, ...scenario.rows].map((row) => row.name));
	const percentOf = (set: BreakdownSet, name: string) =>
		set.rows.find((row) => row.name === name)?.percent ?? 0;

	return Array.from(names)
		.map((name) => {
			const before = percentOf(base, name);
			const after = percentOf(scenario, name);
			return { name, base: before, scenario: after, delta: after - before };
		})
		.sort((a, b) => a.delta - b.delta);
};

export type InputChange = {
	symbol: string;
	base: number | null;
	scenario: number | null;
	status: "unchanged" | "added" | "removed" | "changed";
};

/** The user's own funds and stocks, by dollar value, in either portfolio. */
export const compareInputs = (base: ListAnalysis, scenario: ListAnalysis): InputChange[] => {
	const symbols = new Set([...base.inputs, ...scenario.inputs].map((input) => input.symbol));
	const valueIn = (analysis: ListAnalysis, symbol: string) =>
		analysis.inputs.find((input) => input.symbol === symbol)?.value ?? null;

	return Array.from(symbols)
		.map((symbol) => {
			const before = valueIn(base, symbol);
			const after = valueIn(scenario, symbol);
			const status: InputChange["status"] =
				before === null
					? "added"
					: after === null
						? "removed"
						: Math.abs(after - before) < 0.5
							? "unchanged"
							: "changed";
			return { symbol, base: before, scenario: after, status };
		})
		.sort(
			(a, b) =>
				Math.max(b.base ?? 0, b.scenario ?? 0) - Math.max(a.base ?? 0, a.scenario ?? 0)
		);
};

export type HoldingChange = {
	id: string;
	symbol: string;
	name: string | null;
	base: number;
	scenario: number;
	delta: number;
};

/**
 * Underlying securities whose share of the portfolio moves most, in percentage points.
 * Only the returned top holdings of each side are compared, so tiny positions that drop
 * off the end read as zero.
 */
export const compareHoldings = (base: ListAnalysis, scenario: ListAnalysis) => {
	const byId = new Map<string, { holding: AnalyzedHolding; base: number; scenario: number }>();

	for (const holding of base.holdings) {
		byId.set(holding.id, { holding, base: holding.percentOfPortfolio, scenario: 0 });
	}

	for (const holding of scenario.holdings) {
		const entry = byId.get(holding.id);
		if (entry) {
			entry.scenario = holding.percentOfPortfolio;
		} else {
			byId.set(holding.id, { holding, base: 0, scenario: holding.percentOfPortfolio });
		}
	}

	const changes: HoldingChange[] = Array.from(byId.values()).map((entry) => ({
		id: entry.holding.id,
		symbol: entry.holding.symbol,
		name: entry.holding.name,
		base: entry.base,
		scenario: entry.scenario,
		delta: entry.scenario - entry.base
	}));

	return {
		shrink: changes
			.filter((change) => change.delta < -0.005)
			.sort((a, b) => a.delta - b.delta)
			.slice(0, 6),
		grow: changes
			.filter((change) => change.delta > 0.005)
			.sort((a, b) => b.delta - a.delta)
			.slice(0, 6)
	};
};
