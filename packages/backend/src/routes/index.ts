import { Router } from "express";
import { HttpError } from "@utils/error";

const router = Router();

router.get("*", (req, res, next) => {
	next(new HttpError(`Route ${req.method}:${req.path} not found`, 404));
});

export default router;
