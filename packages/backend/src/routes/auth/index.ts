import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import ms from "ms";
import logger from "@logger";
import db from "@db";
import config from "@config";
import { HttpError } from "@utils/error";

const router = Router();

// Helper function to generate JWT token
const generateToken = (userId: number, email: string, role: string): string => {
	return jwt.sign({ userId, email, role }, config.jwt_secret, {
		expiresIn: config.jwt_expires_in as ms.StringValue
	});
};

// Helper function to set JWT cookie
const setAuthCookie = (res: any, token: string) => {
	res.cookie("auth_token", token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
	});
};

// Signup route
router.post("/signup", async (req, res, next) => {
	try {
		const { email, password, username } = req.body ?? {};

		// Validation
		if (!email || !password) {
			throw new HttpError("Email and password are required", 400);
		}

		if (!username) {
			throw new HttpError("Username is required", 400);
		}

		if (password.length < 8) {
			throw new HttpError("Password must be at least 8 characters long", 400);
		}

		// Check if user already exists
		const existingUserByEmail = await db
			.selectFrom("users")
			.selectAll()
			.where("email", "=", email)
			.executeTakeFirst();

		const existingUserByUsername = await db
			.selectFrom("users")
			.selectAll()
			.where("username", "=", username)
			.executeTakeFirst();

		const existingUser = existingUserByEmail || existingUserByUsername;

		if (existingUser) {
			throw new HttpError(
				existingUser.email === email
					? "Email already registered"
					: "Username already taken",
				409
			);
		}

		// Hash password
		const saltRounds = 10;
		const hashedPassword = await bcrypt.hash(password, saltRounds);

		// Create user
		const newUser = await db
			.insertInto("users")
			.values({
				email,
				username,
				password: hashedPassword,
				role: "user"
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		// Generate JWT token
		const token = generateToken(newUser.id, newUser.email, newUser.role);

		// Set httpOnly cookie
		setAuthCookie(res, token);

		logger.info(`[auth] User signed up: ${email}`);

		res.status(201).json({
			message: "Account created successfully",
			user: {
				id: newUser.id,
				email: newUser.email,
				username: newUser.username,
				role: newUser.role
			}
		});
	} catch (error) {
		next(error);
	}
});

// Login route
router.post("/login", async (req, res, next) => {
	try {
		const { email, password } = req.body ?? {};

		// Validation
		if (!email || !password) {
			throw new HttpError("Email and password are required", 400);
		}

		// Find user by email
		const user = await db
			.selectFrom("users")
			.selectAll()
			.where("email", "=", email)
			.executeTakeFirst();

		if (!user) {
			throw new HttpError("Invalid email or password", 401);
		}

		// Verify password
		const isPasswordValid = await bcrypt.compare(password, user.password);

		if (!isPasswordValid) {
			throw new HttpError("Invalid email or password", 401);
		}

		// Generate JWT token
		const token = generateToken(user.id, user.email, user.role);

		// Set httpOnly cookie
		setAuthCookie(res, token);

		logger.info(`[auth] User logged in: ${email}`);

		res.status(200).json({
			message: "Login successful",
			user: {
				id: user.id,
				email: user.email,
				username: user.username,
				role: user.role
			}
		});
	} catch (error) {
		next(error);
	}
});

// Logout route
router.post("/logout", (req, res) => {
	// Clear the auth cookie
	res.clearCookie("auth_token", {
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
