import { Router } from "express";
import logger from "@logger";

type AuthAction = "login" | "signup" | "logout";

type PlaceholderResponse = {
	action: AuthAction;
	status: "NOT_IMPLEMENTED";
	message: string;
	timestamp: string;
	email?: string;
};

const authRouter = Router();

const buildResponse = (action: AuthAction, email?: string | null): PlaceholderResponse => {
	const payload: PlaceholderResponse = {
		action,
		status: "NOT_IMPLEMENTED",
		message: `The ${action} route has been scaffolded but not implemented yet.`,
		timestamp: new Date().toISOString()
	};

	if (email) {
		payload.email = email;
	}

	return payload;
};

authRouter.post("/login", (req, res) => {
	const { email } = req.body ?? {};

	logger.info(`[auth] Login requested${email ? ` for ${email}` : ""}`);

	return res.status(200).json(buildResponse("login", email));
});

authRouter.post("/signup", (req, res) => {
	const { email } = req.body ?? {};

	logger.info(`[auth] Signup requested${email ? ` for ${email}` : ""}`);

	return res.status(201).json(buildResponse("signup", email));
});

authRouter.post("/logout", (req, res) => {
	logger.info("[auth] Logout requested");

	return res.status(200).json(buildResponse("logout"));
});

export default authRouter;
