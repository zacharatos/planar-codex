import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import * as M from "../scripts/markdown.mjs";
import { NoteIndex, linkReport } from "../scripts/resolver.mjs";
import { planImport, diffImport, toVaultMarkdown, stripRoot, pathForNewNote } from "../scripts/vault.mjs";
import { buildZip } from "../scripts/zip.mjs";
import { render, parseFragment } from "./helpers.mjs";

const conv = (md, gm = true, extra = {}) => M.convertMarkdown(md, { render, parseFragment, gm, ...extra });

test("roll detection", () => {
  for ( const r of ["/r 1d20", "/check skill=his dc=15", "/damage 8d10 fire average", "1d20+5", "2d6", "lookup @name", "/gmr 1d4"] ) assert.ok(M.isRollContent(r), r);
  for ( const n of ["Prologue", "Chapter 01 - The Sunken Road", "actor:Brannoc", "Session 00", "2026-10-03 - Session 00 - Χιόνι στο Λιμάνι"] ) assert.ok(!M.isRollContent(n), n);
});

test("wikilink parsing", () => {
  assert.deepEqual(M.parseWikilink("Note#Head|Lbl"), { target: "Note", heading: "Head", block: null, label: "Lbl", type: null, name: "Note" });
  assert.equal(M.parseWikilink("spell:Fireball").type, "spell");
  assert.equal(M.parseWikilink("Note\\|x").label, "x");
  assert.equal(M.parseWikilink("Note#^abc").block, "abc");
  assert.equal(M.parseWikilink("Weird: Title").type, null);
});

