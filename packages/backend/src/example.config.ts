export default {
	PORT: 3000,
	finnhub_api_key: "",
	alpha_vantage_api_key: "",
	etf_scraper_url: "http://localhost:8000",
	jwt_secret: "",
	jwt_expires_in: "14d",
	db: {
		host: "",
		port: 5432,
		user: "",
		password: "",
		database: ""
	},
	redis: {
		url: "",
		host: "127.0.0.1",
		port: 6379,
		db: 0,
		keyPrefix: "epa:"
	},
	origin: ""
};
