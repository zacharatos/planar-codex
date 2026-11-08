#!/usr/bin/env node
/**
 * Ready check: are the vault's notes ready for the Prompter and the Lens?
 *
 *   node tools/ready-check.mjs <vault> [--note "Prep/Session 04 - run sheet.md"] [--json] [--assets]
 *
 *   --assets  also list every image the notes use (@Place, @Cast, embeds) with its path on the server, so you can
 *             check they are uploaded before the session (Visuals/WebP/<path> is dnd/<path> in Foundry's User Data),
 *             the planned ones (a key whose image doesn't exist yet: the file to create), and the soundscapes
 *             named by key (not checked: the soundscapes live in Foundry)
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
 *
 * Images: Visuals/WebP is the copy of the images that goes to the Foundry server, uploaded with the same folders under
 * User Data/dnd/. A Theater button (@Place, @Cast) finds its image by file name the way Theater does (exact name, then
 * "starts with", then "contains"; a place's leading "NN - " doesn't count), so a button that finds nothing here won't
 * find anything at the table either. (Whether the image is also added to a Theater scene on the server can't be
 * checked from the vault.)
 *
 * Keys (Codex 0.9): a button or trigger can name a place or person by the `key:` of its note
 * (`@Place[wayfarer+riaen]`, `@Cast[farrow@glitch]`, `at=wayfarer`). The check resolves it the way Codex does
 * (scripts/keys/core.mjs): a key whose image isn't in Visuals/WebP yet is "planned", reported with the file to create.
 */
import fs from "node:fs";
import path from "node:path";
import { splitFrontmatter, fmList, citationRegex, DEFAULT_CITATION_PREFIXES } from "../scripts/markdown.mjs";
import { parseBeats, triggerMatches, isKindOfMoment, fold, inferKind, KINDS } from "../scripts/prompter/core.mjs";
import * as L from "../scripts/lens/core.mjs";
import { parseBookIndex } from "../scripts/library/core.mjs";
import * as K from "../scripts/keys/core.mjs";

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
/** Visuals/WebP/<path> in the vault is <SERVER_ROOT>/<path> in Foundry's User Data. */
export const SERVER_ROOT = "dnd";
const IMAGE = /\.(webp|png|jpe?g|gif|avif)$/i;
/** Never uploaded: scratch work. */
const NOT_UPLOADED = /(^|\/)_work(\/|$)/;
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
  const t = { atlas: [], theater: [], heroes: new Map(), ledger: new Set(), names: null, books: new Set(), people: [], things: new Map() };
  // Keys: every place and NPC note with a `key:`.
  for ( const n of notes.filter(x => ["place", "npc"].includes(x.type) && x.fm.key) ) {
    const card = L.parseCard(n.text, n.type);
    const key = String(n.fm.key).trim();
    if ( !t.things.has(key) ) t.things.set(key, K.thingOf({ key, kind: n.type, title: card.name, names: [path.basename(n.path, ".md"), ...card.aliases], fm: n.fm }));
  }
  // Atlas places: the names a stop is reported by.
  for ( const f of listFiles(path.join(vault, "Foundry", "atlas"), /-pack\.json$/) ) {
    try {
      const pack = JSON.parse(fs.readFileSync(f, "utf8"));
      for ( const p of pack.places ?? [] ) t.atlas.push({ id: p.id, el: p.name?.el ?? "", en: p.name?.en ?? "" });
    } catch(err) { /* a broken pack is the pack builder's business */ }
  }
  // The WebP mirror: every image, by its path under Visuals/WebP (= its path under dnd/ on the server).
  const webp = path.join(vault, "Visuals", "WebP");
  t.assets = listFiles(webp, IMAGE).map(f => {
    const rel = path.relative(webp, f).split(path.sep).join("/");
    const label = assetLabel(rel);
    const group = /(^|\/)NPCs\//.test(rel) ? "cast" : /^(Places|Scenes)\//.test(rel) ? "place" : "other";
    return { rel, label, group, file: path.basename(rel), scratch: NOT_UPLOADED.test(rel) };
  });
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
/*  Images                                      */
/* -------------------------------------------- */

/** Theater's label for an image: the file name without extension and a leading "NN - " (planar-theater labelFromPath). */
export const assetLabel = rel => String(rel).split("/").pop().replace(/\.[^.]+$/, "").replace(/^\d+\s*[-_.]\s*/, "");
/** Theater's name folding (planar-theater foldName). */
const foldAsset = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

