#!/usr/bin/env node
// Rebuilds the vendored browser libraries in lib/ from node_modules (run after `npm ci`):
//   lib/codemirror.esm.js  ← lib-src/codemirror.mjs bundled with esbuild (only the parts the editor uses)
//   lib/marked.esm.js      ← marked's own ESM build
// Both are committed, so Foundry needs no build step. CI rebuilds them and fails if they differ.
import { build } from "esbuild";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

await build({
  entryPoints: ["lib-src/codemirror.mjs"],
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "none",
  outfile: "lib/codemirror.esm.js",
  logLevel: "warning"
});
copyFileSync("node_modules/marked/lib/marked.esm.js", "lib/marked.esm.js");

const licence = readFileSync("node_modules/@codemirror/view/LICENSE", "utf8");
writeFileSync("lib/codemirror-LICENSE.md", `CodeMirror 6 (@codemirror/*, @lezer/*), bundled as lib/codemirror.esm.js.\n\n${licence}`);
copyFileSync("node_modules/marked/LICENSE", "lib/marked-LICENSE.md");
console.log("lib/ rebuilt");
