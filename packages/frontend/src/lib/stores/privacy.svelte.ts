const STORAGE_KEY = "hide-amounts";

const readStored = () => {
	try {
		return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
	} catch {
		return false;
	}
};

/**
 * Whether the user's own dollar amounts and share counts are hidden, for looking at the
 * portfolio with someone else around. Percentages and market data stay visible.
 * Remembered per browser.
 */
export const privacy = $state({ hidden: readStored() });

export const toggleHiddenAmounts = () => {
	privacy.hidden = !privacy.hidden;

	try {
		localStorage.setItem(STORAGE_KEY, privacy.hidden ? "1" : "0");
	} catch {
		// Private windows can refuse storage; the setting just won't be remembered
	}
};
