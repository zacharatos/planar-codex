import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../scripts/keys/core.mjs";
import * as M from "../scripts/markdown.mjs";
import { beatsFor } from "../scripts/prompter/core.mjs";
import { render, parseFragment } from "./helpers.mjs";

// Shaped like the vault's Campaign/Places and Campaign/NPCs notes (made-up content).
const wayfarer = K.thingOf({ key: "wayfarer", kind: "place", title: "Ο Πανταχού Οδοιπόρος", names: ["The Ubiquitous Wayfarer"],
  fm: { aliases: ["The Ubiquitous Wayfarer", "Wayfarer", "Ο Πανταχού Οδοιπόρος"], scape: "Wayfarer tavern", atlas: "Ο Πανταχού Οδοιπόρος" } });
const prison = K.thingOf({ key: "prison", kind: "place", title: "Η Φυλακή", names: ["The Prison"],
  fm: { aliases: ["The Prison", "Prison", "Η Φυλακή"], theater: ["Ch02 - 11 - Outside the Prison", "Ch02 - 11 - Outside the Prison - antipeak (searchlights)"] } });
const mortuary = K.thingOf({ key: "mortuary", kind: "place", title: "Το Νεκροτομείο", names: ["The Mortuary"],
  fm: { aliases: ["The Mortuary", "Mortuary"], theater: ["The Mortuary", "Ch01 - 04 - M1 Morgue", "Ch01 - 04 - M1 Morgue + Morte", "Ch01 - 08 - M5 Crematorium + Maurice (eye level)"] } });
const blackHood = K.thingOf({ key: "black-hood", kind: "place", title: "Η Μαύρη Κουκούλα", names: ["The Black Hood"],
  fm: { aliases: ["The Black Hood", "Black Hood", "Η Μαύρη Κουκούλα"] } });
const mapped = K.thingOf({ key: "gatehouse", kind: "place", title: "Το Πυλόσπιτο", names: ["The Gatehouse"],
  fm: { theater: { "gatehouse": "Ch02 - 09 - The Gatehouse (Bleak Cabal)", "gatehouse@night": "Gatehouse Night Market" } } });
const riaen = K.thingOf({ key: "riaen", kind: "npc", title: "Ράιεν Μπλάκχοουμ", names: ["Riaen Blackhome"], fm: { aliases: ["Riaen Blackhome", "Riaen", "Ράιεν"] } });
const morte = K.thingOf({ key: "morte", kind: "npc", title: "Μόρτε", names: ["Morte"], fm: { aliases: ["Morte", "Μόρτε"] } });
const farrow = K.thingOf({ key: "farrow", kind: "npc", title: "Φάροου", names: ["Farrow"], fm: { aliases: ["Farrow", "Φάροου"], actor: "Farrow (Shadar-kai)" } });
const all = new Map([wayfarer, prison, mortuary, blackHood, mapped, riaen, morte, farrow].map(t => [t.key, t]));
const thingFor = k => all.get(k) ?? null;

test("parseKey: keys, people and variants; names and Theater words are not keys", () => {
  assert.deepEqual(K.parseKey("wayfarer+riaen"), { key: "wayfarer+riaen", base: "wayfarer", with: ["riaen"], variant: null });
  assert.deepEqual(K.parseKey("prison@antipeak"), { key: "prison@antipeak", base: "prison", with: [], variant: "antipeak" });
  assert.equal(K.parseKey("hall-of-records").base, "hall-of-records");
  assert.deepEqual(K.parseKey("wayfarer+riaen+parisa@night").with, ["riaen", "parisa"]);
  for ( const s of ["The Ubiquitous Wayfarer", "Ch02 - 04 - The Black Hood", "off", "Wayfarer", "Ράιεν", "a b", "", "x@", "+riaen"] ) assert.equal(K.parseKey(s), null, s);
});

test("thingOf: the English name is the first name without Greek", () => {
  assert.equal(wayfarer.en, "The Ubiquitous Wayfarer");
  assert.equal(riaen.en, "Riaen Blackhome");
  assert.equal(mapped.theater.length, 2, "a theater map's labels are its list too");
});

