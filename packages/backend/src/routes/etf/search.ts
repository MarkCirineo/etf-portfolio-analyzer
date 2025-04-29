import { finnhubSearch } from "@api/finnhub";
import { HttpError } from "@utils/error";
import { Request, Router } from "express";

const router = Router();

type QueryParams = {
	q: string;
};

type FinnhubSearchResponse = {
	count: number;
	result: {
		symbol: string;
		displaySymbol: string;
		description: string;
		type: string;
	}[];
};

router.get("/", async (req: Request<{}, {}, {}, QueryParams>, res, next) => {
	const { q } = req.query;

	if (!q) {
		next(new HttpError("Query parameter 'q' is required", 400));
	}

	try {
		const finnhubData: FinnhubSearchResponse = await finnhubSearch(q);

		if (!finnhubData) {
			next(new HttpError("No data found", 404));
		}

		const sortedData = finnhubData.result.sort((a, b) => {
			const queryLower = q.toLowerCase();

			// Prioritize exact matches in the symbol field
			const aSymbolExact = a.symbol.toLowerCase() === queryLower;
			const bSymbolExact = b.symbol.toLowerCase() === queryLower;
			if (aSymbolExact && !bSymbolExact) return -1;
			if (!aSymbolExact && bSymbolExact) return 1;

			// Then prioritize exact matches in other fields
			const aExactMatch = [a.displaySymbol, a.description].some(
				(field) => field.toLowerCase() === queryLower
			);
			const bExactMatch = [b.displaySymbol, b.description].some(
				(field) => field.toLowerCase() === queryLower
			);
			if (aExactMatch && !bExactMatch) return -1;
			if (!aExactMatch && bExactMatch) return 1;

			// Then prioritize partial matches in the symbol field
			const aSymbolContains = a.symbol.toLowerCase().includes(queryLower);
			const bSymbolContains = b.symbol.toLowerCase().includes(queryLower);
			if (aSymbolContains && !bSymbolContains) return -1;
			if (!aSymbolContains && bSymbolContains) return 1;

			// Finally, prioritize partial matches in other fields
			const aContains = [a.displaySymbol, a.description].some((field) =>
				field.toLowerCase().includes(queryLower)
			);
			const bContains = [b.displaySymbol, b.description].some((field) =>
				field.toLowerCase().includes(queryLower)
			);
			if (aContains && !bContains) return -1;
			if (!aContains && bContains) return 1;

			return 0;
		});

		res.status(200).send({ data: { count: finnhubData.count, result: sortedData } });
	} catch (error) {
		next(new HttpError("Error fetching data", 500));
	}
});

export default router;
