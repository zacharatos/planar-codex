// Usage: node tools/vault-check.mjs <vault dir> [--verbose]
import fs from "node:fs";
import path from "node:path";
import { convertMarkdown } from "../scripts/markdown.mjs";
import { planImport } from "../scripts/vault.mjs";
import { linkReport } from "../scripts/resolver.mjs";
import { render, parseFragment } from "../test/helpers.mjs";

const dir = process.argv[2];
const verbose = process.argv.includes("--verbose");
const files = [];
(function walk(d) {
  for ( const e of fs.readdirSync(d, { withFileTypes: true }) ) {
    const p = path.join(d, e.name);
    if ( e.isDirectory() ) walk(p);
    else files.push(path.relative(dir, p).split(path.sep).join("/"));
  }
})(dir);
const md = files.filter(f => f.endsWith(".md")).map(f => ({ path: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
const plan = planImport(md);
const assetSet = new Set(files.map(f => f.toLowerCase()).concat(files.map(f => f.split("/").pop().toLowerCase())));
console.log(`notes ${plan.notes.length}, skipped ${plan.skipped.length}, folders ${plan.folders.join(" | ")}`);
let problems = 0, totals = { callouts: 0, readaloud: 0, dm: 0, whisper: 0, secret: 0, tasks: 0, rolls: 0, links: 0 };
for ( const n of plan.notes ) {
  for ( const gm of [true, false] ) {
    let r;
    try { r = convertMarkdown(n.markdown, { render, parseFragment, gm, notePath: n.path, resolveAsset: name => assetSet.has(name.toLowerCase()) ? `assets/${name}` : null }); }
    catch (e) { console.log("THROW", n.path, gm, e.stack); problems++; continue; }
    const h = r.html;
    if ( /CODEXTOKEN|CODEXSEPX|\u0001/.test(h) ) { console.log("LEFTOVER TOKEN", n.path, gm); problems++; }
    if ( !gm ) {
      if ( /codex-callout-dm|codex-callout-whisper|codex-comment|codex-properties/.test(h) ) { console.log("GM CONTENT LEAK", n.path); problems++; }
      if ( /\[![a-z]/i.test(h.replace(/<code>[\s\S]*?<\/code>/g, "")) ) { console.log("UNPARSED CALLOUT", n.path, h.match(/.{0,60}\[![a-z][^<]{0,40}/i)?.[0]); problems++; }
    } else {
      totals.callouts += (h.match(/class="codex-callout /g) || []).length;
      for ( const k of ["readaloud", "dm", "whisper"] ) totals[k] += (h.match(new RegExp(`codex-callout-${k}\\b`, "g")) || []).length / 1;
      totals.secret += (h.match(/<section[^>]*class="secret/g) || []).length;
      totals.tasks += r.tasks;
      totals.rolls += (h.match(/\[\[\//g) || []).length;
      totals.links += (h.match(/@Codex\[/g) || []).length;
    }
  }
}
const rep = linkReport(plan.notes, { assetExists: t => assetSet.has(t.toLowerCase()) || assetSet.has(t.split("/").pop().toLowerCase()) });
console.log("totals (GM view):", totals);
console.log(`links ${rep.links}, resolved ${rep.resolved}, typed ${rep.typed}, dangling ${rep.dangling.length}, ambiguous ${rep.ambiguous.length}, assets ${rep.assets.length}, missing assets ${rep.missingAssets.length}`);
if ( verbose || rep.dangling.length < 40 ) for ( const d of rep.dangling ) console.log("  DANGLING", d.from, d.line, d.target, d.heading ?? "");
for ( const d of rep.ambiguous ) console.log("  AMBIGUOUS", d.from, d.target, "→", d.chosen, "| also", d.others.join(", "));
for ( const d of rep.missingAssets ) console.log("  MISSING ASSET", d.from, d.target);
const orphans = plan.notes.filter(n => !rep.backlinks.has(n.path)).map(n => n.path);
console.log(`notes with no backlinks: ${orphans.length}`); if ( verbose ) orphans.forEach(o => console.log("  ORPHAN", o));
console.log(problems ? `PROBLEMS: ${problems}` : "OK: no conversion problems");
process.exitCode = problems ? 1 : 0;