test("theaterPlace: the note's own plain label, a variant, and a +npc label", () => {
  const labels = ["Ch02 - 11 - Outside the Prison", "Ch02 - 11 - Outside the Prison - antipeak (searchlights)", "The Mortuary", "Ch01 - 04 - M1 Morgue + Morte"];
  assert.deepEqual(K.theaterPlace(prison, K.parseKey("prison"), { labels }), { name: "Ch02 - 11 - Outside the Prison", exists: true, create: null });
  assert.equal(K.theaterPlace(prison, K.parseKey("prison@antipeak"), { labels }).name, "Ch02 - 11 - Outside the Prison - antipeak (searchlights)");
  assert.equal(K.theaterPlace(mortuary, K.parseKey("mortuary"), { labels }).name, "The Mortuary");
  assert.equal(K.theaterPlace(mortuary, K.parseKey("mortuary+morte"), { labels, thingFor }).name, "Ch01 - 04 - M1 Morgue + Morte");
});

test("theaterPlace: a server label that names the place is found without a mapping", () => {
  const labels = ["Ch02 - 05 - The Ubiquitous Wayfarer", "Ch02 - 05 - The Ubiquitous Wayfarer + Riaen", "A Market Ward street"];
  assert.equal(K.theaterPlace(wayfarer, K.parseKey("wayfarer"), { labels, thingFor }).name, "Ch02 - 05 - The Ubiquitous Wayfarer");
  const r = K.theaterPlace(wayfarer, K.parseKey("wayfarer+riaen"), { labels, thingFor });
  assert.deepEqual(r, { name: "Ch02 - 05 - The Ubiquitous Wayfarer + Riaen", exists: true, create: null });
});

test("theaterPlace: not on the server → planned, with the file name to create", () => {
  // Listed in the note, not uploaded.
  const listed = K.theaterPlace(mortuary, K.parseKey("mortuary+maurice@eye"), { labels: ["The Mortuary"], thingFor: k => (k === "maurice" ? { en: "Maurice", names: ["Maurice"] } : null) });
  assert.deepEqual(listed, { name: "Ch01 - 08 - M5 Crematorium + Maurice (eye level)", exists: false, create: "Ch01 - 08 - M5 Crematorium + Maurice (eye level).webp" });
  // Nowhere: the § 9.4 template.
  const none = K.theaterPlace(blackHood, K.parseKey("black-hood"), { labels: [] });
  assert.equal(none.exists, false);
  assert.equal(none.create, "ChNN - NN - The Black Hood.webp");
  const jet = K.theaterPlace(blackHood, K.parseKey("black-hood+jet"), { labels: ["Ch02 - 19 - The Black Hood"], thingFor: () => ({ en: "Jet", names: ["Jet"] }) });
  assert.equal(jet.create, "Ch02 - 19 - The Black Hood + Jet.webp", "numbered like the place's image on the server");
  const night = K.theaterPlace(prison, K.parseKey("prison+riaen@night"), { labels: [], thingFor });
  assert.equal(night.create, "Ch02 - 11 - The Prison + Riaen Blackhome - night.webp", "numbered like the note's other scenes");
  // Theater not active: no check, no plan.
  assert.deepEqual(K.theaterPlace(prison, K.parseKey("prison"), { labels: null }), { name: "Ch02 - 11 - Outside the Prison", exists: null, create: null });
});

test("theaterPlace: a frontmatter map wins", () => {
  assert.equal(K.theaterPlace(mapped, K.parseKey("gatehouse@night"), { labels: ["Gatehouse Night Market"] }).name, "Gatehouse Night Market");
  assert.equal(K.theaterPlace(mapped, K.parseKey("gatehouse"), { labels: [] }).create, "Ch02 - 09 - The Gatehouse (Bleak Cabal).webp");
});

test("theaterCast: the NPC card by English name, a (state) variant, or planned", () => {
  const labels = ["Riaen Blackhome", "Farrow", "Farrow (Glitch)", "Morte"];
  assert.deepEqual(K.theaterCast(riaen, K.parseKey("riaen"), { labels }), { name: "Riaen Blackhome", exists: true, create: null });
  assert.equal(K.theaterCast(farrow, K.parseKey("farrow"), { labels }).name, "Farrow");
  assert.equal(K.theaterCast(farrow, K.parseKey("farrow@glitch"), { labels }).name, "Farrow (Glitch)");
  assert.deepEqual(K.theaterCast(morte, K.parseKey("morte@angry"), { labels }), { name: "Morte (Angry)", exists: false, create: "Morte (Angry).webp" });
});

