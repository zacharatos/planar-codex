import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../scripts/lens/core.mjs";

const PEOPLE = `---
type: npcs
---
# People

## Template

### Name (role, place) — first met session NN
- **Want / Fear / Tell:**

### Brannoc the Smith (ο Μπράνοκ, ο Σιδεράς; dwarf smith, Low Ward) — first met Session 02
- **Want / Fear / Tell:** a good blade / the guild / taps the anvil twice
- **Voice at our table:** gruff, «Ε, παιδί μου».
- **Attitude to party:** friendly
- **Knows:** where the [[Old Library|library]] keeps its back door.
- **Status:** alive
- **Book reference:** \`SRD, Ch. 1 › Smiths\`

### Ilsa Varn (η Ίλσα; a hero) — the party
Just prose, no fields: not a person entry.

## DM status

| NPC | Status | Attitude to party | What they know |
|-----|--------|-------------------|----------------|
| Brannoc the Smith (dwarf) | Alive, owes the party | Friendly | The guild's secret |
| Μαρίνα Κόλλια (Marina Kollia; archivist) | Not yet met | — | The forged deed |
`;

const LEDGER = `---
type: ledger
---
# Ledger

## A. Made at the table

| # | Promise / mystery | Owner | Made in | Best payoff point | Status |
|---|---|---|---|---|---|
| 1 | Who forged the deed? | **[[Ilsa Varn\\|Ilsa]]** | 02 | Ch. 3 › The Old Library | seeded |
| 2 | Brannoc's debt | Party | 02 | any forge | seeded |

## B. Planned seeds

| # | Seed | Owner | Made in | Best payoff point | Status |
|---|---|---|---|---|---|
| 7 | The archivist knows Ilsa's handwriting | Ilsa | Ch. 3 (planned) | Το Αρχείο | planned |
| x | not a row | | | | |
`;

const GLOSSARY = `| English | Ελληνικά | Note |
|---|---|---|
| The Old Library | **η Παλιά Βιβλιοθήκη** | |
| Low Ward | Κάτω Συνοικία / η Κάτω Πόλη | alt |
| A rule that is a whole sentence and not a name at all, really | Ένας κανόνας | |
`;

test("stripMd keeps the words of links, bold and code", () => {
  assert.equal(L.stripMd("**[[Ilsa Varn\\|Ilsa]]** met [[Brannoc]] at `SRD › X`"), "Ilsa met Brannoc at SRD › X");
  assert.equal(L.stripMd("@Atlas[pay: 3gp | why]{3 gp} and @Place[Library]"), "3 gp and Library");
});

test("name variants drop leading articles and keep the part before a comma", () => {
  assert.deepEqual(L.nameVariants("The Old Library"), ["the old library", "old library"]);
  assert.deepEqual(L.nameVariants("η Παλιά Βιβλιοθήκη"), ["η παλια βιβλιοθηκη", "παλια βιβλιοθηκη"]);
  assert.deepEqual(L.nameVariants("Farrow, Echo of the Wheel (homebrew)"), ["farrow echo of the wheel", "farrow"]);
  assert.deepEqual(L.nameVariants("Al"), []);
});

test("mentions match whole words only", () => {
  assert.ok(L.mentions(L.fold("They went to the Old Library at night"), ["old library"]));
  assert.ok(!L.mentions(L.fold("Brannocson"), ["brannoc"]));
});

test("sections split by heading, subsections inside their parent", () => {
  const s = L.sectionsOf("---\na: 1\n---\nintro\n# One\ntext\n## Two\nmore\n```\n# not a heading\n```\n# Three\nend");
  assert.deepEqual(s.map(x => [x.level, x.text, x.line]), [[0, "", 3], [1, "One", 4], [2, "Two", 6], [1, "Three", 11]]);
  assert.match(s[1].body, /more/);
  assert.equal(s[2].endLine, 10);
});

test("people: heading blocks with fields, table rows merged by name, template skipped", () => {
  const people = L.parsePeople(PEOPLE, "npcs");
  assert.deepEqual(people.map(p => p.name), ["Brannoc the Smith", "Μαρίνα Κόλλια"]);
  const b = people[0];
  assert.deepEqual(b.aliases, ["ο Μπράνοκ", "ο Σιδεράς"]);
  assert.equal(b.about, "dwarf smith, Low Ward");
  assert.equal(b.note, "first met Session 02");
  assert.deepEqual(b.fields.slice(0, 6).map(f => f.kind), ["wft", "voice", "attitude", "knows", "status", "book"]);
  assert.ok(b.fields.some(f => f.extra && /owes the party/.test(f.value)), "the table row adds its status");
  assert.ok(!b.fields.some(f => f.extra && f.value === "Friendly"), "same value is not repeated");
  const m = people[1];
  assert.deepEqual(m.aliases, ["Marina Kollia"]);
  assert.ok(!m.fields.some(f => f.value === "—"), "empty cells are dropped");
});

test("person titles: other-script names become aliases, the rest is about", () => {
  assert.deepEqual(L.parsePersonTitle("Zed (ο Ζεντ; the book's Zedd; a clerk) — met S01"),
    { name: "Zed", aliases: ["ο Ζεντ"], about: "the book's Zedd; a clerk", note: "met S01" });
  assert.deepEqual(L.parsePersonTitle("Shemeshka (arcanaloth, Fortune's Wheel)").aliases, []);
});

