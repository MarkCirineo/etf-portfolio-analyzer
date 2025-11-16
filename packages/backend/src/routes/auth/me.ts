import { type Request, type Response, type NextFunction, Router } from "express";
import db from "@db";
import { HttpError } from "@utils/error";
import { verifyToken } from "./_shared";

const router = Router();

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const token = req.cookies?.token;
		if (!token) {
			// TODO: i dont want to log this error because it's normal for the user to not be authenticated
			throw new HttpError("Not authenticated", 401);
		}

		const decoded = verifyToken(token);

		const user = await db
			.selectFrom("users")
			.select(["id", "email", "username", "role", "avatar"])
			.where("id", "=", decoded.userId)
			.executeTakeFirst();

		if (!user) {
			throw new HttpError("User not found", 404);
		}

		res.status(200).json({
			user: {
				id: user.id,
				email: user.email,
				username: user.username,
				role: user.role,
				avatar: user.avatar
			}
		});
	} catch (error) {
		next(error);
	}
});

export default router;
