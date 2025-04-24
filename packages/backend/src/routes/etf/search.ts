import { finnhubSearch } from "@api/finnhub";
import { HttpError } from "@utils/error";
import { Request, Router } from "express";

const router = Router();

type QueryParams = {
	q: string;
};

router.get("/", async (req: Request<{}, {}, {}, QueryParams>, res, next) => {
	const { q } = req.query;

	if (!q) {
		next(new HttpError("Query parameter 'q' is required", 400));
	}

	try {
		const finnhubData = await finnhubSearch(q);

		if (!finnhubData) {
			next(new HttpError("No data found", 404));
		}

		res.status(200).send({ data: finnhubData });
	} catch (error) {
		next(new HttpError("Error fetching data", 500));
	}
});

export default router;
