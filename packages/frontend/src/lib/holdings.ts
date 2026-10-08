/** One holding being edited: shares stay text until saved, so typing "1." works. */
export type HoldingRow = { symbol: string; shares: string };

/** Shares typed by the user, or null if they are not a number of zero or more. */
export const parseShares = (value: string) => {
	const shares = Number(value.replace(/,/g, "").trim());
	return value.trim() !== "" && Number.isFinite(shares) && shares >= 0 ? shares : null;
};

export const toRows = (holdings: Record<string, number>, prices: Map<string, number>) =>
	Object.entries(holdings)
		.sort((a, b) => (prices.get(b[0]) ?? 0) * b[1] - (prices.get(a[0]) ?? 0) * a[1])
		.map(([symbol, shares]): HoldingRow => ({ symbol, shares: String(shares) }));

export const rowValue = (row: HoldingRow, prices: Map<string, number>) => {
	const shares = parseShares(row.shares);
	const price = prices.get(row.symbol);
	return shares !== null && price !== undefined ? shares * price : null;
};

export const rowsValue = (rows: HoldingRow[], prices: Map<string, number>) =>
	rows.reduce((sum, row) => sum + (rowValue(row, prices) ?? 0), 0);

/** The holdings to save, or the first row whose shares are not a valid number. */
export const toHoldings = (
	rows: HoldingRow[]
): { holdings: Record<string, number> } | { invalid: string } => {
	const holdings: Record<string, number> = {};

	for (const row of rows) {
		const shares = parseShares(row.shares);

		if (shares === null) {
			return { invalid: row.symbol };
		}

		holdings[row.symbol] = shares;
	}

	return { holdings };
};
