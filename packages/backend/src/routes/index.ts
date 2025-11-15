import { Router } from "express";
import { HttpError } from "@utils/error";
import etf from "./etf";
import list from "./list";

const router = Router();

router.use("/api/etf", etf);
router.use("/api/list", list);

router.get("*", (req, res, next) => {
	next(new HttpError(`Route ${req.method}:${req.path} not found`, 404));
});

export default router;
