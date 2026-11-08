/**
 * Planar Codex — Lens: gathering what the notes and the other modules know about a name (GM only).
 *
 * Notes are read by their frontmatter (`type: npcs`, `type: ledger`, `type: prep`, `type: session`, tag `glossary`),
 * parsed once per version of their Markdown. The other Planar modules are asked through their APIs, when active.
 */
import { MODULE_ID, getMarkdown, isCodexPage } from "../codex.mjs";
import { CITATION_RE, splitFrontmatter, fmList } from "../markdown.mjs";
import { linkIndex } from "../link-index.mjs";
import { sheetPage, readSheet, run } from "../prompter/state.mjs";
import * as L from "./core.mjs";

const api = id => { const m = game.modules.get(id); return m?.active ? m.api ?? null : null; };

/* -------------------------------------------- */
/*  Notes, parsed once per version              */
/* -------------------------------------------- */

const parsed = new WeakMap();
/** A page's Markdown parsed by `fn`, cached until the Markdown changes. */
function cached(page, key, fn) {
  const md = getMarkdown(page);
  let hit = parsed.get(page);
  if ( !hit || hit.md !== md ) { hit = { md, data: {} }; parsed.set(page, hit); }
  if ( !(key in hit.data) ) hit.data[key] = fn(md);
  return hit.data[key];
}
/** The text the Lens searches in a note: run sheets without their beats (those are listed as beats). */
const searchable = page => cached(page, "searchable", md => (/\[!beat\b/i.test(md) ? L.withoutBeats(md) : md));
const foldedOf = page => cached(page, "folded", () => L.fold(searchable(page)));

const meta = page => page.getFlag(MODULE_ID, "meta") ?? {};
const typeOf = page => String(meta(page).type ?? "").toLowerCase();
const tagsOf = page => (meta(page).tags ?? []).map(t => String(t).toLowerCase().replace(/^#/, ""));

/** Codex notes by kind. Rebuilt when the journal changes (cheap: flags only). */
function notesBy() {
  const out = { people: [], peopleTagged: [], ledger: [], glossary: [], prep: [], session: [], places: [], npcs: [] };
  for ( const entry of game.journal ) {
    for ( const page of entry.pages ) {
      if ( !isCodexPage(page) ) continue;
      const type = typeOf(page);
      const tags = tagsOf(page);
      if ( ["npcs", "people", "npc-list"].includes(type) ) out.people.push(page);
      // Other notes with people in them (a chapter prep's NPC voice notes, a homebrew NPC): tag `people`.
      else if ( tags.includes("people") ) out.peopleTagged.push(page);
      if ( type === "ledger" ) out.ledger.push(page);
      if ( type === "place" ) out.places.push(page);
      if ( type === "npc" ) out.npcs.push(page);
      if ( type === "glossary" || tags.includes("glossary") ) out.glossary.push(page);
      if ( type === "prep" ) out.prep.push(page);
      if ( type === "session" || tags.includes("session") ) out.session.push(page);
    }
  }
  const byNameDesc = (a, b) => b.parent.name.localeCompare(a.parent.name, undefined, { numeric: true });
  out.prep.sort(byNameDesc);
  out.session.sort(byNameDesc);
  return out;
}

const peopleOf = page => cached(page, "people", md => L.parsePeople(md, page.uuid));
/** People in a tagged note: only entries with a want / fear / tell (a scene heading with bold bullets isn't a person). */
const taggedPeopleOf = page => cached(page, "peopleTagged", md => L.parsePeople(md, page.uuid, { requireWft: true }));
const ledgerOf = page => cached(page, "ledger", md => L.parseLedger(md));
const glossaryOf = page => cached(page, "glossary", md => L.parseGlossary(md));

/**
 * A place or NPC note as a card, with the frontmatter fields the card uses (key, theater, scape, atlas, actor, book)
 * and every name it answers to.
 */
export function cardOf(page, kind) {
  return cached(page, `card-${kind}`, md => {
    const card = L.parseCard(md, kind);
    const data = splitFrontmatter(md).data ?? {};
    const list = k => fmList(data, k).map(String).filter(Boolean);
    const theater = data.theater && typeof data.theater === "object" && !Array.isArray(data.theater) ? Object.values(data.theater).map(String) : list("theater");
    const names = [...new Set([page.parent?.name, card.name, ...card.aliases, ...list("aliases"), data.key ? String(data.key).replace(/-/g, " ") : null].filter(Boolean).map(n => L.stripMd(n)))];
    return { kind, page, card, key: data.key ? String(data.key) : null, theater, scape: list("scape"), atlas: data.atlas ? String(data.atlas) : null,
      actor: data.actor ? String(data.actor) : null, book: list("book"), tags: list("tags"), names };
  });
}

/** The card notes that a set of names (and the raw query, for a Theater label) is about. */
function cardsFor(pages, kind, variants, query, { inQuery = false } = {}) {
  const q = ` ${L.fold(query)} `;
  const out = [];
  for ( const page of pages ) {
    const c = cardOf(page, kind);
    const own = c.names.flatMap(L.nameVariants);
    const direct = own.some(v => variants.includes(v)) || c.theater.some(t => L.fold(t) === L.fold(query));
    // "Ch02 - 04 - The Ubiquitous Wayfarer + Riaen Blackhome": the place is named inside the label.
    const named = inQuery && c.names.some(n => { const f = L.fold(n); return f.length >= 5 && q.includes(` ${f} `); });
    if ( direct || named ) out.push({ ...c, direct });
  }
  return out.sort((a, b) => b.direct - a.direct);
}

/** The NPC note for a name (a link target in a place's "who is here"), or null. */
export function npcCardNamed(name) {
  const v = L.nameVariants(name);
  for ( const page of notesBy().npcs ) {
    const c = cardOf(page, "npc");
    if ( c.names.flatMap(L.nameVariants).some(x => v.includes(x)) ) return c;
  }
  return null;
}

/** The name book: glossary rows and people's names. Rebuilt when one of its notes changes. */
let book = { key: "", value: null };
function nameBook(notes) {
  const pages = [...notes.glossary, ...notes.people, ...notes.peopleTagged, ...notes.places, ...notes.npcs];
  const key = pages.map(p => `${p.uuid}:${getMarkdown(p).length}:${p._stats?.modifiedTime ?? ""}`).join("|");
  if ( book.key === key && book.value ) return book.value;
  const groups = [
    ...notes.glossary.flatMap(glossaryOf),
    ...notes.people.flatMap(peopleOf).map(p => [p.name, ...p.aliases]),
    ...notes.peopleTagged.flatMap(taggedPeopleOf).map(p => [p.name, ...p.aliases])
  ];
  // Place and NPC notes, by name and aliases.
  for ( const page of [...notes.places, ...notes.npcs] ) {
    const c = cardOf(page, notes.places.includes(page) ? "place" : "npc");
    groups.push(c.names);
  }
  // Notes named for a thing, with their aliases (a note "Farrow - Echo of the Wheel" with aliases [Farrow]).
  for ( const e of linkIndex.index.entries ) if ( e.aliases?.length ) groups.push([e.name, ...e.aliases]);
  book = { key, value: new L.NameBook(groups) };
  return book.value;
}

/**
 * Is a name (an `at=` moment) a person the notes or the table know? People in NPC notes and tagged notes,
 * `type: npc` notes (name and aliases), NPC actors and Planar Theater NPC cards. Used to tell an NPC card (0.7 kinds).
 */
let people = { key: "", value: null };
export function isPersonName(name) {
  const f = L.fold(name);
  if ( f.length < 3 ) return false;
  const notes = notesBy();
  const pages = [...notes.people, ...notes.peopleTagged];
  const key = `${pages.map(p => `${p.uuid}:${getMarkdown(p).length}`).join("|")}#${game.actors?.size ?? 0}#${linkIndex.index.entries?.length ?? 0}`;
  if ( people.key !== key || !people.value ) {
    const set = new Set();
    const add = n => { for ( const v of L.nameVariants(n) ) set.add(v); };
    for ( const page of notes.people ) for ( const p of peopleOf(page) ) [p.name, ...p.aliases].forEach(add);
    for ( const page of notes.peopleTagged ) for ( const p of taggedPeopleOf(page) ) [p.name, ...p.aliases].forEach(add);
    for ( const e of linkIndex.index.entries ?? [] ) if ( String(e.page?.getFlag?.(MODULE_ID, "meta")?.type ?? "").toLowerCase() === "npc" ) [e.name, ...(e.aliases ?? [])].forEach(add);
    for ( const a of game.actors ?? [] ) if ( a.type === "npc" ) add(a.name);
    people = { key, value: set };
  }
  const mine = L.nameVariants(name);
  if ( mine.some(v => people.value.has(v)) ) return true;
  const cast = api("planar-theater")?.cast;
  return cast ? safe(() => cast()).some(c => [c.label, c.name].filter(Boolean).flatMap(L.nameVariants).some(v => mine.includes(v))) : false;
}

/** Names for a Lens query: "A · B" is several names (what Theater shows is often a place and its Greek title). */
export function expandQuery(query) {
  const notes = notesBy();
  const nb = nameBook(notes);
  const names = [];
  const variants = new Set();
  for ( const part of String(query ?? "").split(/\s+·\s+/).map(s => s.trim()).filter(Boolean) ) {
    const x = nb.expand(part);
    for ( const n of x.names ) if ( !names.some(m => L.fold(m) === L.fold(n)) ) names.push(n);
    for ( const v of x.variants ) variants.add(v);
  }
  return { notes, names, variants: [...variants] };
}

/* -------------------------------------------- */
/*  Everything about a name                     */
/* -------------------------------------------- */

/**
 * @param {string} query
 * @returns {object|null}  null when the query has no usable name
 */
export function gather(query) {
  const { notes, names, variants } = expandQuery(query);
  if ( !variants.length ) return null;
  const hit = text => L.mentions(L.fold(text), variants);
  const named = n => L.nameVariants(n).some(v => variants.includes(v));
  const out = { query, names, variants };

  // Place and NPC cards (0.8): the notes written for this place or person come first.
  out.placeCards = cardsFor(notes.places, "place", variants, query, { inQuery: true }).slice(0, 2);
  out.npcCards = cardsFor(notes.npcs, "npc", variants, query).slice(0, 3);
  // A place card lists who is there: their NPC notes, for the chips.
  for ( const p of out.placeCards ) {
    p.who = L.linkTargets(p.card.by.who?.body).map(t => npcCardNamed(t)).filter(Boolean);
  }

  // People: entries whose name or aliases are one of the names.
  // The NPC notes first (as played), then the tagged notes (as prepared, newest first): one card per person.
  const matching = (pages, parse) => pages.map(page => parse(page).filter(p => L.personVariants(p).some(v => variants.includes(v))).map(person => ({ person, page })));
  const tagged = [...notes.peopleTagged].sort((a, b) => b.parent.name.localeCompare(a.parent.name, undefined, { numeric: true }));
  out.people = L.mergeAcross([...matching(notes.people, peopleOf), ...matching(tagged, taggedPeopleOf)]);
  out.people.forEach(p => { p.prepared = !notes.people.includes(p.page); });
  // Someone with an NPC note: the card shows them, with how they were played (npcs.md) inside it.
  for ( const c of out.npcCards ) {
    const own = c.names.flatMap(L.nameVariants);
    c.played = out.people.find(({ person, prepared }) => !prepared && L.personVariants(person).some(v => own.includes(v))) ?? null;
  }
  out.people = out.people.filter(p => !out.npcCards.some(c => c.played === p || L.personVariants(p.person).some(v => c.names.flatMap(L.nameVariants).includes(v))));

  // Notes named for it (by note name or alias), other than the people notes.
  const notePages = [];
  const cardPages = new Set([...out.placeCards, ...out.npcCards].map(c => c.page));
  for ( const e of linkIndex.index.entries ) {
    if ( notes.people.includes(e.page) || cardPages.has(e.page) ) continue;
    if ( [e.name, ...(e.aliases ?? [])].some(named) ) notePages.push(e.page);
  }
  out.notes = notePages.slice(0, 6);

  // Planar Atlas: a place with one of these names.
  out.place = null;
  const atlas = api("planar-atlas");
  if ( atlas?.findPlace ) {
    for ( const n of names ) {
      let p = null;
      try { p = atlas.findPlace(n); } catch(err) { /* a malformed place: ignore */ }
      if ( p && named(p.name ?? "") ) { out.place = p; break; }
    }
  }

  // Planar Theater: places and NPC cards whose label names it.
  const theater = api("planar-theater");
  const label = t => [t.label, t.title].filter(Boolean).join(" ");
  out.stage = theater?.places ? safe(() => theater.places()).filter(t => hit(label(t))).slice(0, 4) : [];
  out.cards = theater?.cast ? safe(() => theater.cast()).filter(t => hit(label(t))).slice(0, 4) : [];

  // Planar Store: shops here, or kept by this person.
  const store = api("planar-store");
  out.shops = store?.shops ? safe(() => store.shops()).filter(s => hit([s.name, s.nameEn, s.atlasPlace, s.place, s.owner?.name, s.owner?.nameEn].filter(Boolean).join(" · ")))
    .slice(0, 4) : [];

  // Planar Factions: contacts with this name, debts and favours that involve it.
  const factions = api("planar-factions");
  const view = factions?.view ? safe(() => factions.view({ gm: true }), null) : null;
  out.contacts = (view?.contacts ?? []).filter(c => named(c.name ?? "") || hit(c.name ?? "")).slice(0, 4);
  out.favours = (view?.ledger ?? []).filter(e => e.status === "open" && hit([e.withName, e.what].join(" "))).slice(0, 6);

  // The Prompter: tonight's beats and notes.
  const sheet = sheetPage();
  const r = run(sheet);
  out.beats = (readSheet(sheet)?.beats ?? []).filter(b => hit([b.title, b.at.join(" "), b.pc.join(" "), b.body].join(" ")))
    .map(b => ({ beat: b, status: r.beats[b.id]?.s ?? null }));
  out.tonight = (r.notes ?? []).filter(n => hit(n.text)).slice(-6);

  // Threads: ledger rows that mention it.
  out.threads = notes.ledger.flatMap(page => ledgerOf(page).filter(row => hit(L.ledgerText(row))).map(row => ({ row, page })));

  // The prep and the sessions that mention it (the most recent notes first).
  const inNotes = (pages, perPage, maxPages) => {
    const list = [];
    for ( const page of pages ) {
      if ( !L.mentions(foldedOf(page), variants) ) continue;
      const hits = L.mentionsIn(searchable(page), variants, perPage);
      if ( hits.length ) list.push({ page, hits });
      if ( list.length >= maxPages ) break;
    }
    return list;
  };
  out.prep = inNotes(orderPrep(notes.prep, sheet), 3, 4);
  out.sessions = inNotes(notes.session, 1, 3);

  // Book citations from the people and the threads.
  const cites = [];
  const addCites = text => { for ( const c of L.citationsIn(text, CITATION_RE) ) if ( !cites.includes(c) && !/^›/.test(c) ) cites.push(c); };
  for ( const { person } of out.people ) for ( const f of person.fields ) addCites(f.value);
  for ( const { row } of out.threads ) addCites(row.payoff);
  out.cites = cites.slice(0, 6);

  out.empty = !(out.placeCards.length || out.npcCards.length || out.people.length || out.notes.length || out.place || out.stage.length || out.cards.length || out.shops.length
    || out.contacts.length || out.favours.length || out.beats.length || out.tonight.length || out.threads.length || out.prep.length || out.sessions.length);
  return out;
}

/** Tonight's run sheet first, then the newest chapter prep, then the rest. */
function orderPrep(pages, sheet) {
  const isRunSheet = p => /run.?sheet/i.test(p.parent.name) || /\[!beat\b/i.test(getMarkdown(p));
  const rank = p => (p === sheet ? 0 : isRunSheet(p) ? 2 : 1);
  return [...pages].sort((a, b) => rank(a) - rank(b));
}

function safe(fn, fallback = []) {
  try { return fn() ?? fallback; } catch(err) { console.warn(`${MODULE_ID} | lens`, err); return fallback; }
}