/** Blank out code (fenced blocks, inline spans) so examples aren't checked; line numbers stay. */
const withoutCode = text => String(text).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, m => m.replace(/[^\n]/g, " ")).replace(/`[^`\n]*`/g, m => " ".repeat(m.length));

/**
 * The images a note uses: Theater buttons, embeds, and image links (which Codex can't follow).
 * @returns {{kind: "place"|"cast"|"embed"|"link", name: string, line: number, raw: string}[]}
 */
export function assetRefs(text) {
  const src = withoutCode(text);
  const lineAt = i => src.slice(0, i).split("\n").length - 1;
  const out = [];
  for ( const m of src.matchAll(/@(Place|Cast)\[([^\]]+)\]/g) ) {
    const name = m[2].split("|")[0].trim();
    if ( !name || /^(off|clear)$/i.test(name) ) continue;
    out.push({ kind: m[1].toLowerCase(), name, line: lineAt(m.index), raw: m[0] });
  }
  for ( const m of src.matchAll(/(!?)\[\[([^\]|#]+?\.(?:webp|png|jpe?g|gif|avif))(?:[|#][^\]]*)?\]\]/gi) ) {
    out.push({ kind: m[1] ? "embed" : "link", name: m[2].trim(), line: lineAt(m.index), raw: m[0] });
  }
  for ( const m of src.matchAll(/!\[[^\]]*\]\(([^)\s]+?\.(?:webp|png|jpe?g|gif|avif))\)/gi) ) {
    out.push({ kind: "embed", name: decodeURIComponent(m[1]), line: lineAt(m.index), raw: m[0] });
  }
  return out;
}

/**
 * Which image a reference reaches. Theater buttons: Theater's own search (exact, then "starts with", then "contains")
 * over the place images (Places/, Scenes/) or the NPC cards (any NPCs/ folder). Embeds: the file, by name (Obsidian) or path.
 * @returns {{hits: object[], how: "exact"|"prefix"|"contains"|"file"|null}}
 */
export function resolveAsset(assets, ref) {
  if ( ref.kind === "place" || ref.kind === "cast" ) {
    const pool = assets.filter(a => a.group === ref.kind);
    const q = foldAsset(ref.name);
    for ( const [how, test] of [["exact", a => a === q], ["prefix", a => a.startsWith(q)], ["contains", a => a.includes(q)]] ) {
      const hits = pool.filter(a => test(foldAsset(a.label)));
      if ( hits.length ) return { hits, how };
    }
    return { hits: [], how: null };
  }
  const want = ref.name.replace(/\\/g, "/").replace(/^.*?Visuals\/(WebP\/)?/i, "");
  const stem = want.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  const hits = assets.filter(a => a.rel.toLowerCase() === want.replace(/\.[^.]+$/, ".webp").toLowerCase()
    || a.file.replace(/\.[^.]+$/, "").toLowerCase() === stem);
  return { hits, how: hits.length ? "file" : null };
}

/** The server path of an image in the mirror. */
export const serverPath = asset => `${SERVER_ROOT}/${asset.rel}`;

/**
 * A Theater button written with a key: the image name it resolves to, or a plan (the file to create).
 * @returns {{ref: object, planned: string|null}|null}  null: not a key of any note
 */
export function resolveKeyRef(t, ref) {
  if ( ref.kind !== "place" && ref.kind !== "cast" ) return null;
  const p = K.parseKey(ref.name);
  const thing = p ? t.things.get(p.base) : null;
  if ( !thing ) return null;
  const labels = t.assets.filter(a => a.group === ref.kind).map(a => a.label);
  const thingFor = k => t.things.get(k) ?? null;
  const r = ref.kind === "place" ? K.theaterPlace(thing, p, { thingFor, labels }) : K.theaterCast(thing, p, { labels });
  return { ref: { ...ref, name: r.name }, planned: r.exists === false ? r.create : null };
}

function checkAssets(n, t, err, warn) {
  if ( !t.assets?.length ) return [];
  const used = [];
  const planned = [];
  Object.defineProperty(used, "planned", { value: planned, enumerable: false });
  for ( let ref of assetRefs(n.text) ) {
    // A key: the name it resolves to, or a planned image (a warning, with the file to create).
    const keyed = resolveKeyRef(t, ref);
    if ( keyed?.planned ) {
      const where = ref.kind === "place" ? "Visuals/WebP/Scenes/ChapterNN/ (or Places/)" : "Visuals/WebP/Characters/NPCs/<Part>/";
      warn(`\`${ref.raw}\`: planned, no image yet. Create «${keyed.planned}» in ${where}; until then Codex shows a dashed chip`, ref.line);
      planned.push({ ref, create: keyed.planned, folder: where });
      continue;
    }
    if ( keyed ) ref = keyed.ref;
    const where = ref.kind === "place" ? "Visuals/WebP/Places or Scenes" : ref.kind === "cast" ? "an NPCs folder of Visuals/WebP" : "Visuals/WebP";
    if ( ref.kind === "link" ) {
      err(`\`${ref.raw}\`: a link to an image, which Codex shows as a broken link. Use a Theater button, or embed it with \`![[…webp]]\``, ref.line);
      continue;
    }
    const { hits, how } = resolveAsset(t.assets, ref);
    if ( !hits.length ) {
      err(`\`${ref.raw}\`: no image in ${where} is called that, so it can't be on the server either (check the name, or run Tools/make_webp.py)`, ref.line);
      continue;
    }
    const pick = hits[0];
    used.push({ ref, asset: pick });
    if ( pick.scratch ) warn(`\`${ref.raw}\` uses a scratch image (\`_work/\`), which isn't uploaded`, ref.line);
    if ( ref.kind === "embed" && !/\.webp$/i.test(ref.name) ) warn(`\`${ref.raw}\` embeds the original; Foundry has only the WebP copy: embed \`${pick.file}\``, ref.line);
    if ( hits.length > 1 && how !== "exact" ) {
      warn(`\`${ref.raw}\` matches ${hits.length} images by ${how === "prefix" ? "the start of the name" : "a part of the name"}; Theater shows whichever comes first in its list. Write the full name (e.g. «${hits[0].label}»)`, ref.line);
    }
    else if ( hits.length > 1 ) warn(`\`${ref.raw}\`: ${hits.length} images have this exact name (${hits.map(serverPath).join(", ")})`, ref.line);
  }
  return used;
}

