import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../scripts/prompter/core.mjs";

const SHEET = `---
type: prep
session: "7"
tags: [prep, run-sheet]
---
# Session 07 — run sheet

## The deck

> [!beat|must|at=session start|pc=Ilsa|ledger=4,9|missed=2] Ilsa's flashback
>
> Ask her what she holds.
>
> > [!whisper|memory] Ilsa
> >
> > «Snow on the counter.»

> [!beat|should|at=The Old Library; the archivist; any official paper|pc=Brannoc, Ilsa|ledger=#8, 53] The forged deed
> One line.

> [!beat|watch|at=anyone says "we died"] Quiet, please

\`\`\`
> [!beat] Not a beat, it's code
\`\`\`

> [!beat|fit|at=first Long Rest; night] Night whispers

## ✅ Close-out (5 minutes)

- [ ] Answer:
  1. **What did Ilsa hold?**
  2. What did they pay?

## Rules
1. Not a question.
`;

test("beats: priority, triggers, heroes, ledger, missed, body, section", () => {
  const beats = P.parseBeats(SHEET);
  assert.equal(beats.length, 4);
  const [a, b, c, d] = beats;
  assert.equal(a.priority, "must");
  assert.deepEqual(a.at, ["session start"]);
  assert.deepEqual(a.pc, ["Ilsa"]);
  assert.deepEqual(a.ledger, ["4", "9"]);
  assert.equal(a.missed, 2);
  assert.equal(a.title, "Ilsa's flashback");
  assert.match(a.body, /^Ask her what she holds\./);
  assert.match(a.body, /> \[!whisper\|memory\] Ilsa/);
  assert.equal(a.section, "The deck");
  assert.deepEqual(b.at, ["The Old Library", "the archivist", "any official paper"]);
  assert.deepEqual(b.pc, ["Brannoc", "Ilsa"]);
  assert.deepEqual(b.ledger, ["8", "53"]);
  assert.equal(b.body, "One line.");
  assert.equal(c.priority, "watch");
  assert.equal(d.priority, "fit");
  assert.ok(beats.every(x => x.id && typeof x.line === "number"));
  assert.equal(new Set(beats.map(x => x.id)).size, 4);
});

test("beat ids are stable across edits elsewhere in the note", () => {
  const one = P.parseBeats(SHEET).map(b => b.id);
  const two = P.parseBeats(`Intro line\n\n${SHEET.replace("One line.", "Two lines.\n> More.")}`).map(b => b.id);
  assert.deepEqual(one, two);
});

test("explicit ids and duplicate titles", () => {
  const md = "> [!beat|id=deed] Same\n\n> [!beat] Same\n\n> [!beat] Same";
  const ids = P.parseBeats(md).map(b => b.id);
  assert.equal(ids[0], "deed");
  assert.notEqual(ids[1], ids[2]);
});

test("meta: aliases and defaults", () => {
  assert.equal(P.parseBeatMeta("").priority, "should");
  assert.equal(P.parseBeatMeta("maybe").priority, "fit");
  assert.equal(P.parseBeatMeta("p=must").priority, "must");
  assert.deepEqual(P.parseBeatMeta("when=a; b|for=X").at, ["a", "b"]);
});

test("close-out questions", () => {
  assert.deepEqual(P.parseCloseout(SHEET), ["What did Ilsa hold?", "What did they pay?"]);
  assert.deepEqual(P.parseCloseout("# Nothing\n1. x"), []);
});

test("session number", () => {
  assert.equal(P.sessionOf({ session: "7" }, "x"), "7");
  assert.equal(P.sessionOf({}, "Session 03 - run sheet"), "3");
  assert.equal(P.pad2("3"), "03");
});

test("fold: accents, Greek tonos and final sigma, punctuation", () => {
  assert.equal(P.fold("Η Πλατεία των Κουρελάδων!"), "η πλατεια των κουρελαδων");
  assert.equal(P.fold("Ο Δρόμος"), "ο δρομοσ");
  assert.equal(P.fold("  The  Old-Library "), "the old library");
});

test("triggers: names in either direction, kinds of moment never auto-match", () => {
  const place = text => ({ kind: "place", text });
  assert.ok(P.triggerMatches("The Old Library", place("Ch02 - 07 - The Old Library (eye level)")));
  assert.ok(P.triggerMatches("the Wayfarer", place("The Ubiquitous Wayfarer")));
  assert.ok(P.triggerMatches("Πλατεία των Κουρελάδων", place("Η Πλατεία των Κουρελάδων")));
  assert.ok(!P.triggerMatches("any official paper", place("Official paper office")));
  assert.ok(!P.triggerMatches("the Old Library", place("Old")));
  assert.ok(!P.triggerMatches("Docks", place("The Old Library")));
});

