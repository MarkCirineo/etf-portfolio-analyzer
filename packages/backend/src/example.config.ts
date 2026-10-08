/**
 * Copy to config.ts. Every setting can come from an environment variable, which is how the
 * Docker deployment supplies them (see .env.example at the repo root); for local
 * development you can also write values straight into the fallbacks below.
 */
const env = process.env;

export default {
	PORT: Number(env.PORT ?? 3100),
	finnhub_api_key: env.FINNHUB_API_KEY ?? "",
	alpha_vantage_api_key: env.ALPHA_VANTAGE_API_KEY ?? "",
	etf_scraper_url: env.ETF_SCRAPER_URL ?? "http://localhost:3101",
	// The SEC asks automated clients to identify themselves: "app-name contact@example.com"
	sec_user_agent: env.SEC_USER_AGENT ?? "",
	jwt_secret: env.JWT_SECRET ?? "",
	jwt_expires_in: env.JWT_EXPIRES_IN ?? "14d",
	db: {
		host: env.DB_HOST ?? "localhost",
		port: Number(env.DB_PORT ?? 5432),
		user: env.DB_USER ?? "",
		password: env.DB_PASSWORD ?? "",
		database: env.DB_NAME ?? ""
	},
	redis: {
		url: env.REDIS_URL ?? "",
		host: env.REDIS_HOST ?? "127.0.0.1",
		port: Number(env.REDIS_PORT ?? 6379),
		db: Number(env.REDIS_DB ?? 0),
		keyPrefix: "epa:"
	},
	// Only needed when the frontend is served from a different origin than the API
	origin: env.ORIGIN ?? ""
};
