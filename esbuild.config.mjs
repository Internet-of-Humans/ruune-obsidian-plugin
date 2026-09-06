import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

// Node's builtin module names, plus their `node:`-prefixed forms, so esbuild
// treats them all as external (replaces the `builtin-modules` package).
const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const production = process.argv[2] === "production";

const banner = `/*
Ruune Sync — Obsidian plugin. Bundled output; edit files in src/ instead.
*/`;

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (production) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