test("triggers: rests, combat, deaths, start, time of day", () => {
  assert.ok(P.triggerMatches("first Long Rest", { kind: "rest", long: true }));
  assert.ok(!P.triggerMatches("first Long Rest", { kind: "rest", long: false }));
  assert.ok(P.triggerMatches("any rest", { kind: "rest", long: false }));
  assert.ok(P.triggerMatches("a rest", { kind: "rest", long: false }));
  assert.ok(P.triggerMatches("short rest", { kind: "rest", long: false }));
  assert.ok(P.triggerMatches("after combat", { kind: "combat" }));
  assert.ok(P.triggerMatches("session start", { kind: "start" }));
  assert.ok(!P.triggerMatches("the Old Library", { kind: "start" }));
  assert.ok(P.triggerMatches("at night", { kind: "time", text: "Night" }));
  assert.ok(P.triggerMatches("μεσάνυχτα", { kind: "time", text: "μεσάνυχτα" }));
  assert.ok(!P.triggerMatches("at night", { kind: "time", text: "Morning" }));
});

test("beatsFor skips played and skipped beats", () => {
  const beats = P.parseBeats(SHEET);
  const ctx = { kind: "place", text: "The Old Library" };
  assert.deepEqual(P.beatsFor(beats, ctx).map(b => b.title), ["The forged deed"]);
  const id = beats[1].id;
  assert.deepEqual(P.beatsFor(beats, ctx, { [id]: { s: "played" } }), []);
  assert.equal(P.beatsFor(beats, ctx, { [id]: { s: "later" } }).length, 1);
});

test("asleep: only when every named hero is absent", () => {
  const [a, b, , d] = P.parseBeats(SHEET);
  const present = name => name === "Brannoc";
  assert.ok(P.isAsleep(a, present));
  assert.ok(!P.isAsleep(b, present));
  assert.ok(!P.isAsleep(d, present));
});

test("notes: tags pulled out of the text", () => {
  assert.deepEqual(P.parseNote("#paid the guide, 3 gp #npc"), { text: "the guide, 3 gp", tags: ["paid", "npc"] });
  assert.deepEqual(P.parseNote("plain", ["Quote"]), { text: "plain", tags: ["quote"] });
});

