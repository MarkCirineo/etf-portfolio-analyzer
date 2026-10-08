import type { BreakdownSet } from "$lib/types";

/**
 * Sector rows as shares of what could be classified, so they add to 100% like a fund
 * factsheet's. `coveredPercent` is how much of the portfolio that is.
 */
export const classifiedShares = (set: BreakdownSet) => {
	const covered = set.rows.reduce((sum, row) => sum + row.percent, 0);

	return {
		coveredPercent: covered,
		rows: set.rows.map((row) => ({
			...row,
			percent: covered > 0 ? (row.percent / covered) * 100 : 0
		}))
	};
};

/** The same set with its rows rescaled to shares of the classified part. */
export const asClassifiedSet = (set: BreakdownSet): BreakdownSet => ({
	rows: classifiedShares(set).rows,
	unclassified: { exposure: 0, percent: 0 }
});
