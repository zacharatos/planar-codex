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
