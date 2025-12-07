import config from "@config";
import request from "./request";

export const etfScraper = async (symbol: string) => {
	const baseUrl = config.etf_scraper_url;
	const url = `${baseUrl}/etf-holdings/${encodeURIComponent(symbol.toLowerCase())}`;

	const response = await request({
		url,
		options: {
			method: "GET",
			headers: {
				"Content-Type": "application/json"
			}
		}
	});

	return response;
};
