const isNumber = (value: number | null | undefined): value is number =>
	typeof value === "number" && !Number.isNaN(value);

/** $1,234 — whole dollars, for amounts large enough that cents are noise. */
export const formatMoney = (value: number | null | undefined) =>
	isNumber(value)
		? value.toLocaleString("en-US", {
				style: "currency",
				currency: "USD",
				maximumFractionDigits: 0
			})
		: "—";

/** $1,234.56 */
export const formatCurrency = (value: number | null | undefined) =>
	isNumber(value) ? value.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";

/** $612B, $4.3M */
export const formatCompactMoney = (value: number | null | undefined) =>
	isNumber(value)
		? value.toLocaleString("en-US", {
				style: "currency",
				currency: "USD",
				notation: "compact",
				maximumFractionDigits: 1
			})
		: "—";

/** +$612.40 / −$12.00 */
export const formatSignedCurrency = (value: number | null | undefined) =>
	isNumber(value) ? `${value >= 0 ? "+" : "−"}${formatCurrency(Math.abs(value))}` : "—";

export const formatPercent = (value: number | null | undefined, digits = 2) =>
	isNumber(value) ? `${value.toFixed(digits)}%` : "—";

export const formatSignedPercent = (value: number | null | undefined, digits = 2) =>
	isNumber(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}%` : "—";

export const formatShares = (value: number | null | undefined, maximumFractionDigits = 2) =>
	isNumber(value) ? value.toLocaleString("en-US", { maximumFractionDigits }) : "—";

export const formatCount = (value: number) => value.toLocaleString("en-US");

export const formatTime = (value?: string | null) =>
	value
		? new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
		: "—";

export const formatDate = (value?: string | null) =>
	value
		? new Date(value).toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric"
			})
		: "—";

/** "2026-09" → "Sep 2026" */
export const formatMonth = (month: string) => {
	const [year, monthNumber] = month.split("-").map(Number);
	return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", {
		month: "short",
		year: "numeric",
		timeZone: "UTC"
	});
};

export const plural = (count: number, one: string, many = `${one}s`) =>
	`${formatCount(count)} ${count === 1 ? one : many}`;