test("ledger rows: numbered, with owner, payoff and status by column name", () => {
  const rows = L.parseLedger(LEDGER);
  assert.deepEqual(rows.map(r => r.n), ["1", "2", "7"]);
  assert.equal(rows[0].payoff, "Ch. 3 › The Old Library");
  assert.equal(rows[0].section, "A. Made at the table");
  assert.equal(rows[2].status, "planned");
  assert.ok(L.mentions(L.fold(L.ledgerText(rows[0])), ["ilsa"]), "owner cell counts");
});

test("glossary pairs short names, alternatives split, sentences ignored", () => {
  const g = L.parseGlossary(GLOSSARY);
  assert.deepEqual(g, [["The Old Library", "η Παλιά Βιβλιοθήκη"], ["Low Ward", "Κάτω Συνοικία", "η Κάτω Πόλη"]]);
});

test("the name book links every name of one thing", () => {
  const book = new L.NameBook([...L.parseGlossary(GLOSSARY), ...L.parsePeople(PEOPLE).map(p => [p.name, ...p.aliases])]);
  const lib = book.expand("Old Library");
  assert.deepEqual(lib.names, ["Old Library", "The Old Library", "η Παλιά Βιβλιοθήκη"]);
  assert.ok(lib.variants.includes("παλια βιβλιοθηκη"));
  assert.deepEqual(book.expand("Μπράνοκ").names, ["Μπράνοκ", "Brannoc the Smith", "ο Μπράνοκ", "ο Σιδεράς"]);
  assert.deepEqual(book.expand("Nobody").names, ["Nobody"]);
});

test("names from what the table showed", () => {
  assert.deepEqual(L.namesFromLabel("Ch02 - 07 - The Old Library · Η Παλιά Βιβλιοθήκη"), ["The Old Library", "Η Παλιά Βιβλιοθήκη"]);
  assert.deepEqual(L.namesFromLabel("Ch02 - 01 - The Forge + Brannoc"), ["The Forge", "Brannoc"]);
  assert.deepEqual(L.namesFromLabel("A clerk (the archivist)"), ["A clerk"]);
  assert.deepEqual(L.namesFromLabel("Ch01 - 13 - Arrival - The Square (eye level)"), ["Arrival - The Square", "Arrival", "The Square"]);
  assert.deepEqual(L.namesFromLabel("scenes/library.webp"), ["library"]);
});

test("mentions in a note: the heading that names it first, then the most mentions", () => {
  const md = "# Prep\n\nThe smith is nearby. Brannoc.\n\n## 1. Arrival\n\nBrannoc waves. Brannoc shouts.\n\n## 2. Brannoc's forge\n\nHot.\n\n## 3. Elsewhere\n\nNothing.";
  const hits = L.mentionsIn(md, ["brannoc"]);
  assert.deepEqual(hits.map(h => h.heading), ["2. Brannoc's forge", "1. Arrival", "Prep"]);
  assert.equal(hits[1].count, 2);
});

test("excerpts centre on the mention", () => {
  const text = `${"word ".repeat(80)}the archivist knows ${"more ".repeat(80)}`;
  const e = L.excerpt(text, ["archivist"], 60);
  assert.match(e, /archivist/);
  assert.ok(e.startsWith("…") && e.endsWith("…"));
});

test("citations found in text", () => {
  const re = /^(SRD|PHB)(?=[\s,›.:']|$)/;
  assert.deepEqual(L.citationsIn("see `SRD, Ch. 1 › Smiths` and `PHB › X` and `code`", re), ["SRD, Ch. 1 › Smiths", "PHB › X"]);
});

test("plain reading text: quotes, callout headers, rolls and list marks removed", () => {
  assert.equal(L.plainLine("> > [!beat|should|at=The Library; night|pc=Ilsa] The forged deed"), "The forged deed");
  assert.equal(L.plainLine("> - Search [[/check ability=int skill=inv dc=18]] or pay."), "Search 🎲 or pay.");
  assert.equal(L.plainLine("- [ ] **Do it** %%secret%%"), "**Do it** ");
  assert.equal(L.plainText("> [!dm] ⚠ Don't forget\n>\n> - one\n> - two"), "⚠ Don't forget one two");
});

test("a first name finds the whole name when nothing has exactly that name", () => {
  const book = new L.NameBook([["Marina Kollia", "η Μαρίνα"], ["Mara"], ["Brannoc the Smith"]]);
  assert.deepEqual(book.expand("Marina").names, ["Marina", "Marina Kollia", "η Μαρίνα"]);
  assert.deepEqual(book.expand("Mara").names, ["Mara"], "an exact name wins");
  assert.deepEqual(book.expand("Bran").names, ["Bran"], "a word must be whole");
});

test("run sheets are searched without their beat callouts", () => {
  const md = "## Deck\n\n> [!beat|should|at=Library] Brannoc's line\n> body about Brannoc\n\nAfter the beats, Brannoc again.\n> [!dm] Brannoc stays";
  const out = L.withoutBeats(md);
  assert.doesNotMatch(out, /\[!beat|body about/);
  assert.match(out, /After the beats/);
  assert.match(out, /\[!dm\] Brannoc stays/);
});
