import { NextFunction, Request, Response } from "express";
import logger from "@logger";
import { statuses } from "@/utils/constants";

export class HttpError extends Error {
	statusCode: number;

	constructor(message: string, statusCode?: number) {
		super(message);
		this.statusCode = statusCode ?? 500;
	}
}

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
	let status = 500;

	if (err instanceof HttpError) {
		status = err.statusCode;
	}

	logger.error(err);

	res.status(status).send({
		error: statuses[status],
		message: err.message
	});
};
