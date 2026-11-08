#!/usr/bin/env node
/**
 * Ready check: are the vault's notes ready for the Prompter and the Lens?
 *
 *   node tools/ready-check.mjs <vault> [--note "Prep/Session 04 - run sheet.md"] [--json]
 *
 * Reads the notes with the module's own parsers (scripts/prompter/core.mjs, scripts/lens/core.mjs,
 * scripts/library/core.mjs) and lists what won't work at the table:
 *   ✗ error   the Prompter or the Lens can't use it (a beat with no moment, a person with no want / fear / tell …)
 *   ! warning it works, but less well than it could (a place trigger the Atlas will never report, a name with no Greek …)
 * Exit code 1 when there is an error. Nothing is written.
 *
 * What it knows about the table comes from the vault: the Atlas pack (Foundry/atlas/*-pack.json: the names stops are
 * recorded by), the Theater images (Visuals/WebP: the labels Theater reports), the heroes (Campaign/Players, type pc),
 * the ledger, the glossary, the book codes (Sources/INDEX.md).
 */
import fs from "node:fs";
import path from "node:path";
import { splitFrontmatter, fmList, citationRegex, DEFAULT_CITATION_PREFIXES } from "../scripts/markdown.mjs";
import { parseBeats, triggerMatches, isKindOfMoment, fold, inferKind, KINDS } from "../scripts/prompter/core.mjs";
import * as L from "../scripts/lens/core.mjs";
import { parseBookIndex } from "../scripts/library/core.mjs";

/** Note types the module and the guide know. */
export const TYPES = new Set(["state", "npcs", "ledger", "reference", "pc", "homebrew", "prep", "session", "handout", "template",
  "visuals", "notes", "index", "plan", "npc", "place", "glossary", "guide"]);
