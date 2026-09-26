declare const config: {
	PORT: number;
	finnhub_api_key: string;
	alpha_vantage_api_key: string;
	etf_scraper_url: string;
	jwt_secret: string;
	jwt_expires_in: string;
	db: {
		host: string;
		port: number;
		user: string;
		password: string;
		database: string;
	};
	redis?: {
		url?: string;
		host?: string;
		port?: number;
		password?: string;
		db?: number;
		keyPrefix?: string;
		tls?: boolean;
	};
	origin: string;
};

export default config;
