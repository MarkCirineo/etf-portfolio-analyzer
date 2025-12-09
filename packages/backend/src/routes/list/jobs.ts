import { Router, type Request, type Response, type NextFunction } from "express";
import db from "@db";
import { HttpError } from "@utils/error";
import { resolveOwnerId } from "./_shared";
import {
	startQuoteJob,
	getQuoteJobPayload,
	subscribeToQuoteJob,
	assertJobOwnership
} from "@services/quote-jobs";

const router = Router();

const ensureJobAccess = (jobId: string, ownerId: number, listPublicId: string) => {
	try {
		return assertJobOwnership(jobId, ownerId, listPublicId);
	} catch (error) {
		if (error instanceof Error && error.message === "Job not found") {
			throw new HttpError("Job not found", 404);
		}

		throw new HttpError("Not authorized to access this job", 403);
	}
};

router.post(
	"/:publicId/analysis/jobs",
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const ownerId = resolveOwnerId(req);
			const publicId = req.params.publicId?.trim();

			if (!publicId) {
				throw new HttpError("List id is required", 400);
			}

			const list = await db
				.selectFrom("lists")
				.select(["publicId", "content", "ownerId"])
				.where("ownerId", "=", ownerId)
				.where("publicId", "=", publicId)
				.executeTakeFirst();

			if (!list) {
				throw new HttpError("List not found", 404);
			}

			const payload = await startQuoteJob({
				ownerId,
				listPublicId: list.publicId,
				content: list.content
			});

			if (!payload) {
				throw new HttpError("Failed to start quote job", 500);
			}

			res.status(201).send({
				data: payload
			});
		} catch (error) {
			if (error instanceof HttpError) {
				return next(error);
			}

			next(new HttpError("Failed to start analysis job", 500));
		}
	}
);

router.get(
	"/:publicId/analysis/jobs/:jobId",
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const ownerId = resolveOwnerId(req);
			const publicId = req.params.publicId?.trim();
			const jobId = req.params.jobId?.trim();

			if (!publicId || !jobId) {
				throw new HttpError("List id and job id are required", 400);
			}

			ensureJobAccess(jobId, ownerId, publicId);

			const payload = getQuoteJobPayload(jobId);

			if (!payload) {
				throw new HttpError("Job not found", 404);
			}

			res.status(200).send({
				data: payload
			});
		} catch (error) {
			if (error instanceof HttpError) {
				return next(error);
			}

			next(new HttpError("Failed to fetch job status", 500));
		}
	}
);

router.get(
	"/:publicId/analysis/jobs/:jobId/stream",
	async (req: Request, res: Response, next: NextFunction) => {
		try {
			const ownerId = resolveOwnerId(req);
			const publicId = req.params.publicId?.trim();
			const jobId = req.params.jobId?.trim();

			if (!publicId || !jobId) {
				throw new HttpError("List id and job id are required", 400);
			}

			ensureJobAccess(jobId, ownerId, publicId);

			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders?.();

			const heartbeat = setInterval(() => {
				res.write(`:heartbeat ${Date.now()}\n\n`);
			}, 20000);

			const unsubscribe = subscribeToQuoteJob(jobId, ownerId, publicId, (payload) => {
				res.write(`data: ${JSON.stringify(payload)}\n\n`);

				if (payload.status === "completed" || payload.status === "failed") {
					clearInterval(heartbeat);
					unsubscribe();
					res.end();
				}
			});

			req.on("close", () => {
				clearInterval(heartbeat);
				unsubscribe();
			});
		} catch (error) {
			if (error instanceof HttpError) {
				return next(error);
			}

			next(new HttpError("Failed to stream job updates", 500));
		}
	}
);

export default router;
