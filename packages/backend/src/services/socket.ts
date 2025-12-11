import { Server as HttpServer } from "node:http";

import { Server as SocketIOServer, type Socket } from "socket.io";
import cookie from "cookie";

import config from "@config";
import logger from "@logger";
import { verifyToken } from "@routes/auth/_shared";
import { subscribeToQuoteJob } from "@services/quote-jobs";

type AuthedSocket = Socket & {
	data: {
		userId: number;
		email: string;
		role: string;
	};
};

let io: SocketIOServer | null = null;

export const initSocketServer = (server: HttpServer) => {
	io = new SocketIOServer(server, {
		cors: {
			origin: config.origin || true,
			credentials: true
		}
	});

	io.use(authenticateSocket);
	io.on("connection", registerSocketHandlers);

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

	const subscriptions = new Map<string, () => void>();

	socket.on("job:subscribe", ({ jobId, listId }: { jobId?: string; listId?: string } = {}) => {
		if (!jobId || !listId) {
			socket.emit("job:error", { message: "jobId and listId are required" });
			return;
		}

		try {
			if (subscriptions.has(jobId)) {
				socket.emit("job:subscribed", { jobId });
				return;
			}

			const unsubscribe = subscribeToQuoteJob(jobId, socket.data.userId, listId, (payload) => {
				socket.emit("job:update", payload);
			});

			subscriptions.set(jobId, unsubscribe);
			socket.emit("job:subscribed", { jobId });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to subscribe to job";
			socket.emit("job:error", { message });
		}
	});

	socket.on("job:unsubscribe", ({ jobId }: { jobId?: string } = {}) => {
		if (!jobId) {
			return;
		}

		const unsubscribe = subscriptions.get(jobId);
		unsubscribe?.();
		subscriptions.delete(jobId);
	});

	socket.on("disconnect", () => {
		logger.info(`[socket] user ${socket.data.userId} disconnected`);
		for (const unsubscribe of subscriptions.values()) {
			unsubscribe();
		}
		subscriptions.clear();
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
