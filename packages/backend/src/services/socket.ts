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
	initListSubscriptions
} from "@services/list-subscriptions";

type AuthedSocket = Socket & {
	data: {
		userId: number;
		email: string;
		role: string;
	};
};

let io: SocketIOServer | null = null;

export const getSocketIO = (): SocketIOServer | null => {
	return io;
};

export const initSocketServer = (server: HttpServer) => {
	io = new SocketIOServer(server, {
		cors: {
			origin: config.origin || true,
			credentials: true
		}
	});

	io.use(authenticateSocket);
	io.on("connection", registerSocketHandlers);

	// Initialize list subscriptions (which will subscribe to quote updates)
	initListSubscriptions();

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

	socket.on("list:subscribe", async (data: { listId?: string }) => {
		const { listId } = data;

		if (!listId || typeof listId !== "string") {
			socket.emit("error", { message: "Invalid listId" });
			return;
		}

		// Join room for this list
		const roomName = `list:${listId}`;
		socket.join(roomName);

		try {
			await subscribeToList(listId, socket.id, socket.data.userId);
		} catch (error) {
			logger.error(
				`[socket] Failed to subscribe to list ${listId}: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
			socket.leave(roomName);
			socket.emit("error", { message: "Failed to subscribe to list" });
		}
	});

	socket.on("list:unsubscribe", (data: { listId?: string }) => {
		const { listId } = data;

		if (!listId || typeof listId !== "string") {
			return;
		}

		// Leave room for this list
		const roomName = `list:${listId}`;
		socket.leave(roomName);

		unsubscribeFromList(listId, socket.id);
	});

	socket.on("disconnect", () => {
		logger.info(`[socket] user ${socket.data.userId} disconnected`);
		unsubscribeSocket(socket.id);
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
