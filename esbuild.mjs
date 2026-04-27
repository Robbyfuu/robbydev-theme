import { build } from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
	entryPoints: ["src/extension.ts"],
	bundle: true,
	platform: "node",
	target: "node18",
	format: "cjs",
	outfile: "out/extension.js",
	external: ["vscode"],
	sourcemap: false,
	minify: !watch,
	logLevel: "info",
};

if (watch) {
	const ctx = await (await import("esbuild")).context(options);
	await ctx.watch();
} else {
	await build(options);
}