/**
 * Soundscapes and Atlas places named by key. Soundscapes live in Foundry, so they are only listed (for --assets);
 * an Atlas key must be a place id in the Atlas pack, or its note's `atlas:` name must be.
 * @returns {{key: string, name: string, line: number}[]}  the soundscapes the notes name by key
 */
function checkKeyedButtons(n, t, warn) {
  const src = withoutCode(n.text);
  const lineAt = i => src.slice(0, i).split("\n").length - 1;
  const scapes = [];
  for ( const m of src.matchAll(/@(Scape|Atlas)\[[^\]\n]+\](?:\{[^}\n]*\})?/g) ) {
    const b = K.splitButton(m[0]);
    const p = b ? K.parseKey(b.target) : null;
    if ( !p ) continue;
    const thing = t.things.get(p.base);
    if ( b.module === "Scape" ) {
      if ( thing ) scapes.push({ key: p.key, name: K.scapeFor(thing).name, line: lineAt(m.index) });
      continue;
    }
    if ( !t.atlas.length || ["pay", "set"].includes(b.head.split(":")[0].trim().toLowerCase()) ) continue;
    const known = t.atlas.some(x => x.id === p.key) || (thing?.atlas && t.atlas.some(x => K.fold(x.el) === K.fold(thing.atlas) || K.fold(x.en) === K.fold(thing.atlas)));
    if ( !known ) warn(`\`${m[0]}\`: planned, the Atlas pack has no place with the id «${p.key}»${thing?.atlas ? ` or the name «${thing.atlas}»` : ""} (add it to Foundry/atlas/build_pack.py)`, lineAt(m.index));
  }
  return scapes;
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

  // Place and NPC notes (Codex 0.8 cards): sections the card knows; anything else is shown at the end, so a typo shows.
  if ( n.type === "place" || n.type === "npc" ) {
    const card = L.parseCard(n.text, n.type);
    if ( !card.name ) err("no `# Title` heading: the card has no name");
    if ( !n.fm.key ) warn("no `key:` in the frontmatter (the place's or person's stable id, e.g. `key: wayfarer`)");
    const known = Object.values(n.type === "place" ? L.PLACE_SECTIONS : L.NPC_SECTIONS).map(list => list[0]);
    for ( const sec of card.sections.filter(x => !x.id) ) warn(`section «${sec.heading}» isn't one the ${n.type === "place" ? "place" : "NPC"} card knows (${known.join(", ")}): it shows at the end`, sec.line);
    if ( n.type === "npc" && card.by.voice && !Object.keys(L.voiceOf(card.by.voice.body)).length ) warn("«Φωνή και τρόπος» has no **Μιλάει:** / **Κινείται:** / **Σημάδι:** / **Ατάκες:** bullets: the roleplay strip shows the section as text", card.by.voice.line);
    if ( n.type === "npc" && card.by.wfh && !Object.keys(L.wfhOf(card.by.wfh.body)).length ) warn("«Θέλει · Φοβάται · Κρύβει» has no **Θέλει:** / **Φοβάται:** / **Κρύβει:** bullets", card.by.wfh.line);
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

  // Images: every Theater button and embed must reach an image in the WebP mirror (what goes to the server).
  const assets = checkAssets(n, t, err, warn);
  Object.defineProperty(out, "assets", { value: assets, enumerable: false });
  Object.defineProperty(out, "planned", { value: assets.planned ?? [], enumerable: false });
  Object.defineProperty(out, "scapes", { value: checkKeyedButtons(n, t, warn), enumerable: false });

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
      // A key stands for its note's names (Codex 0.9): `at=wayfarer` matches what the Atlas and Theater report.
      const names = K.triggerNames(trig, k => t.things.get(k) ?? null);
      const any = ctx => names.some(x => triggerMatches(x, ctx));
      const atlas = t.atlas.filter(p => any({ kind: "place", text: p.el }) || any({ kind: "place", text: p.en }));
      const theater = t.theater.filter(l => any({ kind: "place", text: l }));
      const person = names.length > 1 && t.things.get(K.parseKey(trig)?.base)?.kind === "npc"
        || t.people.some(p => [p.name, ...p.aliases].some(x => any({ kind: "npc", text: L.stripMd(x) })));
      for ( const p of atlas ) {
        placesNamed.add(p.id);
        if ( any({ kind: "place", text: p.el }) ) placesNamed.add(`${p.id}:el`);
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
  const all = notes.map(n => {
    const findings = checkNote(n, table, everything);
    return { path: n.path, findings, assets: findings.assets ?? [], planned: findings.planned ?? [], scapes: findings.scapes ?? [] };
  });
  const results = all.filter(r => r.findings.length);
  results.otherBooks = [...(table.otherBooks ?? [])].sort();
  // Every image the notes use, once, with where it lives on the server.
  const seen = new Map();
  for ( const r of all ) for ( const { asset } of r.assets ) {
    if ( !seen.has(asset.rel) ) seen.set(asset.rel, { server: serverPath(asset), vault: `Visuals/WebP/${asset.rel}`, notes: [] });
    const e = seen.get(asset.rel);
    if ( !e.notes.includes(r.path) ) e.notes.push(r.path);
  }
  results.assets = [...seen.values()].sort((a, b) => a.server.localeCompare(b.server));
  // Planned images (keys whose image doesn't exist yet) and soundscapes named by key, once each.
  const once = (list, id, make) => {
    const map = new Map();
    for ( const r of all ) for ( const x of r[list] ) {
      const k = id(x);
      if ( !map.has(k) ) map.set(k, { ...make(x), notes: [] });
      if ( !map.get(k).notes.includes(r.path) ) map.get(k).notes.push(r.path);
    }
    return [...map.values()];
  };
  results.planned = once("planned", x => x.create, x => ({ create: x.create, folder: x.folder, key: x.ref.name }));
  results.scapes = once("scapes", x => x.name.toLowerCase(), x => ({ name: x.name, key: x.key }));
  for ( const r of results ) { delete r.assets; delete r.planned; delete r.scapes; }
  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if ( isMain ) {
  const args = process.argv.slice(2);
  const vault = args.find(a => !a.startsWith("--"));
  if ( !vault ) {
    console.error("Usage: node tools/ready-check.mjs <vault> [--note <path in the vault>] [--json] [--assets]");
    process.exit(2);
  }
  const i = args.indexOf("--note");
  const only = i >= 0 ? args[i + 1]?.replace(/\\/g, "/") : null;
  const results = run(vault, { only });
  if ( args.includes("--json") ) console.log(JSON.stringify(args.includes("--assets") ? { notes: [...results], otherBooks: results.otherBooks, assets: results.assets, planned: results.planned, scapes: results.scapes } : results, null, 2));
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
    if ( args.includes("--assets") ) {
      console.log(`\nImages used (${results.assets.length}): each must be on the server at User Data/<path> (upload Visuals/WebP → ${SERVER_ROOT}/ with the same folders)`);
      for ( const a of results.assets ) console.log(`  ${a.server}${only ? "" : `   ← ${a.notes.join(", ")}`}`);
      if ( results.planned.length ) {
        console.log(`\nPlanned images (${results.planned.length}): named by key in the notes, not made yet. Create them with these names and they work with no change to the notes`);
        for ( const p of results.planned ) console.log(`  ${p.create}   (${p.folder})${only ? "" : `   ← ${p.notes.join(", ")}`}`);
      }
      if ( results.scapes.length ) {
        console.log(`\nSoundscapes named by key (${results.scapes.length}; not checked: they live in Foundry's Soundboard)`);
        for ( const sc of results.scapes ) console.log(`  «${sc.name}» ← ${sc.key}`);
      }
    }
    console.log(`\n${e} error(s), ${w} warning(s) in ${results.length} note(s).`);
    process.exitCode = e ? 1 : 0;
  }
}
