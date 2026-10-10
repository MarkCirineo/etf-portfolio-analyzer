import { type Request, type Response, type NextFunction, Router } from "express";
import bcrypt from "bcrypt";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { generateToken, setAuthCookie } from "./_shared";

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
	try {
		// `login` is an email or a username; `email` is what older clients send
		const { email, password } = req.body ?? {};
		const login = String(req.body?.login ?? email ?? "").trim();

		if (!login || !password) {
			throw new HttpError("Email or username and password are required", 400);
		}

		// Usernames can't contain "@", so the two never collide
		const user = await db
			.selectFrom("users")
			.selectAll()
			.where(login.includes("@") ? "email" : "username", "=", login)
			.executeTakeFirst();

		if (!user) {
			throw new HttpError("Invalid login or password", 401);
		}

		const isPasswordValid = await bcrypt.compare(password, user.password);
		if (!isPasswordValid) {
			throw new HttpError("Invalid login or password", 401);
		}

		const token = generateToken(user.id, user.email, user.role);
		setAuthCookie(res, token);

		logger.info(`[auth] User logged in: ${user.email}`);

		res.status(200).json({
			message: "Login successful",
			user: {
				id: user.publicId,
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
