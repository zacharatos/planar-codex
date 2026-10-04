import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODULE_ID } from "../scripts/codex.mjs";

const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
const file = p => new URL(`../${p}`, import.meta.url);

test("manifest has the fields Foundry requires", () => {
  for ( const k of ["id", "title", "description", "version", "compatibility", "authors"] ) assert.ok(manifest[k], k);
  assert.match(manifest.id, /^[a-z0-9-]+$/);
  assert.equal(manifest.id, MODULE_ID, "codex.mjs and module.json must agree");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.compatibility.minimum && manifest.compatibility.verified);
  for ( const k of ["url", "manifest", "download", "bugs", "readme", "changelog", "license"] ) assert.match(manifest[k], /^https:\/\//, k);
  assert.ok(manifest.download.includes(`/v${manifest.version}/`), "download URL points at this version's release");
});

test("package.json and module.json versions agree", () => {
  const pkg = JSON.parse(readFileSync(file("package.json"), "utf8"));
  assert.equal(pkg.version, manifest.version);
});

test("the changelog has a section for this version", () => {
  const log = readFileSync(file("CHANGELOG.md"), "utf8");
  assert.ok(log.includes(`## [${manifest.version}]`), `CHANGELOG.md needs "## [${manifest.version}]"`);
});

test("every referenced file exists", () => {
  for ( const p of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)] ) {
    assert.ok(existsSync(file(p)), p);
  }
});

const flatten = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const langs = Object.fromEntries(manifest.languages.map(l => [l.lang, JSON.parse(readFileSync(file(l.path), "utf8"))]));

test("every interface string the code asks for exists in English", () => {
  const keys = new Set(flatten(langs.en));
  const used = new Set();
  const walk = dir => {
    for ( const name of readdirSync(dir) ) {
      const p = join(dir, name);
      if ( statSync(p).isDirectory() ) { walk(p); continue; }
      if ( !p.endsWith(".mjs") ) continue;
      const src = readFileSync(p, "utf8");
      for ( const m of src.matchAll(/\blocalize\(\s*"([\w.]+)"/g) ) used.add(`PLANARCODEX.${m[1]}`);
      for ( const m of src.matchAll(/"(PLANARCODEX\.[\w.]+)"/g) ) used.add(m[1]);
      for ( const m of src.matchAll(/localize\(`([\w.]+)\.\$\{/g) ) used.add(`PLANARCODEX.${m[1]}.*`);
    }
  };
  walk(new URL("../scripts", import.meta.url).pathname);
  for ( const k of used ) {
    if ( k.endsWith(".*") ) assert.ok([...keys].some(x => x.startsWith(k.slice(0, -1))), k);
    else assert.ok(keys.has(k), `missing string ${k}`);
  }
});

test("all languages define exactly the same keys as English", () => {
  const en = flatten(langs.en).sort();
  for ( const [code, data] of Object.entries(langs) ) assert.deepEqual(flatten(data).sort(), en, `${code} differs from en`);
});
