import { Server as HttpServer } from "node:http";

import { Server as SocketIOServer, type Socket } from "socket.io";
import cookie from "cookie";

import config from "@config";
import logger from "@logger";
import { verifyToken } from "@routes/auth/_shared";
import { subscribeToQuoteUpdates } from "@services/quote-cache";

type AuthedSocket = Socket & {
	data: {
		userId: number;
		email: string;
		role: string;
	};
};

let io: SocketIOServer | null = null;
let unsubscribeQuoteUpdates: (() => Promise<void>) | null = null;

export const initSocketServer = (server: HttpServer) => {
	io = new SocketIOServer(server, {
		cors: {
			origin: config.origin || true,
			credentials: true
		}
	});

	io.use(authenticateSocket);
	io.on("connection", registerSocketHandlers);
	registerQuoteBroadcast();

	logger.info("[socket] Socket.io server initialized");
};

const registerQuoteBroadcast = () => {
	if (!io || unsubscribeQuoteUpdates) {
		return;
	}

	void subscribeToQuoteUpdates((payload) => {
		io?.emit("quote:update", payload);
	})
		.then((unsubscribe) => {
			unsubscribeQuoteUpdates = unsubscribe;
		})
		.catch((error) => {
			logger.error(
				`[socket] Failed to subscribe to quote updates: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		});
};

const authenticateSocket: Parameters<SocketIOServer["use"]>[0] = (socket, next) => {
	try {
		const token = extractToken(socket);

		if (!token) {
			return next(new Error("Not authenticated"));
		}

		const decoded = verifyToken(token);
		socket.data.userId = decoded.userId;
		socket.data.email = decoded.email;
		socket.data.role = decoded.role;

		next();
	} catch (error) {
		next(error instanceof Error ? error : new Error("Authentication failed"));
	}
};

const registerSocketHandlers = (socket: AuthedSocket) => {
	logger.info(`[socket] user ${socket.data.userId} connected`);

	socket.on("disconnect", () => {
		logger.info(`[socket] user ${socket.data.userId} disconnected`);
	});
};

const extractToken = (socket: Socket): string | undefined => {
	const cookieHeader = socket.handshake.headers.cookie;

	if (!cookieHeader) {
		return undefined;
	}

	const parsed = cookie.parse(cookieHeader);
	return parsed.token;
};
