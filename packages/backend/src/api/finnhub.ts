import config from "@config";
import request from "./request";

export const finnhub = async (url: string) => {
	const baseUrl = "https://finnhub.io/api/v1";
	const apiKey = config.finnhub_api_key;

	if (!apiKey) {
		throw new Error("Finnhub API key is not configured");
	}

	const response = await request({
		url: `${baseUrl}${url}`,
		options: {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				"X-Finnhub-Token": apiKey
			}
		}
	});

	return response;
};

export const finnhubSearch = async (query: string) => {
	return await finnhub(`/search?q=${query}&exchange=US`);
};

export const finnhubQuote = async (symbol: string) => {
	return await finnhub(`/quote?symbol=${encodeURIComponent(symbol)}`);
};
