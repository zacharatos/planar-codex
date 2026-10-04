import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../scripts/markdown.mjs";
import { render, parseFragment, lexer, parser } from "./helpers.mjs";
import { EditorState, EditorSelection, ensureSyntaxTree } from "../lib/codemirror.esm.js";
import { codexMarkdown } from "../scripts/editor/syntax.mjs";
import { computeDecorations, frontmatterRange, linkAt } from "../scripts/editor/live-preview.mjs";
import { LanguageSupport } from "../lib/codemirror.esm.js";

// inline-edit.mjs needs Foundry at call time only; stub what module load touches.
globalThis.game ??= { settings: { get: () => true } };
const { locateText } = await import("../scripts/inline-edit.mjs");

test("GM view tags every block with its source line", () => {
  const md = "---\ntype: npc\n---\n# Title\n\nPara %%a\nmulti-line\ncomment%% after\n\n> [!readaloud] Box\n> text\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## End";
  const html = M.convertMarkdown(md, { render, parseFragment, gm: true, lexer, parser }).html;
  const lines = md.split("\n");
  const tags = [...html.matchAll(/<(\w+)[^>]*data-codex-line="(\d+)"/g)].map(m => [m[1], Number(m[2])]);
  assert.deepEqual(tags.map(t => t[0]), ["h1", "p", "aside", "ul", "table", "h2"]);
  assert.equal(lines[tags[0][1]], "# Title");
  assert.ok(lines[tags[1][1]].startsWith("Para"));
  assert.ok(lines[tags[2][1]].startsWith("> [!readaloud]"));
  assert.equal(lines[tags[3][1]], "- one");
  assert.ok(lines[tags[4][1]].startsWith("| a"));
  assert.equal(lines[tags[5][1]], "## End");
  // Same HTML as the plain renderer apart from the attributes.
  const plain = M.convertMarkdown(md, { render, parseFragment, gm: true }).html;
  assert.equal(html.replace(/ data-codex-line="\d+"/g, ""), plain);
});

test("roll labels read like the rendered roll", () => {
  assert.equal(M.describeRoll("/check ability=int skill=his dc=15"), "History (Int) DC 15");
  assert.equal(M.describeRoll("/check skill=ath/acr dc=12"), "Athletics / Acrobatics DC 12");
  assert.equal(M.describeRoll("/save ability=dex dc=18"), "Dex save DC 18");
  assert.equal(M.describeRoll("/damage 8d10 fire average"), "8d10 fire");
  assert.equal(M.describeRoll("/attack +9"), "Attack +9");
  assert.equal(M.describeRoll("/gmr 1d8"), "GM 1d8");
  assert.equal(M.describeRoll("/r 2d6+3"), "2d6+3");
});

test("double-click finds the line inside a block", () => {
  const md = "intro\n- **Alpha** first item\n- Beta [[Brannoc|the innkeeper]] says hi\n- Γάμμα δεύτερο\nafter";
  assert.equal(locateText(md, 1, 4, "Beta the innkeeper says hi").line, 2);
  assert.equal(locateText(md, 1, 4, "Γαμμα δευτερο").line, 3);
  assert.deepEqual(locateText(md, 1, 4, "Alpha first item", "first"), { line: 1, ch: 12 });
  assert.equal(locateText(md, 1, 4, "").line, 1);
});

function stateFor(doc, cursor) {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [new LanguageSupport(codexMarkdown)] });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}
function decos(state, focused = true) {
  const set = computeDecorations(state, [{ from: 0, to: state.doc.length }], focused, { isResolved: l => l.target !== "Nowhere" });
  const out = [];
  set.between(0, state.doc.length, (from, to, d) => { out.push({ from, to, text: state.sliceDoc(from, to), cls: d.spec.class, widget: d.spec.widget?.constructor.name, spec: d.spec.widget?.spec }); });
  return out;
}

test("live preview hides markers away from the cursor and shows them under it", () => {
  const doc = "# Heading\n\nSome **bold** and [[Brannoc|the innkeeper]] and [[/save ability=dex dc=18]] and [[Nowhere]].\n\n- [ ] task\n- item";
  const far = decos(stateFor(doc, doc.indexOf("\n\n") + 1));
  assert.ok(far.some(d => d.text === "# " && !d.widget), "heading mark hidden");
  assert.ok(far.some(d => d.text === "**" ), "bold marks hidden");
  const chips = far.filter(d => d.widget === "ChipWidget").map(d => d.spec.label);
  assert.deepEqual(chips, ["the innkeeper", "Dex save DC 18", "Nowhere"]);
  assert.ok(far.find(d => d.spec?.label === "Nowhere").spec.cls.includes("cm-codex-unresolved"));
  assert.ok(far.some(d => d.widget === "CheckboxWidget"));
  assert.ok(far.some(d => d.widget === "BulletWidget"));
  // Cursor on the heading line: its # shows.
  const near = decos(stateFor(doc, 3));
  assert.ok(!near.some(d => d.text === "# "));
  // Cursor inside the link: its source shows.
  const inLink = decos(stateFor(doc, doc.indexOf("Brannoc") + 2));
  assert.ok(!inLink.some(d => d.spec?.label === "the innkeeper"));
  // Editor not focused: everything rendered.
  assert.ok(decos(stateFor(doc, 3), false).some(d => d.text === "# "));
});

test("callouts: each line styled, type marker replaced by a label", () => {
  const doc = "> [!readaloud] Η Νεκροθήκη\n> Κείμενο\n\nafter";
  const d = decos(stateFor(doc, doc.length));
  const lines = d.filter(x => x.cls?.includes("cm-codex-callout"));
  assert.equal(lines.length, 2);
  assert.ok(lines.every(x => x.cls.includes("codex-callout-readaloud")));
  assert.ok(d.some(x => x.widget === "CalloutLabelWidget" && x.text === "[!readaloud] "));
});

test("frontmatter range and ctrl-click targets", () => {
  const doc = "---\ntype: npc\n---\nSee [[Brannoc#Voice|him]] or @UUID[Actor.abc]{Brannoc}.";
  assert.deepEqual(frontmatterRange(stateFor(doc, 0).doc), { from: 0, to: 17 });
  const st = stateFor(doc, 0);
  const a = linkAt(st, doc.indexOf("Brannoc") + 1);
  assert.equal(a.kind, "wikilink");
  assert.equal(a.link.heading, "Voice");
  assert.equal(linkAt(st, doc.indexOf("@UUID") + 3).kind, "foundry");
  assert.equal(linkAt(st, 20), null);
});
