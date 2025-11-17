import { type Request, type Response, type NextFunction, Router } from "express";
import bcrypt from "bcrypt";
import db from "@db";
import logger from "@logger";
import { HttpError } from "@utils/error";
import { generateToken, setAuthCookie } from "./_shared";

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { email, password, username } = req.body ?? {};

		if (!email || !password) {
			throw new HttpError("Email and password are required", 400);
		}

		if (!username) {
			throw new HttpError("Username is required", 400);
		}

		if (password.length < 8) {
			throw new HttpError("Password must be at least 8 characters long", 400);
		}

		const [existingUserByEmail, existingUserByUsername] = await Promise.all([
			db.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst(),
			db.selectFrom("users").selectAll().where("username", "=", username).executeTakeFirst()
		]);

		if (existingUserByEmail) {
			throw new HttpError("Email already registered", 409);
		}

		if (existingUserByUsername) {
			throw new HttpError("Username already taken", 409);
		}

		const hashedPassword = await bcrypt.hash(password, 10);

		const newUser = await db
			.insertInto("users")
			.values({
				email,
				username,
				password: hashedPassword,
				role: "user",
				avatar: null
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		const token = generateToken(newUser.id, newUser.email, newUser.role);
		setAuthCookie(res, token);

		logger.info(`[auth] User signed up: ${email}`);

		res.status(201).json({
			message: "Account created successfully",
			user: {
				id: newUser.id,
				email: newUser.email,
				username: newUser.username,
				role: newUser.role,
				avatar: newUser.avatar
			}
		});
	} catch (error) {
		next(error);
	}
});

export default router;
