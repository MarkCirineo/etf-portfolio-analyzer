/**
 * Generates a random alphanumeric ID
 * @param length - Length of the ID (default: 12)
 * @returns Random string of a-z0-9 characters
 */
export const generatePublicId = (length: number = 12): string => {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

	let result = "";
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}

	return result;
};