test("links become @Codex text, rolls stay rolls, code is untouched", () => {
  const { html } = conv("A [[Prologue]] [[Note#H|l]] [[/check skill=his dc=15]]{History} `[[x]]` [[actor:Brannoc]]");
  assert.match(html, /@Codex\[Prologue\]\{Prologue\}/);
  assert.match(html, /@Codex\[Note#H\]\{l\}/);
  assert.match(html, /\[\[\/check skill=his dc=15\]\]\{History\}/);
  assert.match(html, /<code>\[\[x\]\]<\/code>/);
  assert.match(html, /@Codex\[actor:Brannoc\]\{Brannoc\}/);
});

test("callouts: player view drops DM, whisper, comments; keeps read-aloud; secrets are sections", () => {
  const md = "> [!readaloud] Title\n> Text\n\n> [!dm]\n> hidden\n\n> [!whisper] Ilsa\n> psst\n\n> [!secret]\n> later\n\n%%note%%";
  const p = conv(md, false).html;
  assert.match(p, /codex-callout-readaloud/);
  assert.doesNotMatch(p, /hidden|psst|note/);
  assert.match(p, /<section[^>]*class="secret"/);
  const g = conv(md, true).html;
  assert.match(g, /hidden/); assert.match(g, /psst/); assert.match(g, /codex-comment/);
});

test("secret ids are stable and revealed state survives", () => {
  const md = "> [!secret]\n> the truth";
  const a = conv(md, false, { notePath: "x.md" }).html;
  const id = a.match(/id="(secret-[^"]+)"/)[1];
  assert.equal(conv(md, true, { notePath: "x.md" }).html.match(/id="(secret-[^"]+)"/)[1], id);
  assert.match(conv(md, false, { notePath: "x.md", revealed: new Set([id]) }).html, /class="secret revealed"/);
});

test("nested callout inside a list item", () => {
  const md = "1. Step\n   - **Ilsa**\n     > [!whisper] Ilsa\n     > «line»\n2. Next";
  const g = conv(md, true).html;
  assert.match(g, /codex-callout-whisper/);
  assert.match(g, /«line»/);
});

test("tasks toggle by index, outside code", () => {
  const md = "---\na: 1\n---\n- [ ] one\n```\n- [ ] code\n```\n- [x] two";
  assert.equal(M.toggleTask(md, 0), md.replace("- [ ] one", "- [x] one"));
  assert.equal(M.toggleTask(md, 1), md.replace("- [x] two", "- [ ] two"));
  assert.equal(conv(md).tasks, 2);
});

test("frontmatter round trip", () => {
  const md = "---\ntype: npc\naliases: [Brannoc, \"Ο Μπράνοκ\"]\ntags:\n  - npc\n  - tavern\nactor: Brannoc\n---\n# Brannoc\n";
  const { data, body } = M.splitFrontmatter(md);
  assert.deepEqual(data.aliases, ["Brannoc", "Ο Μπράνοκ"]);
  assert.deepEqual(data.tags, ["npc", "tavern"]);
  assert.equal(body, "# Brannoc\n");
  const again = M.splitFrontmatter(M.setFrontmatter(md, data)).data;
  assert.deepEqual(again, data);
});

test("resolver: basename, path, alias, nearest folder", () => {
  const idx = new NoteIndex([
    { id: 1, path: "Homebrew/Prologue.md", name: "Prologue" },
    { id: 2, path: "Prep/Chapter 00 - Prologue.md", name: "Chapter 00 - Prologue", aliases: ["Prologue prep"] },
    { id: 3, path: "Prep/README.md", name: "README" },
    { id: 4, path: "Homebrew/README.md", name: "README" }
  ]);
  assert.equal(idx.resolve("Prologue").id, 1);
  assert.equal(idx.resolve("Homebrew/Prologue.md").id, 1);
  assert.equal(idx.resolve("prologue prep").id, 2);
  assert.equal(idx.resolve("README", "Homebrew/Kallidor.md").id, 4);
  assert.equal(idx.resolve("README", "Prep/x.md").id, 3);
  assert.equal(idx.resolve("Nope"), null);
});

test("diffImport decisions", () => {
  const n = planImport([{ path: "A.md", text: "# A\nv2" }]).notes;
  const h1 = M.contentHash("# A\nv1");
  const mk = md => new Map([["a", { markdown: md, importHash: h1 }]]);
  assert.equal(diffImport(n, new Map())[0].action, "create");
  assert.equal(diffImport(n, mk("# A\nv1"))[0].action, "update");
  assert.equal(diffImport(n, mk("# A\nedited"))[0].action, "conflict-keep");
  assert.equal(diffImport(n, mk("# A\nedited"), "vault")[0].action, "conflict-vault");
  assert.equal(diffImport(planImport([{ path: "A.md", text: "# A\nv1" }]).notes, mk("# A\nedited"))[0].action, "skip");
});

test("export rewrites world links, keeps compendium links", () => {
  const md = "@UUID[Actor.abc]{Brannoc} @UUID[JournalEntry.j.JournalEntryPage.p#m1-cellar]{room} @UUID[Compendium.dnd5e.spells24.Item.x]{Fireball} @UUID[Actor.zzz]{Bob}";
  const out = toVaultMarkdown(md, (uuid, hash) => uuid === "Actor.abc" ? { kind: "doc", prefix: "actor", name: "Brannoc" }
    : uuid.includes("JournalEntryPage") ? { kind: "note", name: "Chapter 01", heading: "M1 — Cellar" } : null);
  assert.equal(out, "[[actor:Brannoc]] [[Chapter 01#M1 — Cellar|room]] @UUID[Compendium.dnd5e.spells24.Item.x]{Fireball} @UUID[Actor.zzz]{Bob}");
});

test("stripRoot and new-note paths", () => {
  assert.deepEqual(stripRoot(["V/a.md", "V/b/c.md"]).paths, ["a.md", "b/c.md"]);
  assert.equal(pathForNewNote(["Prep", "NPCs"], "Jex: wax"), "Prep/NPCs/Jex- wax.md");
});

test("zip is readable by a real unzip", () => {
  const z = buildZip([{ path: "Prep/Χιόνι.md", data: "# Χιόνι\n" }, { path: "a.md", data: "x" }]);
  fs.writeFileSync("/tmp/codex-test.zip", z);
  const out = execFileSync("python3", ["-c", "import zipfile;z=zipfile.ZipFile('/tmp/codex-test.zip');print(z.testzip());print(z.read('Prep/Χιόνι.md').decode())"]).toString();
  assert.match(out, /^None\n# Χιόνι/);
});

test("link report finds dangling and ambiguous links", () => {
  const r = linkReport([
    { path: "A.md", markdown: "[[B]] [[Missing]] [[README]] [[actor:X]] ![[pic.png]]" },
    { path: "B.md", markdown: "" }, { path: "x/README.md", markdown: "" }, { path: "y/README.md", markdown: "" }
  ], { assetExists: () => false });
  assert.equal(r.dangling.length, 1);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.typed, 1);
  assert.equal(r.missingAssets.length, 1);
});

test("autocomplete trigger and matching", async () => {
  globalThis.game ??= {}; globalThis.CONFIG ??= {};
  const { detectTrigger, score, fold } = await import("../scripts/autocomplete.mjs");
  assert.deepEqual(detectTrigger("text [[Prol"), { start: 5, query: "Prol", mode: "link" });
  assert.equal(detectTrigger("x [[spell:fir").prefix, "spell");
  assert.equal(detectTrigger("x [[spell:fir").query, "fir");
  assert.equal(detectTrigger("x [[Chapter 01#M3").mode, "heading");
  assert.equal(detectTrigger("x [[/che").mode, "roll");
  assert.equal(detectTrigger("x [[done]] more"), null);
  assert.equal(detectTrigger("no link"), null);
  assert.equal(fold("Ελάιον"), "ελαιον");
  assert.ok(score("Ελάιον Ντον", "ελαι") > 0);
  assert.ok(score("Chapter 01 - The Sunken Road", "sunken") > score("Chapter 01 - The Sunken Road", "unken"));
  assert.equal(score("Brannoc", "zzz"), 0);
});
