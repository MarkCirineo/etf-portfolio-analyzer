import { type Request, type Response, Router } from "express";
import logger from "@logger";

const router = Router();

router.post("/", (req: Request, res: Response) => {
	res.clearCookie("token", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict"
	});

	logger.info("[auth] User logged out");

	res.status(200).json({
		message: "Logged out successfully"
	});
});

export default router;
