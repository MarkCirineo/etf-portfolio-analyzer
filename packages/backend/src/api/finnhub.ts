import config from "@config";
import request from "./request";

export const finnhub = async (url: string) => {
	const baseUrl = "https://finnhub.io/api/v1";
	const apiKey = config.finnhub_api_key;

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
	const baseUrl = "/search";

	const response = await finnhub(`${baseUrl}?q=${query}&exchange=US`);

	return response;
};
