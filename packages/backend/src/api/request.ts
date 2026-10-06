type RequestParam = {
	url: string;
	options: RequestInit;
	returnRaw?: boolean;
};

export default async (requestParam: RequestParam) => {
	const response = await fetch(requestParam.url, {
		...requestParam.options
	});

	if (requestParam.returnRaw) {
		return response;
	}

	const data = await response.json();

	return data;
};
