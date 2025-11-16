import jwt from "jsonwebtoken";
import ms from "ms";
import config from "@config";
import { HttpError } from "@utils/error";

export type DecodedToken = {
	userId: number;
	email: string;
	role: string;
	exp: number;
	iat: number;
};

export const generateToken = (userId: number, email: string, role: string): string => {
	return jwt.sign({ userId, email, role }, config.jwt_secret, {
		expiresIn: config.jwt_expires_in as ms.StringValue
	});
};

export const verifyToken = (token: string): DecodedToken => {
	try {
		return jwt.verify(token, config.jwt_secret) as DecodedToken;
	} catch (error) {
		if (error instanceof jwt.TokenExpiredError) {
			throw new HttpError("Session expired. Please log in again.", 401);
		}

		throw new HttpError("Invalid authentication token", 401);
	}
};

export const setAuthCookie = (res: any, token: string) => {
	res.cookie("token", token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
	});
};
