import { type Request } from "express";
import { HttpError } from "@utils/error";
import { verifyToken } from "@routes/auth/_shared";
import type { ListContent } from "@db/tables/List";

export const resolveOwnerId = (req: Request): number => {
	const token = req.cookies?.token;

	if (!token) {
		throw new HttpError("Not authenticated", 401, true);
	}

	const decoded = verifyToken(token);

	return decoded.userId;
};

export const sanitizeHoldings = (holdings: Record<string, number | string>): ListContent => {
	if (!holdings || typeof holdings !== "object" || Array.isArray(holdings)) {
		throw new HttpError("Holdings must be an object of ticker symbols to share counts", 400);
	}

	const sanitized: ListContent = {};

	for (const [rawTicker, rawShares] of Object.entries(holdings)) {
		const ticker = rawTicker.trim().toUpperCase();

		if (!ticker) {
			continue;
		}

		const shares =
			typeof rawShares === "number" ? rawShares : Number((rawShares ?? "").toString());

		if (!Number.isFinite(shares) || shares < 0) {
			throw new HttpError("Shares must be a non-negative number", 400);
		}

		sanitized[ticker] = shares;
	}

	if (Object.keys(sanitized).length === 0) {
		throw new HttpError("Provide at least one holding to save a list", 400);
	}

	return sanitized;
};
