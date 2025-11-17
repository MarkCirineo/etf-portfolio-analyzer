import { type Request, type Response, type NextFunction, Router } from "express";
import bcrypt from "bcrypt";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { generateToken, setAuthCookie } from "./_shared";

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
	console.log("login");

	try {
		const { email, password } = req.body ?? {};

		if (!email || !password) {
			throw new HttpError("Email and password are required", 400);
		}

		const user = await db
			.selectFrom("users")
			.selectAll()
			.where("email", "=", email)
			.executeTakeFirst();

		if (!user) {
			throw new HttpError("Invalid email or password", 401);
		}

		const isPasswordValid = await bcrypt.compare(password, user.password);
		if (!isPasswordValid) {
			throw new HttpError("Invalid email or password", 401);
		}

		const token = generateToken(user.id, user.email, user.role);
		setAuthCookie(res, token);

		logger.info(`[auth] User logged in: ${email}`);

		res.status(200).json({
			message: "Login successful",
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