/** Folders that are not campaign notes. */
const SKIP = /^(Sources|Tools|Visuals|_Archive|#SyncVersion|\.obsidian|\.stfolder|Foundry)(\/|$)|(^|\/)\./;
/** Keyword triggers the Prompter matches by itself (not names). */
const KEYWORD_CONTEXTS = [
  { kind: "start" }, { kind: "rest", long: true }, { kind: "rest", long: false }, { kind: "combat" }, { kind: "death" },
  { kind: "time", text: "night" }, { kind: "time", text: "νύχτα" }, { kind: "time", text: "antipeak" }, { kind: "time", text: "αντιζενίθ" },
  { kind: "time", text: "peak" }, { kind: "time", text: "ζενίθ" }, { kind: "time", text: "morning" }, { kind: "time", text: "πρωί" },
  { kind: "time", text: "evening" }, { kind: "time", text: "βράδυ" }
];
const MAX_DECK = 8;
const hasGreek = s => /[Ͱ-Ͽἀ-῿]/.test(s);
const hasLatin = s => /[A-Za-z]/.test(s);

/* -------------------------------------------- */
/*  Reading the vault                           */
/* -------------------------------------------- */

function walk(dir, base = dir, out = []) {
  for ( const e of fs.readdirSync(dir, { withFileTypes: true }) ) {
    const p = path.join(dir, e.name);
    const rel = path.relative(base, p).split(path.sep).join("/");
    if ( SKIP.test(rel) ) continue;
    if ( e.isDirectory() ) walk(p, base, out);
    else if ( e.name.endsWith(".md") ) out.push(rel);
  }
  return out;
}

function listFiles(dir, re) {
  const out = [];
  if ( !fs.existsSync(dir) ) return out;
  (function go(d) {
    for ( const e of fs.readdirSync(d, { withFileTypes: true }) ) {
      const p = path.join(d, e.name);
      if ( e.isDirectory() ) go(p);
      else if ( re.test(e.name) ) out.push(p);
    }
  })(dir);
  return out;
}

/** Everything the checks compare against. */
export function readTable(vault, notes) {
  const t = { atlas: [], theater: [], heroes: new Map(), ledger: new Set(), names: null, books: new Set(), people: [] };
  // Atlas places: the names a stop is reported by.
  for ( const f of listFiles(path.join(vault, "Foundry", "atlas"), /-pack\.json$/) ) {
    try {
      const pack = JSON.parse(fs.readFileSync(f, "utf8"));
      for ( const p of pack.places ?? [] ) t.atlas.push({ id: p.id, el: p.name?.el ?? "", en: p.name?.en ?? "" });
    } catch(err) { /* a broken pack is the pack builder's business */ }
  }
  // Theater: images are labelled by their file name.
  for ( const f of listFiles(path.join(vault, "Visuals", "WebP"), /\.(webp|png|jpe?g)$/i) ) {
    if ( /Characters[\\/]Players|Maps|Style/.test(f) ) continue;
    t.theater.push(path.basename(f).replace(/\.[^.]+$/, "").replace(/^\d+\s*-\s*/, ""));
  }
  // Heroes, by every name their digest gives.
  for ( const n of notes.filter(n => n.type === "pc") ) {
    const names = [path.basename(n.path, ".md"), ...n.aliases];
    for ( const x of names ) t.heroes.set(fold(x), path.basename(n.path, ".md"));
  }
  for ( const n of notes.filter(n => n.type === "ledger") ) for ( const r of L.parseLedger(n.text) ) t.ledger.add(r.n);
  const groups = notes.filter(n => n.tags.includes("glossary") || n.type === "glossary").flatMap(n => L.parseGlossary(n.text));
  t.people = notes.filter(n => ["npcs", "people"].includes(n.type)).flatMap(n => L.parsePeople(n.text, n.path))
    .concat(notes.filter(n => n.tags.includes("people") && !["npcs", "people"].includes(n.type)).flatMap(n => L.parsePeople(n.text, n.path, { requireWft: true })));
  t.names = new L.NameBook([...groups, ...t.people.map(p => [p.name, ...p.aliases])]);
  t.glossary = new L.NameBook(groups);
  const index = path.join(vault, "Sources", "INDEX.md");
  if ( fs.existsSync(index) ) for ( const r of parseBookIndex(fs.readFileSync(index, "utf8")) ) t.books.add(r.code.toLowerCase());
  return t;
}

export function readNotes(vault, only = null) {
  return walk(vault).filter(p => !only || p === only).map(p => {
    const text = fs.readFileSync(path.join(vault, p), "utf8");
    const { data, body, hasFrontmatter } = frontmatter(text);
    return { path: p, text, body, fm: data, hasFrontmatter, type: String(data.type ?? "").toLowerCase(),
      tags: fmList(data, "tags").map(x => String(x).toLowerCase().replace(/^#/, "")), aliases: fmList(data, "aliases").map(String) };
  });
}

function frontmatter(text) {
  const r = splitFrontmatter(text);
  return { data: r.data ?? r.frontmatter ?? {}, body: r.body ?? r.content ?? text, hasFrontmatter: /^---\r?\n/.test(text) };
}

/* -------------------------------------------- */
/*  Checks                                      */
/* -------------------------------------------- */

/** All findings for one note: [{level: "error"|"warn", msg, line?}]. */
export function checkNote(n, t, all = []) {
  const out = [];
  const err = (msg, line) => out.push({ level: "error", msg, line });
  const warn = (msg, line) => out.push({ level: "warn", msg, line });
  const name = path.basename(n.path, ".md");

  // Frontmatter: every note says what it is, so the Lens knows how to read it.
  if ( !n.hasFrontmatter || !n.type ) { err("no `type` in the frontmatter: the Lens can't tell what this note is (CLAUDE § 9)"); return out; }
  if ( !TYPES.has(n.type) ) warn(`type \`${n.type}\` isn't one the guide knows (${[...TYPES].join(", ")})`);
  if ( n.type === "prep" && (n.tags.includes("visuals") || /image prompts/i.test(n.path)) ) {
    err("image prompts typed `prep`: the Lens would list them under «In the prep» for every place and NPC. Use `type: visuals`");
  }
  if ( n.type === "template" ) return out;

  // Names in both languages for the things people will look up.
  const isPersonNote = ["pc", "npc", "place"].includes(n.type) || (n.type === "homebrew" && n.tags.some(x => ["npc", "place"].includes(x)));
  if ( isPersonNote ) {
    const names = [name, ...n.aliases];
    if ( !names.some(hasGreek) ) warn("no Greek name in `aliases`: a Greek search in the Lens won't find this note");
    if ( !names.some(hasLatin) ) warn("no English name in `aliases`");
  }

  // People: an NPC note, or a note tagged `people`.
  const tagged = n.tags.includes("people") && !["npcs", "people"].includes(n.type);
  if ( ["npcs", "people"].includes(n.type) || tagged ) {
    const people = L.parsePeople(n.text, n.path, { requireWft: tagged });
    if ( tagged && !people.length ) warn("tagged `people` but no person with a «Want / Fear / Tell» was found");
    for ( const p of people ) {
      if ( !p.fields.some(f => f.kind === "wft") && !p.row ) err(`«${p.name}»: no **Want / Fear / Tell:** line (the Lens shows it first)`, p.line);
      const expanded = t.glossary.expand(p.name).names.concat(p.aliases);
      if ( !expanded.some(hasGreek) || !expanded.some(hasLatin) ) {
        warn(`«${p.name}»: only one language. Write «Greek (English; role)» or add a glossary row`, p.line);
      }
    }
    // In NPC tables: «**Greek** (English, role)» reads the role as a second name.
    for ( const table of L.tablesOf(n.text) ) {
      if ( !/^(npc|name|who)$/i.test(L.stripMd(table.header[0] ?? "")) ) continue;
      for ( const row of table.rows ) {
        const m = (row.cells[0] ?? "").match(/^\*\*([^*]+)\*\*\s*\(([^);]*,[^);]*)\)/);
        if ( m ) warn(`«${m[1].trim()} (${m[2]})»: separate the other name from the role with «;» («(English name; role)»)`, row.line);
      }
    }
  }
  if ( n.type === "prep" && !tagged && /^\|\s*NPC\s*\|.*Want/im.test(n.text) ) {
    warn("has an NPC voice-notes table but no `people` tag: the Lens won't show these NPCs before the party meets them");
  }

  // The ledger.
  if ( n.type === "ledger" ) {
    const rows = L.parseLedger(n.text);
    if ( !rows.length ) err("no numbered rows (a table whose first column is `#`)");
    const seen = new Map();
    for ( const r of rows ) {
      if ( seen.has(r.n) ) err(`#${r.n} is used twice`, r.line);
      seen.set(r.n, r.line);
      if ( !L.stripMd(r.owner) ) warn(`#${r.n}: no Owner`, r.line);
      if ( !L.stripMd(r.status) ) warn(`#${r.n}: no Status`, r.line);
    }
  }

  // The deck.
  const beats = /\[!beat\b/i.test(n.text) ? parseBeats(n.text) : [];
  if ( beats.length ) checkDeck(beats, n, t, all, err, warn);

  // Sessions.
  if ( n.type === "session" ) {
    if ( !n.fm.session ) warn("no `session:` in the frontmatter");
    if ( !/\[\[[^\]]*run sheet/i.test(n.text) ) warn("doesn't link the run sheet it used");
  }

  // Book citations: which books they name that the Library doesn't have (reported once, at the end).
  if ( t.books.size ) {
    const re = citationRegex(DEFAULT_CITATION_PREFIXES);
    for ( const m of n.text.matchAll(/`([^`\n]+)`/g) ) {
      const c = m[1].trim();
      if ( !re.test(c) ) continue;
      const first = c.split(/[\s,›]/)[0];
      // "Ch. 14 › P5", "Introduction › …": a place in the book cited before it.
      if ( /^(ch|chapter|part|introduction|intro|conclusion|appendix|app)\.?$/i.test(first) ) continue;
      const code = first.replace(/[^\w]/g, "").toLowerCase();
      if ( code && !t.books.has(code) ) (t.otherBooks ??= new Set()).add(first);
    }
  }
  return out;
}

function checkDeck(beats, n, t, all, err, warn) {
  const active = beats.filter(b => b.priority !== "watch" && inferKind(b).kind !== "rule");
  if ( active.length > MAX_DECK ) warn(`${active.length} cards (watch and rule cards not counted): at most ${MAX_DECK}, unless some are absent heroes' cards (they sleep and don't count)`);
  const isPerson = name => t.people.some(p => [p.name, ...p.aliases].some(x => fold(L.stripMd(x)) === fold(name) || triggerMatches(name, { kind: "npc", text: L.stripMd(x) })));
  for ( const b of beats ) {
    const at = `«${b.title}»`;
    // Kinds (Codex 0.7): written, or guessed when Codex can tell.
    if ( b.kindRaw && !b.kind ) err(`${at}: \`kind=${b.kindRaw}\` isn't a kind (${KINDS.join(", ")})`, b.line);
    const k = inferKind(b, { isPerson });
    if ( b.kind && k.guess !== b.kind && k.sure && k.guess !== "story" ) warn(`${at}: \`kind=${b.kind}\`, but it reads like a ${k.guess} card: check which one is meant`, b.line);
    if ( !b.kind && !k.sure ) warn(`${at}: kind unclear (a roll with a rest or a fight *and* places to wait for): add \`kind=rule\` or \`kind=story\``, b.line);
    if ( k.kind === "rule" && b.priority === "must" ) warn(`${at}: a rule card is a reminder, never "must" (it is never missed): use \`watch\``, b.line);
    if ( !b.at.length ) { err(`${at}: no \`at=\`: the card never comes up by itself`, b.line); continue; }
    for ( const p of b.pc ) if ( !t.heroes.has(fold(p)) ) err(`${at}: pc «${p}» isn't a hero (Campaign/Players)`, b.line);
    for ( const x of b.ledger ) if ( t.ledger.size && !t.ledger.has(x) ) warn(`${at}: ledger #${x} isn't in the ledger`, b.line);
    const placesNamed = new Set();
    for ( const trig of b.at ) {
      // Watch cards listen for what a player says: their moments are never names.
      if ( b.priority === "watch" ) continue;
      if ( isKindOfMoment(trig) ) continue;
      if ( KEYWORD_CONTEXTS.some(c => triggerMatches(trig, c)) ) continue;
      const atlas = t.atlas.filter(p => triggerMatches(trig, { kind: "place", text: p.el }) || triggerMatches(trig, { kind: "place", text: p.en }));
      const theater = t.theater.filter(l => triggerMatches(trig, { kind: "place", text: l }));
      const person = t.people.some(p => [p.name, ...p.aliases].some(x => triggerMatches(trig, { kind: "npc", text: L.stripMd(x) })));
      for ( const p of atlas ) {
        placesNamed.add(p.id);
        if ( triggerMatches(trig, { kind: "place", text: p.el }) ) placesNamed.add(`${p.id}:el`);
      }
      if ( !atlas.length && !theater.length && !person ) {
        warn(`${at}: «${trig}» isn't a name the Atlas, Theater or an NPC card reports: shown on the card, never matched. Start it with «any …» if that's meant`, b.line);
      }
    }
    for ( const id of placesNamed ) {
      if ( id.endsWith(":el") || placesNamed.has(`${id}:el`) ) continue;
      const p = t.atlas.find(x => x.id === id);
      warn(`${at}: the Atlas reports «${p.en}» as «${p.el}»: add the Greek name to \`at=\` (Atlas stops are recorded in Greek)`, b.line);
    }
  }
}

/* -------------------------------------------- */
/*  Command line                                */
/* -------------------------------------------- */

export function run(vault, { only = null } = {}) {
  const everything = readNotes(vault);
  const table = readTable(vault, everything);
  const notes = only ? everything.filter(n => n.path === only) : everything;
  const results = notes.map(n => ({ path: n.path, findings: checkNote(n, table, everything) })).filter(r => r.findings.length);
  results.otherBooks = [...(table.otherBooks ?? [])].sort();
  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if ( isMain ) {
  const args = process.argv.slice(2);
  const vault = args.find(a => !a.startsWith("--"));
  if ( !vault ) {
    console.error("Usage: node tools/ready-check.mjs <vault> [--note <path in the vault>] [--json]");
    process.exit(2);
  }
  const i = args.indexOf("--note");
  const only = i >= 0 ? args[i + 1]?.replace(/\\/g, "/") : null;
  const results = run(vault, { only });
  if ( args.includes("--json") ) console.log(JSON.stringify(results, null, 2));
  else {
    let e = 0, w = 0;
    for ( const r of results ) {
      console.log(`\n${r.path}`);
      for ( const f of r.findings ) {
        if ( f.level === "error" ) e++; else w++;
        console.log(`  ${f.level === "error" ? "✗" : "!"} ${f.line !== undefined ? `line ${f.line + 1}: ` : ""}${f.msg}`);
      }
    }
    if ( results.otherBooks.length ) console.log(`\nCited, not in the Library (Sources/INDEX.md): ${results.otherBooks.join(", ")}`);
    console.log(`\n${e} error(s), ${w} warning(s) in ${results.length} note(s).`);
    process.exitCode = e ? 1 : 0;
  }
}
