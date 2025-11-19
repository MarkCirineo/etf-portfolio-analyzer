import config from "@config";
import request from "./request";

export const alphavantage = (url: string) => {
	const baseUrl = "https://www.alphavantage.co";
	const apiKey = config.finnhub_api_key;

	const parsedURL = url + `${url.includes("?") ? "&" : "?"}apikey=${apiKey}`;

	const response = request({
		url: `${baseUrl}${parsedURL}`,
		options: {
			method: "GET",
			headers: {
				"Content-Type": "application/json"
			}
		}
	});

	return response;
};
