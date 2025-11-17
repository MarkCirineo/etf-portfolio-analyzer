import typescript from "@rollup/plugin-typescript";
import alias from "@rollup/plugin-alias";

export default {
	input: "src/index.ts",
	output: {
		dir: "dist",
		exports: "named",
		preserveModules: true
	},
	plugins: [
		typescript(),
		alias({
			entries: [{ find: "@", replacement: "./" }]
		})
	]
};
