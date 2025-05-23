import { Router } from "express";
import { HttpError } from "@utils/error";
import etf from "./etf";

const router = Router();

router.use("/api/etf", etf);

router.get("*", (req, res, next) => {
	next(new HttpError(`Route ${req.method}:${req.path} not found`, 404));
});

export default router;
