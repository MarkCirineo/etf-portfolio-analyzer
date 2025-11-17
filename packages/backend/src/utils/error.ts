import { NextFunction, Request, Response } from "express";
import logger from "@logger";
import { statuses } from "@/utils/constants";

export class HttpError extends Error {
	statusCode: number;
	skipLogging?: boolean;

	constructor(message: string, statusCode?: number, skipLogging?: boolean) {
		super(message);
		this.statusCode = statusCode ?? 500;
		this.skipLogging = skipLogging ?? false;
	}
}

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
	let status = 500;

	if (err instanceof HttpError) {
		status = err.statusCode;
	}

	if (!(err instanceof HttpError) || !err.skipLogging) {
		logger.error(err);
	}

	res.status(status).send({
		error: statuses[status],
		message: err.message
	});
};
