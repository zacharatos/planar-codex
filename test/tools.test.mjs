import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stamp } from "../tools/stamp-manifest.mjs";
import { buildBody } from "../tools/release-api.mjs";
import { listFiles, deflateZip } from "../tools/package.mjs";

const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));

test("stamp writes release URLs for the tag and repo", () => {
  const s = stamp(manifest, { version: "1.2.3", repo: "someone/planar-codex" });
  assert.equal(s.version, "1.2.3");
  assert.equal(s.manifest, "https://github.com/someone/planar-codex/releases/latest/download/module.json");
  assert.equal(s.download, "https://github.com/someone/planar-codex/releases/download/v1.2.3/module.zip");
  assert.throws(() => stamp(manifest, { version: "v1", repo: "a/b" }));
  assert.throws(() => stamp(manifest, { version: "1.0.0", repo: "nope" }));
});

test("release API body points at the version's own manifest", () => {
  const b = buildBody(manifest, { version: "1.2.3", repo: "someone/planar-codex", dryRun: true });
  assert.equal(b.id, "planar-codex");
  assert.equal(b["dry-run"], true);
  assert.equal(b.release.manifest, "https://github.com/someone/planar-codex/releases/download/v1.2.3/module.json");
  assert.equal(b.release.compatibility.verified, manifest.compatibility.verified);
});

test("the package ships runtime files only", () => {
  const files = listFiles(new URL("..", import.meta.url).pathname);
  assert.ok(files.includes("scripts/main.mjs"));
  assert.ok(files.includes("lib/codemirror.esm.js"));
  assert.ok(files.includes("lang/en.json"));
  assert.ok(files.includes("LICENSE"));
  assert.ok(!files.some(f => f.startsWith("test/") || f.startsWith("tools/") || f.startsWith("node_modules/") || f.startsWith("lib-src/")));
});

test("the release zip is readable by a real unzip", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-zip-"));
  const zip = join(dir, "m.zip");
  writeFileSync(zip, deflateZip([{ path: "module.json", data: "{}" }, { path: "lang/ελ.json", data: "x".repeat(5000) }]));
  const out = execFileSync("unzip", ["-l", zip], { encoding: "utf8" });
  assert.match(out, /module\.json/);
  assert.match(out, /5000/);
  execFileSync("unzip", ["-tq", zip]);
});
