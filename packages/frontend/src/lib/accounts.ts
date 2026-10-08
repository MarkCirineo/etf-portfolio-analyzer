import type { AccountType } from "$lib/types";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
	taxable: "Taxable",
	roth_ira: "Roth IRA",
	traditional_ira: "Traditional IRA",
	"401k": "401(k)",
	hsa: "HSA",
	other: "Other"
};

export const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[];

/** Pill colours per account type; taxable stands apart from the tax-advantaged ones. */
export const ACCOUNT_TYPE_BADGE: Record<AccountType, string> = {
	taxable: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
	roth_ira: "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-300",
	traditional_ira: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
	"401k": "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
	hsa: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-300",
	other: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
};

/** Bar colours per account type, in the order the split bar lists them. */
export const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
	roth_ira: "#0F766E",
	traditional_ira: "#0369A1",
	"401k": "#1E3A8A",
	hsa: "#6D28D9",
	taxable: "#D97706",
	other: "#71717A"
};

/**
 * Colours for the user's own funds and stocks, by size. Dark enough for white text, and
 * neighbours differ in lightness as well as hue.
 */
export const FUND_COLORS = [
	"#3730A3",
	"#0F766E",
	"#B45309",
	"#9F1239",
	"#075985",
	"#166534",
	"#6D28D9",
	"#57534E"
];

export const ACCOUNT_COLORS = ["#0F766E", "#B45309", "#3730A3", "#9F1239", "#075985", "#57534E"];

export const colorAt = (palette: string[], index: number) => palette[index % palette.length];
