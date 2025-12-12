import Redis, { type RedisOptions } from "ioredis";

import config from "@config";
import logger from "@logger";

type RedisJSON = Record<string, unknown>;
type MessageHandler = (message: string) => void;
type RedisConfig = {
	url?: string;
	host?: string;
	port?: number;
	password?: string;
	db?: number;
	keyPrefix?: string;
	tls?: boolean;
};

let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;

const buildRedisOptions = (): RedisOptions => {
	const redisConfig: RedisConfig = config.redis ?? {};

	const options: RedisOptions = {
		host: redisConfig.host ?? "127.0.0.1",
		port: redisConfig.port ?? 6379,
		db: redisConfig.db ?? 0,
		keyPrefix: redisConfig.keyPrefix,
		lazyConnect: false,
		autoResubscribe: true,
		enableReadyCheck: true,
		maxRetriesPerRequest: null,
		retryStrategy: (times) => Math.min(1000 * times, 5000)
	};

	if (redisConfig.password) {
		options.password = redisConfig.password;
	}

	if (redisConfig.tls) {
		options.tls = {};
	}

	return options;
};

const createRedisInstance = (): Redis => {
	const redisConfig: RedisConfig = config.redis ?? {};
	let instance: Redis;

	if (redisConfig.url) {
		instance = new Redis(redisConfig.url, {
			keyPrefix: redisConfig.keyPrefix,
			lazyConnect: false,
			autoResubscribe: true,
			enableReadyCheck: true,
			maxRetriesPerRequest: null,
			retryStrategy: (times) => Math.min(1000 * times, 5000)
		});
	} else {
		instance = new Redis(buildRedisOptions());
	}

	instance.on("error", (error) => {
		logger.error(`[redis] ${error.message}`);
	});

	instance.on("reconnecting", () => {
		logger.warn("[redis] reconnecting...");
	});

	instance.on("connect", () => {
		logger.info("[redis] connected");
	});

	return instance;
};

export const getRedisClient = (): Redis => {
	if (!redisClient) {
		redisClient = createRedisInstance();
	}

	return redisClient;
};

export const getRedisSubscriber = async (): Promise<Redis> => {
	if (!redisSubscriber) {
		redisSubscriber = getRedisClient().duplicate();
		await redisSubscriber.connect();
	}

	return redisSubscriber;
};

export const redisGetJSON = async <T extends RedisJSON>(key: string): Promise<T | null> => {
	const client = getRedisClient();
	const payload = await client.get(key);

	if (!payload) {
		return null;
	}

	try {
		return JSON.parse(payload) as T;
	} catch (error) {
		logger.warn(`[redis] Failed to parse JSON for key ${key}: ${String(error)}`);
		return null;
	}
};

export const redisSetJSON = async (key: string, value: RedisJSON, ttlMs?: number) => {
	const client = getRedisClient();
	const serialized = JSON.stringify(value);

	if (ttlMs && ttlMs > 0) {
		await client.set(key, serialized, "PX", ttlMs);
		return;
	}

	await client.set(key, serialized);
};

export const publishMessage = async (channel: string, payload: RedisJSON) => {
	const client = getRedisClient();
	await client.publish(channel, JSON.stringify(payload));
};

export const subscribeToChannel = async (
	channel: string,
	handler: MessageHandler
): Promise<() => Promise<void>> => {
	const subscriber = await getRedisSubscriber();

	const listener = (incomingChannel: string, message: string) => {
		if (incomingChannel === channel) {
			handler(message);
		}
	};

	subscriber.on("message", listener);
	await subscriber.subscribe(channel);

	return async () => {
		subscriber.off("message", listener);
	};
};

export const disconnectRedis = async () => {
	if (redisSubscriber) {
		await redisSubscriber.quit();
		redisSubscriber = null;
	}

	if (redisClient) {
		await redisClient.quit();
		redisClient = null;
	}
};
