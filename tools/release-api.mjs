#!/usr/bin/env node
// Tells foundryvtt.com about a new version (Package Release API, https://foundryvtt.com/article/package-release-api/).
// Only works for a package that already exists on foundryvtt.com.
//   FOUNDRY_PACKAGE_TOKEN=fvttp_... node tools/release-api.mjs --version 1.2.3 --repo user/name [--dry-run]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://foundryvtt.com/_api/packages/release_version/";

export function buildBody(manifest, { version, repo, dryRun = false }) {
  const base = `https://github.com/${repo}`;
  const c = manifest.compatibility ?? {};
  return {
    id: manifest.id,
    "dry-run": dryRun,
    release: {
      version,
      // must point at THIS release's manifest, not "latest"
      manifest: `${base}/releases/download/v${version}/module.json`,
      notes: `${base}/releases/tag/v${version}`,
      compatibility: { minimum: c.minimum, verified: c.verified, maximum: c.maximum ?? "" }
    }
  };
}

if ( process.argv[1] === fileURLToPath(import.meta.url) ) {
  const argv = process.argv.slice(2);
  const args = { dryRun: argv.includes("--dry-run") };
  for ( let i = 0; i < argv.length; i++ ) {
    if ( argv[i] === "--version" ) args.version = argv[++i];
    else if ( argv[i] === "--repo" ) args.repo = argv[++i];
  }
  const token = process.env.FOUNDRY_PACKAGE_TOKEN;
  if ( !token || !args.version || !args.repo ) {
    console.error("Need FOUNDRY_PACKAGE_TOKEN in the environment and --version / --repo.");
    process.exit(1);
  }
  const body = buildBody(JSON.parse(readFileSync("module.json", "utf8")), args);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  console.log(res.status, text);
  if ( !res.ok ) process.exit(1);
}