test("scapeFor and actorFor: the note's field, else the English name", () => {
  assert.deepEqual(K.scapeFor(wayfarer, { names: ["Wayfarer Tavern"] }), { name: "Wayfarer tavern", exists: true, create: null });
  assert.deepEqual(K.scapeFor(blackHood, { names: [] }), { name: "The Black Hood", exists: false, create: "The Black Hood" });
  assert.equal(K.actorFor(farrow), "Farrow (Shadar-kai)");
  assert.equal(K.actorFor(riaen), "Riaen Blackhome");
});

test("splitButton / joinButton keep options, verbs and labels", () => {
  const b = K.splitButton("@Place[wayfarer+riaen | to=Nanouk | mode=window]{Οδοιπόρος}");
  assert.equal(b.module, "Place");
  assert.equal(b.target, "wayfarer+riaen");
  assert.equal(K.joinButton(b, "Ch02 - 05 - X"), "@Place[Ch02 - 05 - X | to=Nanouk | mode=window]{Οδοιπόρος}");
  const a = K.splitButton("@Atlas[reveal: wayfarer]");
  assert.equal(a.target, "wayfarer");
  assert.equal(K.joinButton(a, "Ο Πανταχού Οδοιπόρος"), "@Atlas[reveal: Ο Πανταχού Οδοιπόρος]");
  assert.equal(K.splitButton("@UUID[Actor.x]{X}"), null);
});

test("defaultLabel: the Greek names of the place and the people", () => {
  assert.equal(K.defaultLabel(wayfarer, K.parseKey("wayfarer+riaen"), thingFor), "Ο Πανταχού Οδοιπόρος + Ράιεν Μπλάκχοουμ");
  assert.equal(K.defaultLabel(prison, K.parseKey("prison@antipeak"), thingFor), "Η Φυλακή · antipeak");
});

test("triggers by key: at=wayfarer wakes on the Theater label and on the Atlas's Greek name", () => {
  const beats = [{ id: "a", at: ["wayfarer"] }, { id: "b", at: ["riaen"] }, { id: "c", at: ["prison"] }];
  const expand = t => K.triggerNames(t, thingFor);
  const ids = ctx => beatsFor(beats, ctx, {}, expand).map(b => b.id);
  assert.deepEqual(ids({ kind: "place", text: "Ο Πανταχού Οδοιπόρος" }), ["a"]);
  assert.deepEqual(ids({ kind: "place", text: "Ch02 - 05 - The Ubiquitous Wayfarer" }), ["a"]);
  assert.deepEqual(ids({ kind: "npc", text: "Riaen Blackhome" }), ["b"]);
  assert.deepEqual(ids({ kind: "place", text: "Ch02 - 11 - Outside the Prison" }), ["c"]);
  // Without the expansion the Greek Atlas name doesn't match the key.
  assert.deepEqual(beatsFor(beats, { kind: "place", text: "Ο Πανταχού Οδοιπόρος" }).map(b => b.id), []);
});

test("convertMarkdown: GM buttons go through resolveButton; players' HTML never does", () => {
  const md = "@Place[wayfarer]{Πάμε} and @Scape[black-hood] and @UUID[Actor.x]{X}";
  const resolveButton = raw => (raw.startsWith("@Place") ? { text: "@Place[Ch02 - 05 - The Ubiquitous Wayfarer]{Πάμε}" }
    : raw.startsWith("@Scape") ? { html: "<span class=\"codex-planned\">♪</span>" } : null);
  const gm = M.convertMarkdown(md, { render, parseFragment, gm: true, resolveButton }).html;
  assert.match(gm, /@Place\[Ch02 - 05 - The Ubiquitous Wayfarer\]\{Πάμε\}/);
  assert.match(gm, /<span class="codex-planned">♪<\/span>/);
  assert.match(gm, /@UUID\[Actor\.x\]\{X\}/);
  const player = M.convertMarkdown(md, { render, parseFragment, gm: false, resolveButton }).html;
  assert.match(player, /@Place\[wayfarer\]\{Πάμε\}/);
  // A resolver that throws leaves the button as written.
  const safe = M.convertMarkdown(md, { render, parseFragment, gm: true, resolveButton: () => { throw new Error("x"); } }).html;
  assert.match(safe, /@Place\[wayfarer\]/);
});
