import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// Every page loads its data in the browser, so the app builds to static files that
		// any web server can serve; unknown paths fall back to index.html for the client router
		adapter: adapter({ fallback: "index.html" }),
		alias: {
			"@/*": "./path/to/lib/*"
		}
	}
};

export default config;
