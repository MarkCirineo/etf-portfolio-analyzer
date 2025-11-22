import config from "@config";
import request from "./request";

export const alphavantage = async (url: string) => {
	const baseUrl = "https://www.alphavantage.co";
	const apiKey = config.alpha_vantage_api_key;

	if (!apiKey) {
		throw new Error("Alpha Vantage API key is not configured");
	}

	const parsedURL = url + `${url.includes("?") ? "&" : "?"}apikey=${apiKey}`;

	const response = await request({
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
