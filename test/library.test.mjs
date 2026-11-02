import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../scripts/library/core.mjs";

const CHAPTER = `# Part 1: Tales of the Town

## Chapter 1: The Gate

### Arrival

#### G1: Gatehouse
The guards ask for a toll of 2 sp.

#### G2: Courtyard
A fountain.

### Development
The captain sends for help.

## Chapter 2: The Market

### Development
Merchants gossip about the toll.

### Fishmonger, Old Rival
A stat block.
`;

const chapters = [
  { name: "Introduction - How to Use", sections: B.sectionsOf("# Introduction\n## Running the Game\nText") },
  { name: B.chapterName("02 - Part 1 - Tales of the Town.md"), sections: B.sectionsOf(CHAPTER) },
  { name: B.chapterName("03-01 - Chapter 3 - The Road.md"), sections: B.sectionsOf("# Chapter 3–The Road\n## Bandits\n") }
];
const find = cite => {
  const p = B.parseCitation(cite);
  const r = B.findSection(chapters, p.segments);
  if ( !r ) return null;
  return r.section < 0 ? chapters[r.chapter].name : chapters[r.chapter].sections[r.section].text;
};

test("book index table → codes; folder names with _ for :", () => {
  const idx = B.parseBookIndex("| code | book | files |\n|---|---|---|\n| SRD | System Reference | 3 |\n| AAT | Adventure Atlas_ The Town | 1 |");
  assert.deepEqual(idx, [{ code: "SRD", book: "System Reference" }, { code: "AAT", book: "Adventure Atlas_ The Town" }]);
  assert.equal(B.codeForFolder("Adventure Atlas_ The Town", idx), "AAT");
  assert.equal(B.codeForFolder("Monster Manual (2025)", idx), "MM");
});

test("book files in reading order, index files left out", () => {
  assert.deepEqual(B.bookFiles(["10 - Ten.md", "_toc.md", "02 - Two.md", "03-01 - Sub.md", "img.png"]), ["02 - Two.md", "03-01 - Sub.md", "10 - Ten.md"]);
  assert.equal(B.chapterName("Book/03-02 - Chapter 6 - Town.md"), "Chapter 6 - Town");
});

test("batches stay under a size", () => {
  const b = B.batchBySize([{ size: 300 }, { size: 300 }, { size: 50 }, { size: 900 }], 600);
  assert.deepEqual(b.map(x => x.length), [2, 1, 1]);
});

test("citations: code, year, places, hint", () => {
  assert.deepEqual(B.parseCitation("PHB 2024, Ch. 7 › Using a Potion"), { code: "PHB", segments: ["Ch. 7", "Using a Potion"], hint: "" });
  assert.deepEqual(B.parseCitation("AAT › Taboo: Resurrection"), { code: "AAT", segments: ["Taboo: Resurrection"], hint: "" });
  assert.deepEqual(B.parseCitation("› G2"), { code: null, segments: ["G2"], hint: "" });
  assert.deepEqual(B.parseCitation("SRD, Ch. 2 › Market › Bazaar (Shops d8 6)"), { code: "SRD", segments: ["Ch. 2", "Market", "Bazaar"], hint: "Shops d8 6" });
});

test("abbreviations are spelled out", () => {
  assert.equal(B.foldPlace("Ch. 2"), "chapter 2");
  assert.equal(B.placeScore("Chapter 2: The Market", "Ch. 2"), 80);
  assert.equal(B.placeScore("G1: Gatehouse", "G1"), 80);
  assert.equal(B.placeScore("G12: Tower", "G1"), 0);
});

test("a citation finds its section; the chapter context breaks ties", () => {
  assert.equal(find("SRD, Ch. 1 › G2"), "G2: Courtyard");
  assert.equal(find("SRD, Ch. 2 › Development"), "Development");
  const p = B.parseCitation("SRD, Ch. 2 › Development");
  const r = B.findSection(chapters, p.segments);
  assert.ok(chapters[1].sections[r.section].line > 15, "the Development under Chapter 2, not Chapter 1");
  assert.equal(find("SRD, Ch. 2 › Fishmonger, Old Rival"), "Fishmonger, Old Rival");
  assert.equal(find("SRD, Ch. 3"), "Chapter 3 - The Road", "the chapter file itself");
  assert.equal(find("SRD, Introduction › Running the Game"), "Running the Game");
  assert.equal(find("SRD, Ch. 2 › Nowhere at all"), "Chapter 2: The Market", "falls back to the context");
  assert.equal(B.findSection([], ["X"]), null);
});

test("the part of a chapter under a heading", () => {
  const secs = B.sectionsOf(CHAPTER);
  const i = secs.findIndex(s => s.text === "Arrival");
  const md = B.sectionMarkdown(CHAPTER, secs, i);
  assert.match(md, /^### Arrival/);
  assert.match(md, /G2: Courtyard/);
  assert.doesNotMatch(md, /captain/);
  assert.equal(B.sectionMarkdown(CHAPTER, secs, -1), CHAPTER);
});

test("search: headings first, then text with an excerpt", () => {
  const list = chapters.map((c, i) => ({ ...c, code: "SRD", book: "System", chapter: i }));
  const hits = B.searchBooks(list, "toll");
  assert.deepEqual(hits.map(h => h.heading).sort(), ["Development", "G1: Gatehouse"]);
  assert.match(hits.find(h => h.heading === "G1: Gatehouse").excerpt, /toll of 2 sp/);
  assert.equal(B.searchBooks(list, "development")[0].score, 100);
  assert.deepEqual(B.searchBooks(list, "x"), []);
});

test("a books folder: one subfolder per book, codes from the index note, _ files and folders skipped", async () => {
  const { readBooksFolder } = await import("../scripts/library/store.mjs");
  const file = (path, text = "# x") => ({ webkitRelativePath: path, name: path.split("/").pop(), text: async () => text });
  const found = await readBooksFolder([
    file("Sources/INDEX.md", "| code | book |\n|---|---|\n| SRD | System Reference |"),
    file("Sources/System Reference/02 - Two.md"),
    file("Sources/System Reference/01 - One.md"),
    file("Sources/System Reference/_toc.md"),
    file("Sources/Monster Manual (2025)/01 - A.md"),
    file("Sources/_index/headings.md"),
    file("Sources/System Reference/img/map.png")
  ]);
  assert.equal(found.root, "Sources");
  assert.deepEqual(found.books.map(b => [b.code, b.folder, b.files.map(f => f.name)]), [
    ["MM", "Monster Manual (2025)", ["01 - A.md"]],
    ["SRD", "System Reference", ["01 - One.md", "02 - Two.md"]]
  ]);
});
