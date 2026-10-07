import { FUND_COLORS, colorAt } from "$lib/accounts";
import type { AccountSummary, AnalyzedHolding, ListAnalysis } from "$lib/types";

/**
 * Each of the user's own funds and stocks gets a colour, largest first across every
 * account, so a fund keeps its colour whichever accounts are in view.
 */
export const symbolColors = (accounts: AccountSummary[], analysis: ListAnalysis) => {
	const values = new Map<string, number>();

	for (const account of accounts) {
		for (const position of account.positions) {
			values.set(position.symbol, (values.get(position.symbol) ?? 0) + (position.value ?? 0));
		}
	}

	for (const input of analysis.inputs) {
		if (!values.has(input.symbol)) {
			values.set(input.symbol, input.value ?? 0);
		}
	}

	const ordered = Array.from(values.entries()).sort((a, b) => b[1] - a[1]);
	return new Map(ordered.map(([symbol], index) => [symbol, colorAt(FUND_COLORS, index)]));
};

/** Dollar exposure held directly rather than through a fund. */
export const directExposure = (holding: AnalyzedHolding) =>
	Math.max(holding.exposure - holding.viaEtfs.reduce((sum, via) => sum + via.exposure, 0), 0);

/** The fund (or the direct position) that contributes most of a holding's exposure. */
export const mainSource = (holding: AnalyzedHolding) => {
	let source = holding.directShares > 0 ? holding.symbol : null;
	let largest = holding.directShares > 0 ? directExposure(holding) : -1;

	for (const via of holding.viaEtfs) {
		if (via.exposure > largest) {
			largest = via.exposure;
			source = via.etf;
		}
	}

	return source ?? holding.symbol;
};

export type AccountExposure = {
	account: AccountSummary;
	exposure: number;
	/** The funds in this account it comes through, or the symbol itself when held directly. */
	through: string[];
};

/**
 * Where a holding sits by account: each account's slice of the funds it comes through,
 * plus any shares of it the account holds directly.
 */
export const exposureByAccount = (
	holding: AnalyzedHolding,
	accounts: AccountSummary[]
): AccountExposure[] =>
	accounts.map((account) => {
		let exposure = 0;
		const through: string[] = [];

		for (const position of account.positions) {
			if (position.value === null) {
				continue;
			}

			const via = holding.viaEtfs.find((entry) => entry.etf === position.symbol);

			if (via) {
				exposure += (position.value * via.weight) / 100;
				through.push(position.symbol);
			} else if (position.symbol === holding.symbol && holding.directShares > 0) {
				exposure += position.value;
				through.push("held directly");
			}
		}

		return { account, exposure, through };
	});

export type Tile<T> = { item: T; x: number; y: number; width: number; height: number };

/**
 * Squarified treemap (Bruls, Huizing & van Wijk) over a width × height rectangle. Items
 * must be sorted largest first; the result keeps tiles close to square.
 */
export const squarify = <T>(
	items: T[],
	valueOf: (item: T) => number,
	width: number,
	height: number
): Tile<T>[] => {
	const total = items.reduce((sum, item) => sum + valueOf(item), 0);

	if (total <= 0) {
		return [];
	}

	const scale = (width * height) / total;
	const tiles: Tile<T>[] = [];
	let rect = { x: 0, y: 0, width, height };
	let row: T[] = [];

	const areaOf = (item: T) => valueOf(item) * scale;

	const worst = (candidate: T[], side: number) => {
		const areas = candidate.map(areaOf);
		const sum = areas.reduce((a, b) => a + b, 0);
		const max = Math.max(...areas);
		const min = Math.min(...areas);
		return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
	};

	const layoutRow = (members: T[]) => {
		const sum = members.reduce((total, item) => total + areaOf(item), 0);
		const horizontal = rect.width >= rect.height;

		if (horizontal) {
			// A column down the left edge
			const columnWidth = sum / rect.height;
			let y = rect.y;
			for (const item of members) {
				const tileHeight = areaOf(item) / columnWidth;
				tiles.push({ item, x: rect.x, y, width: columnWidth, height: tileHeight });
				y += tileHeight;
			}
			rect = { ...rect, x: rect.x + columnWidth, width: rect.width - columnWidth };
		} else {
			// A row along the top edge
			const rowHeight = sum / rect.width;
			let x = rect.x;
			for (const item of members) {
				const tileWidth = areaOf(item) / rowHeight;
				tiles.push({ item, x, y: rect.y, width: tileWidth, height: rowHeight });
				x += tileWidth;
			}
			rect = { ...rect, y: rect.y + rowHeight, height: rect.height - rowHeight };
		}
	};

	for (const item of items) {
		if (valueOf(item) <= 0) {
			continue;
		}

		const side = Math.min(rect.width, rect.height);

		if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
			row.push(item);
		} else {
			layoutRow(row);
			row = [item];
		}
	}

	if (row.length > 0) {
		layoutRow(row);
	}

	return tiles;
};
