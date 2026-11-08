/**
 * Planar Codex — keys in Foundry (0.9): the keys of the place and NPC notes, what the other modules have on the
 * server, and the GM-view rewrite of module buttons written with a key (see keys/core.mjs).
 *
 *   @Place[wayfarer+riaen]   → @Place[Ch02 - 05 - The Ubiquitous Wayfarer + Riaen]{Ο Πανταχού Οδοιπόρος + Ράιεν}
 *   @Place[black-hood]       → a dashed "planned" chip (GM only): «create Ch02 - 19 - The Black Hood.webp», click copies
 *
 * Players never see a key: module buttons are GM-only (players see the label as plain words), and the stored player
 * HTML is untouched.
 */
import { localize, setButtonResolver } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { cardNotes } from "../lens/data.mjs";
import * as K from "./core.mjs";

const api = id => { const m = game.modules.get(id); return m?.active ? m.api ?? null : null; };
const safe = (fn, fallback = null) => { try { return fn() ?? fallback; } catch(err) { return fallback; } };

/* -------------------------------------------- */
/*  The keys of the notes                       */
/* -------------------------------------------- */

let version = 0;
let index = { version: -1, map: new Map() };

/** key → Thing, from every `type: place` / `type: npc` note with a `key:`. Rebuilt when a journal page changes. */
export function things() {
  if ( index.version === version ) return index.map;
  const map = new Map();
  for ( const c of safe(() => cardNotes(), []) ) {
    if ( !c.key || map.has(c.key) ) continue;
    map.set(c.key, K.thingOf({ key: c.key, kind: c.kind, title: c.card.name || c.page.parent?.name, names: [c.page.parent?.name, ...c.card.aliases], fm: c.fm ?? {} }));
  }
  index = { version, map };
  return map;
}
export const thingFor = key => things().get(String(key ?? "")) ?? null;

/* -------------------------------------------- */
/*  What the server has                         */
/* -------------------------------------------- */

let live = { at: 0, value: null };
const TTL = 2000;

/** The names the other modules know right now (null for a module that isn't active). Cached for two seconds. */
export function server() {
  if ( live.value && Date.now() - live.at < TTL ) return live.value;
  const theater = api("planar-theater");
  const sound = api("planar-soundboard") ?? globalThis.PlanarSoundboard ?? null;
  const labels = list => [...new Set(list.map(x => x.label).filter(Boolean))];
  const value = {
    places: theater?.places ? safe(() => labels(theater.places()), null) : null,
    cast: theater?.cast ? safe(() => labels(theater.cast()), null) : null,
    // Soundboard 1.4: scapes() / cues(); older versions only list() the soundscapes' names.
    scapes: sound?.scapes ? safe(() => sound.scapes().map(s => s.name), null) : sound?.list ? safe(() => sound.list(), null) : null,
    cues: sound?.cues ? safe(() => sound.cues().map(c => c.name), null) : null,
    atlas: api("planar-atlas")?.findPlace ? api("planar-atlas") : null,
    store: api("planar-store")?.shop ? api("planar-store") : null
  };
  live = { at: Date.now(), value };
  return value;
}

/** Changes when what the server has changes: part of the Prompter's card cache key, so a planned chip turns into a button. */
export function assetsVersion() {
  const s = server();
  // Not the notes' version: the Prompter writes its live log often, and every write would redraw every card.
  return `${s.places?.length ?? "-"}|${s.cast?.length ?? "-"}|${s.scapes?.length ?? "-"}|${s.cues?.length ?? "-"}`;
}

/* -------------------------------------------- */
/*  Buttons                                     */
/* -------------------------------------------- */

const ICONS = { Place: "fa-masks-theater", Cast: "fa-user", Scape: "fa-music", Cue: "fa-play", Atlas: "fa-map-pin", Shop: "fa-store" };

/** A dashed chip for something that isn't on the server yet: its tooltip says what to create; a click copies the name. */
export function plannedChip(module, label, create) {
  const tip = `${localize(`Keys.Missing.${module}`, { name: create })} ${localize("Keys.CopyHint")}`;
  return `<span class="codex-planned" data-codex-copy="${escapeHTML(create)}" data-tooltip="${escapeHTML(tip)}"><i class="fa-solid ${ICONS[module] ?? "fa-circle-question"}"></i> ${escapeHTML(label)}</span>`;
}

/**
 * A module button from a note, as the GM sees it: the key replaced by the real name, a planned chip, or null (leave it).
 * Buttons written with a full name are left alone, so old notes keep working.
 * @param {string} raw   e.g. `@Place[wayfarer+riaen | mode=window]{Οδοιπόρος}`
 * @returns {{text: string}|{html: string}|null}
 */
