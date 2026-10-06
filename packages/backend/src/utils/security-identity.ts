/**
 * Tickers are not unique across exchanges. Funds report each position under its local
 * ticker with no exchange, so MRK is Merck & Co. in New York and Merck KGaA in Frankfurt,
 * SAN is both Banco Santander and Sanofi, and a global fund can hold both. A security is
 * therefore identified by its ticker plus the meaningful words of its name.
 *
 * etf.com names the same security identically in every fund, so this never splits one
 * company in two; it only separates different companies that share a ticker.
 */

/** Words that vary between sources for the same company, or say nothing about which one. */
const GENERIC_WORDS = new Set([
	"inc",
	"incorporated",
	"incorporation",
	"corp",
	"corporation",
	"co",
	"company",
	"the",
	"and",
	"of",
	"plc",
	"public",
	"ltd",
	"limited",
	"class",
	"shares",
	"share",
	"ordinary",
	"common",
	"stock",
	"adr",
	"ads",
	"sponsored",
	"registered",
	"series",
	"holdings",
	"holding",
	"voting",
	"non",
	"new",
	"de"
]);

/** Lower-cased words of a name, minus generic ones and single letters ("S.A." → nothing). */
export const nameWords = (name: string | null | undefined): string[] => {
	return (name ?? "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 1 && !GENERIC_WORDS.has(word));
};

export const securityKey = (symbol: string, name: string | null | undefined): string => {
	return `${symbol}|${Array.from(new Set(nameWords(name)))
		.sort()
		.join(" ")}`;
};

/**
 * Whether a fund's name for a holding refers to the company registered in the US under
 * the same ticker. Punctuation is used inconsistently ("Amazon.com" vs "AMAZON COM",
 * "D.R. Horton" vs "HORTON D R"), so each side's words are looked for inside the other's
 * name with punctuation removed. Checking both directions keeps a shorter name from
 * matching a longer one: "Prudential plc" (UK) is not "Prudential Financial" (US).
 */
export const matchesRegisteredName = (
	holdingName: string | null | undefined,
	registeredName: string
): boolean => {
	const registered = stripStateSuffixes(registeredName);
	const own = nameWords(holdingName);

	return (
		own.length > 0 &&
		own.every((word) => compact(registered).includes(word)) &&
		nameWords(registered).every((word) => compact(holdingName ?? "").includes(word))
	);
};

/** SEC names carry suffixes like "/DE/", "/CAN/", "LTD/CN" or "\PA\". */
const stripStateSuffixes = (name: string) => {
	let result = name;

	for (let previous = ""; previous !== result; ) {
		previous = result;
		result = result.replace(/\s*[/\\][A-Za-z.]{1,6}[/\\]?\s*$/, "");
	}

	return result;
};

const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