test("live log: deck rows, misses, sleepers, notes, events, answers", () => {
  const beats = P.parseBeats(SHEET);
  const state = {
    startedAt: "2026-10-30T18:00:00.000Z", closedAt: "2026-10-30T21:30:00.000Z",
    beats: { [beats[0].id]: { s: "played", t: "2026-10-30T18:05:00.000Z", where: "session start" }, [beats[2].id]: { s: "skipped", t: "2026-10-30T19:00:00.000Z" } },
    notes: [{ t: "2026-10-30T19:10:00.000Z", text: "the guide, 3 gp", tags: ["paid"] }],
    events: [{ t: "2026-10-30T19:20:00.000Z", kind: "whisper", label: "Whisper", text: "→ Ilsa «Snow»" }],
    answers: { 0: "a kitchen knife" }
  };
  const md = P.buildLiveLog({
    sheetName: "Session 07 - run sheet", session: "7", beats, state,
    questions: P.parseCloseout(SHEET), asleep: b => b.title === "Night whispers",
    spotlight: [{ name: "Ilsa", count: 2, present: true }, { name: "Brannoc", count: 0, present: false }]
  });
  assert.match(md, /^---\ntype: session\nsession: "7"\ndate: 2026-10-30\n/);
  assert.match(md, /# Session 07 — live log/);
  assert.match(md, /\[\[Session 07 - run sheet\]\]/);
  assert.match(md, /\| ✓ \| 🔴 \| Ilsa's flashback \| #4 #9 \|/);
  assert.match(md, /\| ✗ \| 👂 \| Quiet, please \|/);
  assert.match(md, /\| ☐ \| 🟡 \| The forged deed \| #8 #53 \| \*\*not played → missed ×1\*\* \|/);
  assert.match(md, /\| 💤 \| ⚪ \| Night whispers \|/);
  // Played runs to the last thing at the table (19:20), not to Close (0.6.2: a Close the next day read as 16 hours).
  assert.match(md, /\*\*Played\*\* 1:20 · \*\*Last at the table\*\* \d\d:\d\d/);
  assert.match(md, /`#paid` the guide, 3 gp/);
  assert.match(md, /\*\*Whisper\*\* → Ilsa «Snow»/);
  assert.match(md, /1\. \*\*What did Ilsa hold\?\*\*\n {3}a kitchen knife/);
  assert.match(md, /2\. \*\*What did they pay\?\*\*\n {3}\*\(no answer\)\*/);
  assert.match(md, /\*\*Brannoc\*\* 0 \(absent\)/);
});

test("beat callouts: GM view only, with a priority class; players never see them", async () => {
  const M = await import("../scripts/markdown.mjs");
  const { render, parseFragment } = await import("./helpers.mjs");
  const md = "> [!beat|must|at=x] Secret beat\n> the body\n> > [!whisper] Ilsa\n> > psst\n\nVisible";
  const gm = M.convertMarkdown(md, { render, parseFragment, gm: true }).html;
  assert.match(gm, /codex-callout-beat codex-beat-must/);
  assert.match(gm, /Secret beat/);
  assert.match(gm, /codex-callout-whisper/);
  const player = M.convertMarkdown(md, { render, parseFragment, gm: false }).html;
  assert.doesNotMatch(player, /Secret beat|the body|psst/);
  assert.match(player, /Visible/);
});

/* ---- 0.6.2: Session 03 fixes ---- */

test("absentFor names the heroes a sleeping beat waits for", () => {
  const beat = { pc: ["Elaion", "Dumien"] };
  const present = n => n === "Dumien";
  assert.deepEqual(P.absentFor(beat, present), ["Elaion"]);
  assert.deepEqual(P.absentFor({ pc: [] }, present), []);
});

test("isNight reads the Atlas parts of the day in both languages", () => {
  for ( const b of ["νύχτα", "Night", "αντιζενίθ", "antipeak", "μεσάνυχτα"] ) assert.ok(P.isNight(b), b);
  for ( const b of ["ζενίθ", "morning", "", null] ) assert.ok(!P.isNight(b), String(b));
});

const runAt = (start, events = [], extra = {}) => ({ active: true, startedAt: start, closedAt: null, beats: {}, notes: [], events, ...extra });

test("lastActivity ignores the Prompter's own open and close", () => {
  const r = runAt("2026-11-06T20:20:00.000Z", [
    { t: "2026-11-06T20:20:00.000Z", kind: "session" },
    { t: "2026-11-06T23:21:00.000Z", kind: "rest" },
    { t: "2026-11-07T13:09:00.000Z", kind: "session" }
  ], { notes: [{ t: "2026-11-06T22:00:00.000Z" }], beats: { a: { s: "played", t: "2026-11-06T23:26:00.000Z" } } });
  assert.equal(P.lastActivity(r), "2026-11-06T23:26:00.000Z");
  assert.equal(P.lastActivity(runAt(null)), null);
});

test("playedMs stops at the last thing at the table, not at a Close the next afternoon", () => {
  const r = runAt("2026-11-06T20:20:00.000Z", [{ t: "2026-11-06T23:26:00.000Z", kind: "move" }], { closedAt: "2026-11-07T13:09:00.000Z" });
  assert.equal(P.duration(P.playedMs(r)), "3:06");
  const early = runAt("2026-11-06T20:20:00.000Z", [{ t: "2026-11-06T23:26:00.000Z", kind: "move" }], { closedAt: "2026-11-06T22:20:00.000Z" });
  assert.equal(P.duration(P.playedMs(early)), "2:00");
  assert.equal(P.playedMs(runAt(null)), null);
});

test("closeNudge offers to close after a Long Rest or a quiet half hour, and respects 'not yet'", () => {
  const t0 = Date.parse("2026-11-06T23:21:00.000Z");
  const rest = runAt("2026-11-06T20:20:00.000Z", [{ t: "2026-11-06T23:21:00.000Z", kind: "rest", long: true }]);
  assert.equal(P.closeNudge(rest, t0 + 60000), "rest");
  assert.equal(P.closeNudge(rest, t0 + 60000, { dismissedAt: "2026-11-06T23:21:00.000Z" }), null);
  const short = runAt("2026-11-06T20:20:00.000Z", [{ t: "2026-11-06T23:21:00.000Z", kind: "rest", long: false }]);
  assert.equal(P.closeNudge(short, t0 + 5 * 60000), null);
  assert.equal(P.closeNudge(short, t0 + 31 * 60000), "idle");
  assert.equal(P.closeNudge({ ...short, active: false }, t0 + 31 * 60000), null);
});

test("olderThan: stamped items before the Prompter listened are old news", () => {
  assert.ok(P.olderThan("2026-11-06T22:00:00.000Z", "2026-11-07T01:23:00.000Z"));
  assert.ok(!P.olderThan("2026-11-07T01:24:00.000Z", "2026-11-07T01:23:00.000Z"));
  assert.ok(!P.olderThan(undefined, "2026-11-07T01:23:00.000Z"));
  assert.ok(!P.olderThan("2026-11-06T22:00:00.000Z", null));
});

test("the live log names absent heroes and uses the played time", () => {
  const beats = P.parseBeats("> [!beat|should|pc=Elaion] Elaion arrives\n>\n> body\n");
  const md = P.buildLiveLog({
    sheetName: "Session 04 - run sheet", session: "4", beats,
    state: runAt("2026-11-06T20:20:00.000Z", [{ t: "2026-11-06T23:26:00.000Z", kind: "move", label: "Atlas", text: "→ x" }], { closedAt: "2026-11-07T13:09:00.000Z" }),
    asleep: () => true, absent: () => ["Elaion"]
  });
  assert.match(md, /💤 Elaion absent \(not counted\)/);
  assert.match(md, /\*\*Played\*\* 3:06/);
});
