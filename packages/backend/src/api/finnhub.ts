import config from "@config";
import logger from "@logger";
import request from "./request";

export const finnhub = async (url: string, returnRaw: boolean = false) => {
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
		},
		returnRaw
	});

	return response;
};

export const finnhubQuote = async (symbol: string) => {
	return await finnhub(`/quote?symbol=${encodeURIComponent(symbol)}`, true);
};