export function resolveButton(raw) {
  if ( !game.user?.isGM ) return null;
  const b = K.splitButton(raw);
  if ( !b ) return null;
  const s = server();

  // Cues are named «<key> - <what>» (`@Cue[wayfarer - portal hum]`): already the real name, only checked.
  if ( b.module === "Cue" ) {
    const m = b.target.match(/^([a-z0-9-]+)\s+-\s+\S/);
    if ( !m || !thingFor(m[1]) || !s.cues ) return null;
    return s.cues.some(n => K.fold(n) === K.fold(b.target)) ? null : { html: plannedChip("Cue", b.label ?? b.target, b.target) };
  }

  const p = K.parseKey(b.target);
  if ( !p ) return null;
  const thing = thingFor(p.base);
  const labelFor = () => b.label ?? (thing ? K.defaultLabel(thing, p, thingFor) : p.key);
  const done = (module, r) => (r.exists === false ? { html: plannedChip(module, labelFor(), r.create) } : { text: K.joinButton(b, r.name, labelFor()) });

  switch ( b.module ) {
    case "Place":
      if ( !thing ) return null;
      return done("Place", K.theaterPlace(thing, p, { thingFor, labels: s.places }));
    case "Cast":
      if ( !thing ) return null;
      return done("Cast", K.theaterCast(thing, p, { labels: s.cast }));
    case "Scape":
      if ( !thing ) return null;
      return done("Scape", K.scapeFor(thing, { names: s.scapes }));
    case "Atlas": {
      // Atlas finds a place by its id, which is the key: rewrite only when the place is known by the note's name.
      if ( !s.atlas || safe(() => s.atlas.findPlace(p.key)) ) return null;
      if ( thing?.atlas && safe(() => s.atlas.findPlace(thing.atlas)) ) return { text: K.joinButton(b, thing.atlas) };
      return { html: plannedChip("Atlas", b.label ?? (thing ? K.defaultLabel(thing, p, thingFor) : p.key), p.key) };
    }
    case "Shop":
      // Store finds a shop by its id; a key no shop has yet is planned.
      if ( !s.store || safe(() => s.store.shop(p.key)) ) return null;
      return { html: plannedChip("Shop", b.label ?? p.key, p.key) };
    default:
      return null;
  }
}

/** `[[actor:riaen]]`: the actor's name for a person's key (the note's `actor:`, else its English name), or null. */
export function actorNameForKey(name) {
  const p = K.parseKey(name);
  const thing = p ? thingFor(p.base) : null;
  return thing ? K.actorFor(thing) : null;
}

/** The names a beat trigger stands for: a key's note names, Theater labels and Atlas name (`at=wayfarer`). */
export const triggerNames = trigger => K.triggerNames(trigger, thingFor);

/** Is a trigger the key of a person's note (for card kinds: «at=riaen» is a person)? */
export function isPersonKey(name) {
  const p = K.parseKey(name);
  return !!p && thingFor(p.base)?.kind === "npc";
}

/* -------------------------------------------- */
/*  Wiring                                      */
/* -------------------------------------------- */

export function initKeys() {
  setButtonResolver(resolveButton);
  for ( const hook of ["createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage", "deleteJournalEntry"] ) {
    Hooks.on(hook, () => { version++; });
  }
  // A Theater image or a soundscape added at the table: forget the cached server lists.
  for ( const hook of ["createTile", "updateTile", "deleteTile", "planar-soundboard.padsChanged", "planar-soundboard.cuesChanged"] ) {
    Hooks.on(hook, () => { live.at = 0; });
  }
}

export function readyKeys() {
  if ( !game.user.isGM ) return;
  // A planned chip: one click copies the name to create.
  document.body.addEventListener("click", ev => {
    const el = ev.target.closest?.(".codex-planned[data-codex-copy]");
    if ( !el ) return;
    ev.preventDefault();
    ev.stopPropagation();
    const name = el.dataset.codexCopy;
    const copy = game.clipboard?.copyPlainText ? game.clipboard.copyPlainText(name) : globalThis.navigator?.clipboard?.writeText(name);
    Promise.resolve(copy).then(() => ui.notifications.info(localize("Keys.Copied", { name })))
      .catch(() => ui.notifications.warn(localize("Keys.NotCopied", { name })));
  }, true);
}

/** For the API and the console: what a key resolves to right now. */
export function explain(key) {
  const p = K.parseKey(key);
  const thing = p ? thingFor(p.base) : null;
  if ( !thing ) return null;
  const s = server();
  return {
    thing,
    place: thing.kind === "place" ? K.theaterPlace(thing, p, { thingFor, labels: s.places }) : null,
    cast: thing.kind === "npc" ? K.theaterCast(thing, p, { labels: s.cast }) : null,
    scape: thing.kind === "place" ? K.scapeFor(thing, { names: s.scapes }) : null,
    actor: thing.kind === "npc" ? K.actorFor(thing) : null,
    atlas: s.atlas ? (safe(() => s.atlas.findPlace(p.key)) ?? (thing.atlas ? safe(() => s.atlas.findPlace(thing.atlas)) : null)) : undefined
  };
}

export const keysApi = {
  /** Every key the notes define: [{key, kind, title, en}]. */
  list: () => [...things().values()].map(t => ({ key: t.key, kind: t.kind, title: t.title, en: t.en })),
  /** What a key resolves to: the Theater label, NPC card, soundscape, actor, Atlas place, and what is missing. */
  explain,
  /** A button as the GM sees it ({text} / {html} / null). */
  resolveButton,
  core: K
};
