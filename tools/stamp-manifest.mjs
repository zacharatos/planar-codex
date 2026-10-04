#!/usr/bin/env node
// Writes a release-ready module.json: version, GitHub URLs, and the per-release download link.
//   node tools/stamp-manifest.mjs --version 1.2.3 --repo user/planar-codex [--in module.json] [--out dist/module.json]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function stamp(manifest, { version, repo }) {
  if ( !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version) ) throw new Error(`Bad version "${version}" (expected 1.2.3)`);
  if ( !/^[\w.-]+\/[\w.-]+$/.test(repo) ) throw new Error(`Bad repo "${repo}" (expected user/name)`);
  const base = `https://github.com/${repo}`;
  return {
    ...manifest,
    version,
    url: base,
    manifest: `${base}/releases/latest/download/module.json`,
    download: `${base}/releases/download/v${version}/module.zip`,
    bugs: `${base}/issues`,
    readme: `${base}#readme`,
    changelog: `${base}/blob/main/CHANGELOG.md`,
    license: `${base}/blob/main/LICENSE`
  };
}

function parseArgs(argv) {
  const out = {};
  for ( let i = 0; i < argv.length; i += 2 ) {
    if ( !argv[i].startsWith("--") ) throw new Error(`Unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

if ( process.argv[1] === fileURLToPath(import.meta.url) ) {
  const args = parseArgs(process.argv.slice(2));
  const input = args.in ?? "module.json";
  const output = args.out ?? input;
  if ( !args.version || !args.repo ) {
    console.error("Usage: stamp-manifest.mjs --version 1.2.3 --repo user/name [--in module.json] [--out dist/module.json]");
    process.exit(1);
  }
  const stamped = stamp(JSON.parse(readFileSync(input, "utf8")), args);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(stamped, null, 2) + "\n");
  console.log(`Wrote ${output} (v${stamped.version})`);
}
