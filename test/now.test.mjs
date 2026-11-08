import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../scripts/prompter/core.mjs";

// A deck shaped like a real one: an opener at the inn, a breakfast, a street must, a cellar card, a rule, an absent hero.
const SHEET = `# Session 09 — run sheet

> [!beat|must|at=session start; The Copper Kettle; Ο Χάλκινος Βραστήρας|ledger=1] The sergeant at the bar

> [!beat|must|at=Market street; whenever the energy dips; any street after the morning] Officers at the door

> [!beat|should|at=The Copper Kettle; Tessa; any breakfast|pc=Ilsa, Mara] Breakfast with the owner

> [!beat|fit|at=Tessa; the Great Market|pc=Mara] Keys, not openers

> [!beat|fit|at=The Sewers; any smuggler|pc=Kael] Kael: the scales

> [!beat|should|at=session start; table open|pc=Elsa] Elsa lands

> [!beat|watch|at=Short Rest|pc=Kael] Rule: Kael's bad knee
>
> [[/save ability=con dc=12]]

> [!beat|should|at=night] Night whispers
`;

const beats = P.parseBeats(SHEET);
const byTitle = t => beats.find(b => b.title.startsWith(t));
const titles = list => list.map(x => x.beat.title);
const kindOf = b => P.inferKind(b).kind;
const KETTLE = ["The Copper Kettle", "Copper Kettle", "Kettle", "Ο Χάλκινος Βραστήρας"];

test("now: at the inn in the morning, everyone here: the openers, nothing from the sewers", () => {
  const hot = new Map([[byTitle("The sergeant").id, { t: "2026-11-13T19:00:00Z" }], [byTitle("Elsa").id, { t: "2026-11-13T19:00:00Z" }]]);
  const now = P.nowCards(beats, { hot, places: KETTLE, since: "2026-11-13T19:00:00Z", regulars: ["Tessa Brightwater", "Tessa"], band: "morning", kindOf });
  assert.deepEqual(titles(now), ["The sergeant at the bar", "Elsa lands", "Breakfast with the owner"]);
  assert.equal(now[0].why, "hot");
  assert.equal(now[2].why, "here");
  assert.ok(!titles(now).some(t => /scales|knee/.test(t)));
});

test("now: rule cards, sleeping and done cards never show", () => {
  const status = { [byTitle("The sergeant").id]: { s: "played" } };
  const now = P.nowCards(beats, { status, places: KETTLE, asleep: b => b.pc.includes("Elsa"), kindOf, max: 9 });
  const t = titles(now);
  assert.ok(!t.includes("The sergeant at the bar"));
  assert.ok(!t.includes("Elsa lands"));
  assert.ok(!t.some(x => x.startsWith("Rule:")));
});

test("now: somewhere else, the place's cards lead and the inn's old hot card drops", () => {
  const hot = new Map([[byTitle("The sergeant").id, { t: "2026-11-13T19:00:00Z" }]]);
  const now = P.nowCards(beats, { hot, places: ["The Sewers", "Sewers"], since: "2026-11-13T20:30:00Z", kindOf });
  assert.equal(now[0].beat.title, "Kael: the scales");
  assert.equal(now[0].why, "here");
  const sergeant = now.find(x => x.beat.title.startsWith("The sergeant"));
  assert.ok(sergeant && sergeant.score < now[0].score, "called before the party got here: weighs less");
});

test("now: a person on stage beats the place's regulars; time of day counts; musts fill the gaps", () => {
  const seen = P.nowCards(beats, { people: ["Tessa"], kindOf, max: 9 });
  assert.equal(seen.find(x => x.beat.title.startsWith("Keys")).why, "person");
  const regular = P.nowCards(beats, { regulars: ["Tessa"], kindOf, max: 9 });
  assert.equal(regular.find(x => x.beat.title.startsWith("Keys")).why, "regular");
  const night = P.nowCards(beats, { band: "night", kindOf, max: 9 });
  assert.equal(night.find(x => x.beat.title === "Night whispers").why, "time");
  // Nothing known: only the musts, in deck order.
  assert.deepEqual(titles(P.nowCards(beats, { kindOf })), ["The sergeant at the bar", "Officers at the door"]);
});

test("now: 'later' cards sink, keys expand, max is respected", () => {
  const status = { [byTitle("Breakfast").id]: { s: "later" } };
  const score = st => P.nowCards(beats, { status: st, places: KETTLE, kindOf, max: 9 }).find(x => x.beat.title.startsWith("Breakfast")).score;
  assert.equal(score(status), score({}) + P.NOW_WEIGHTS.later);
  const keyed = P.parseBeats("> [!beat|should|at=kettle] Keyed card\n");
  const hit = P.nowCards(keyed, { places: KETTLE, expand: t => (t === "kettle" ? KETTLE : [t]) });
  assert.equal(hit[0]?.why, "here");
  assert.equal(P.nowCards(beats, { places: KETTLE, kindOf, max: 1 }).length, 1);
});
