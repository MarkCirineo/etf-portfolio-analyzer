import { Server as HttpServer } from "node:http";

import { Server as SocketIOServer, type Socket } from "socket.io";
import cookie from "cookie";

import config from "@config";
import logger from "@logger";
import { verifyToken } from "@routes/auth/_shared";
import {
	subscribeToList,
	unsubscribeFromList,
	unsubscribeSocket,
	initListSubscriptions,
	subscriptionKey
} from "@services/list-subscriptions";

type AuthedSocket = Socket & {
	data: {
		userId: number;
		email: string;
		role: string;
	};
};

export const initSocketServer = (server: HttpServer) => {
	const io = new SocketIOServer(server, {
		cors: {
			origin: config.origin || true,
			credentials: true
		}
	});

	io.use(authenticateSocket);
	io.on("connection", registerSocketHandlers);

	// List subscriptions relay quote updates to sockets in each list's room
	initListSubscriptions(io);

	logger.info("[socket] Socket.io server initialized");
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

	// `accounts` narrows the analysis to some of the list's accounts; each scope is its own room
	socket.on("list:subscribe", async (data: ListSubscription) => {
		const { listId, scope } = parseSubscription(data);

		if (!listId) {
			socket.emit("error", { message: "Invalid listId" });
			return;
		}

		try {
			const key = await subscribeToList(listId, scope, socket.id, socket.data.userId);

			if (!key) {
				socket.emit("error", { message: "Failed to subscribe to list" });
				return;
			}

			socket.join(`list:${key}`);
		} catch (error) {
			logger.error(
				`[socket] Failed to subscribe to list ${listId}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			socket.emit("error", { message: "Failed to subscribe to list" });
		}
	});

	socket.on("list:unsubscribe", (data: ListSubscription) => {
		const { listId, scope } = parseSubscription(data);

		if (!listId) {
			return;
		}

		const key = subscriptionKey(listId, scope);
		socket.leave(`list:${key}`);
		unsubscribeFromList(key, socket.id);
	});

	socket.on("disconnect", () => {
		logger.info(`[socket] user ${socket.data.userId} disconnected`);
		unsubscribeSocket(socket.id);
	});
};

type ListSubscription = { listId?: unknown; accounts?: unknown } | undefined;

const parseSubscription = (data: ListSubscription) => {
	const listId = typeof data?.listId === "string" && data.listId ? data.listId : null;
	const raw = data?.accounts;
	const accounts: unknown[] = Array.isArray(raw) ? raw : [];
	const scope = accounts.filter((id): id is string => typeof id === "string" && id.length > 0);

	return { listId, scope: scope.length > 0 ? scope : null };
};

const extractToken = (socket: Socket): string | undefined => {
	const cookieHeader = socket.handshake.headers.cookie;

	if (!cookieHeader) {
		return undefined;
	}

	const parsed = cookie.parse(cookieHeader);
	return parsed.token;
};
