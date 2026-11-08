import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../tools/ready-check.mjs";

/** A made-up vault with one problem of each kind. */
function vault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ready-"));
  const w = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  w("Campaign/Players/Ilsa Varn.md", "---\ntype: pc\naliases: [Ilsa, Ίλσα]\n---\n# Ilsa");
  w("Campaign/ledger.md", "---\ntype: ledger\n---\n| # | Thread | Owner | Made in | Best payoff point | Status |\n|---|---|---|---|---|---|\n| 1 | A deed | Ilsa | 01 | the Old Library | seeded |\n| 1 | Twice | | 01 | x | |\n");
  w("Campaign/names.md", "---\ntype: reference\ntags: [glossary]\n---\n| English | Ελληνικά |\n|---|---|\n| The Old Library | η Παλιά Βιβλιοθήκη |\n");
  w("Campaign/npcs.md", "---\ntype: npcs\n---\n### Brannoc (ο Μπράνοκ; smith)\n- **Voice at our table:** gruff\n");
  w("Foundry/atlas/x-pack.json", JSON.stringify({ places: [{ id: "lib", name: { el: "η Παλιά Βιβλιοθήκη", en: "The Old Library" } }] }));
  w("Visuals/WebP/Scenes/Ch01 - 01 - The Old Library.webp", "");
  w("Prep/Chapter 01.md", "---\ntype: prep\n---\n| NPC | Want / Fear / Tell |\n|---|---|\n| **Μαρίνα** (Marina, archivist) | order / fire / tidies |\n");
  w("Prep/Image Prompts/Ch01.md", "---\ntype: prep\ntags: [visuals]\n---\n# prompts");
  w("Prep/Session 01 - run sheet.md", "---\ntype: prep\n---\n" + [
    "> [!beat|must|at=The Old Library|pc=Ilsa|ledger=1] Library, English only",
    "> [!beat|should|at=the Moon Gate; any meal|pc=Bob|ledger=9] Unknown place, unknown hero",
    "> [!beat|fit|pc=Ilsa] No moment",
    "> [!beat|watch|at=Ilsa says the word Moon|pc=Ilsa] Watch cards are not names"
  ].join("\n\n"));
  w("Notes/loose.md", "# no frontmatter");
  return dir;
}

