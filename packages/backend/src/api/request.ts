type RequestParam = {
	url: string;
	options: RequestInit;
};

export default async (requestParam: RequestParam) => {
	const response = await fetch(requestParam.url, {
		...requestParam.options
	});

	const data = await response.json();

	return data;
};
