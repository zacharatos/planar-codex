import fs from "node:fs"; import path from "node:path";
import { extractLinks, extractHeadings, findHeading, basename } from "../scripts/markdown.mjs";
import { NoteIndex } from "../scripts/resolver.mjs";
const dir = process.argv[2]; const notes = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".md")) notes.push({ path: path.relative(dir,p).split(path.sep).join("/"), md: fs.readFileSync(p,"utf8") }); } })(dir);
const idx = new NoteIndex(notes.map(n => ({ id: n.path, path: n.path, name: basename(n.path), n })));
let ok = 0, bad = 0;
for (const n of notes) for (const l of extractLinks(n.md)) {
  if (!l.heading || l.type) continue;
  const t = l.target ? idx.resolve(l.target, n.path) : { n };
  if (!t) continue;
  const h = findHeading(extractHeadings(t.n.md), l.heading);
  if (h) ok++; else { bad++; console.log("MISS", n.path, "→", l.target, "#", l.heading); }
}
console.log(`heading links: ${ok} resolve, ${bad} miss`);