test("ready check: finds each kind of problem, and nothing in the good parts", () => {
  const results = run(vault());
  const of = p => (results.find(r => r.path === p)?.findings ?? []).map(f => `${f.level}: ${f.msg}`);
  assert.match(of("Notes/loose.md")[0], /^error: no `type`/);
  assert.match(of("Prep/Image Prompts/Ch01.md")[0], /^error: image prompts typed `prep`/);
  assert.ok(of("Campaign/npcs.md").some(m => /^error: «Brannoc»: no \*\*Want/.test(m)));
  const ledger = of("Campaign/ledger.md");
  assert.ok(ledger.some(m => /^error: #1 is used twice/.test(m)));
  assert.ok(ledger.some(m => /no Owner/.test(m)) && ledger.some(m => /no Status/.test(m)));
  const prep = of("Prep/Chapter 01.md");
  assert.ok(prep.some(m => /no `people` tag/.test(m)));
  const deck = of("Prep/Session 01 - run sheet.md");
  assert.ok(deck.some(m => /add the Greek name to `at=`/.test(m)), "an Atlas place named only in English");
  assert.ok(deck.some(m => /«the Moon Gate» isn't a name/.test(m)));
  assert.ok(deck.some(m => /^error: .*pc «Bob» isn't a hero/.test(m)));
  assert.ok(deck.some(m => /ledger #9 isn't in the ledger/.test(m)));
  assert.ok(deck.some(m => /^error: «No moment»: no `at=`/.test(m)));
  assert.ok(!deck.some(m => /Watch cards|any meal/.test(m)), "watch cards and kinds of moment are fine");
  assert.equal(of("Campaign/Players/Ilsa Varn.md").length, 0);
  assert.equal(of("Campaign/names.md").length, 0);
});

test("ready check: one note at a time", () => {
  const results = run(vault(), { only: "Prep/Chapter 01.md" });
  assert.deepEqual(results.map(r => r.path), ["Prep/Chapter 01.md"]);
});

test("ready check: card kinds (0.7): unknown, unclear, contradicting, rule as must", () => {
  const dir = vault();
  fs.writeFileSync(path.join(dir, "Prep/Session 02 - run sheet.md"), "---\ntype: prep\n---\n" + [
    "> [!beat|should|kind=banana|at=The Old Library; η Παλιά Βιβλιοθήκη] Bad kind\n> x",
    "> [!beat|should|at=Short Rest; The Old Library; η Παλιά Βιβλιοθήκη] Unclear\n> [[/save ability=con dc=12]]",
    "> [!beat|should|kind=clue|at=Short Rest] Says clue, reads like a rule\n> [[/save ability=con dc=15]]",
    "> [!beat|must|at=Short Rest|pc=Ilsa] Rule: must is wrong\n> x",
    "> [!beat|watch|kind=rule|at=Short Rest|pc=Ilsa] Rule: fine\n> [[/save ability=con dc=15]]"
  ].join("\n\n"));
  const deck = (run(dir).find(r => r.path === "Prep/Session 02 - run sheet.md")?.findings ?? []).map(f => `${f.level}: ${f.msg}`);
  assert.ok(deck.some(m => /^error: «Bad kind»: `kind=banana` isn't a kind/.test(m)));
  assert.ok(deck.some(m => /^warn: «Unclear»: kind unclear/.test(m)));
  assert.ok(deck.some(m => /«Says clue, reads like a rule»: `kind=clue`, but it reads like a rule card/.test(m)));
  assert.ok(deck.some(m => /«Rule: must is wrong»: a rule card is a reminder/.test(m)));
  assert.ok(!deck.some(m => /«Rule: fine»/.test(m)));
});

test("ready check: images: Theater buttons and embeds reach the WebP mirror, with their server path", async () => {
  const { assetRefs, resolveAsset, assetLabel } = await import("../tools/ready-check.mjs");
  const dir = vault();
  const w = (p, text = "") => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  w("Visuals/WebP/Scenes/Chapter02/Ch02 - 04 - The Wayfarer.webp");
  w("Visuals/WebP/Scenes/Chapter02/Ch02 - 04 - The Wayfarer + Riaen.webp");
  w("Visuals/WebP/Places/Sigil/08 - Bottle and Jug.webp");
  w("Visuals/WebP/Places/Sigil/08 - Bottle and Jug - the pit.webp");
  w("Visuals/WebP/Characters/NPCs/Part 01 - Sigil/Parisa.webp");
  w("Visuals/WebP/Maps/Dungeon Alchemist/_work/test.webp");
  w("Prep/Session 02 - run sheet.md", "---\ntype: prep\n---\n" + [
    "Go: @Place[Ch02 - 04 - The Wayfarer]{Inn} and @Cast[Parisa] · @Place[off]",
    "@Place[Bottle and Jug | to=Ilsa] is exact; @Place[Bottle] isn't; @Place[The Moon Gate]; @Cast[The orc]",
    "![[Ch02 - 04 - The Wayfarer.webp|400]] ![[Ch02 - 04 - The Wayfarer.png]] [[Parisa.webp|her]] ![[test.webp]]",
    "`@Place[Not checked in code]`"
  ].join("\n"));
  const results = run(dir);
  const f = (results.find(r => r.path === "Prep/Session 02 - run sheet.md")?.findings ?? []).map(x => `${x.level}: ${x.msg}`);
  assert.ok(f.some(m => /^error: `@Place\[The Moon Gate\]`: no image/.test(m)));
  assert.ok(f.some(m => /^error: `@Cast\[The orc\]`: no image in an NPCs folder/.test(m)));
  assert.ok(f.some(m => /^warn: `@Place\[Bottle\]` matches 2 images by the start of the name/.test(m)));
  assert.ok(f.some(m => /^warn: `!\[\[Ch02 - 04 - The Wayfarer\.png\]\]` embeds the original/.test(m)));
  assert.ok(f.some(m => /^error: `\[\[Parisa\.webp\|her\]\]`: a link to an image/.test(m)));
  assert.ok(f.some(m => /scratch image \(`_work\/`\)/.test(m)));
  assert.ok(!f.some(m => /Not checked|Ch02 - 04 - The Wayfarer\]|Bottle and Jug \||@Cast\[Parisa\]|off/.test(m)), f.join("\n"));
  const servers = results.assets.map(a => a.server);
  assert.ok(servers.includes("dnd/Scenes/Chapter02/Ch02 - 04 - The Wayfarer.webp"));
  assert.ok(servers.includes("dnd/Places/Sigil/08 - Bottle and Jug.webp"));
  assert.ok(servers.includes("dnd/Characters/NPCs/Part 01 - Sigil/Parisa.webp"));
  // The pieces: Theater's labels and search.
  assert.equal(assetLabel("Places/Sigil/08 - Bottle and Jug.webp"), "Bottle and Jug");
  assert.equal(assetLabel("Scenes/Chapter02/Ch02 - 04 - The Wayfarer.webp"), "Ch02 - 04 - The Wayfarer");
  assert.deepEqual(assetRefs("x\n@Cast[Fell | to=Ilsa]").map(r => [r.kind, r.name, r.line]), [["cast", "Fell", 1]]);
  const assets = [{ rel: "Places/a/01 - Ab.webp", label: "Ab", group: "place", file: "01 - Ab.webp" }];
  assert.equal(resolveAsset(assets, { kind: "place", name: "ÁB" }).how, "exact");
  assert.equal(resolveAsset(assets, { kind: "cast", name: "Ab" }).hits.length, 0, "an NPC card isn't a place");
});

test("ready check: place and NPC notes: name, key, sections the card knows", () => {
  const dir = vault();
  const w = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  w("Campaign/Places/Good.md", "---\ntype: place\nkey: good\naliases: [Good, Καλό]\n---\n# Καλό (Good)\n\n## Με μια ματιά\n- x\n");
  w("Campaign/Places/Typo.md", "---\ntype: place\naliases: [Typo, Λάθος]\n---\n# Λάθος (Typo)\n\n## Με μια ματια ξανά\n- x\n");
  w("Campaign/NPCs/Flat.md", "---\ntype: npc\nkey: flat\naliases: [Flat, Επίπεδος]\n---\n# Επίπεδος (Flat)\n\n## Φωνή και τρόπος\nJust prose.\n");
  const results = run(dir);
  const of = p => (results.find(r => r.path === p)?.findings ?? []).map(f => `${f.level}: ${f.msg}`);
  assert.deepEqual(of("Campaign/Places/Good.md"), []);
  assert.ok(of("Campaign/Places/Typo.md").some(m => /no `key:`/.test(m)));
  assert.ok(of("Campaign/Places/Typo.md").some(m => /section «Με μια ματια ξανά» isn't one the place card knows/.test(m)));
  assert.ok(of("Campaign/NPCs/Flat.md").some(m => /roleplay strip shows the section as text/.test(m)));
});
