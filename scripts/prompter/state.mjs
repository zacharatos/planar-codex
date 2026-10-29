/**
 * Planar Codex — Prompter state.
 *
 * One hidden world setting, `prompter`: { sheet: <page uuid>, runs: { <page uuid>: run } }.
 * A run is one session played from one run sheet:
 *   { session, startedAt, closedAt, active, beats: {<beat id>: {s, t, where}}, notes: [], events: [], answers: {}, logUuid }
 * Only the GM writes it. Writes are coalesced (a Theater fade or a burst of hooks becomes one save).
 */
import { MODULE_ID, getMarkdown, isCodexPage } from "../codex.mjs";
import { splitFrontmatter } from "../markdown.mjs";
import { playersFor } from "../actions.mjs";
import { parseBeats, parseCloseout, sessionOf, isAsleep, fold } from "./core.mjs";

export const SETTING = "prompter";
const MAX_EVENTS = 400;
const MAX_RUNS = 6;
const FLUSH_MS = 250;

const clone = v => foundry.utils.deepClone(v);
const listeners = new Set();
let pending = null;
let timer = null;

export function registerState() {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => { if ( !pending ) emit(); }
  });
}

/** Call fn() whenever the Prompter state changes (here or in another GM's browser). Returns an unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for ( const fn of listeners ) {
    try { fn(); } catch(err) { console.error(`${MODULE_ID} | prompter`, err); }
  }
}

/** The whole stored object (with unsaved changes). */
export function store() {
  const s = pending ?? game.settings.get(MODULE_ID, SETTING) ?? {};
  return { sheet: s.sheet ?? null, runs: s.runs ?? {} };
}

/** Change the store (GM only). fn gets a mutable copy. */
export function mutate(fn) {
  if ( !game.user.isGM ) return;
  const s = clone(store());
  fn(s);
  pending = s;
  emit();
  clearTimeout(timer);
  timer = setTimeout(flush, FLUSH_MS);
}

export async function flush() {
  clearTimeout(timer);
  if ( !pending ) return;
  const s = pending;
  // Keep the current sheet's run and the most recent others.
  const keep = Object.entries(s.runs).sort((a, b) => String(b[1].startedAt ?? "").localeCompare(String(a[1].startedAt ?? "")))
    .filter(([uuid], i) => uuid === s.sheet || i < MAX_RUNS);
  s.runs = Object.fromEntries(keep);
  try { await game.settings.set(MODULE_ID, SETTING, s); }
  finally { if ( pending === s ) pending = null; }
}

/* -------------------------------------------- */
/*  The run sheet                               */
/* -------------------------------------------- */

/** The run sheet page the Prompter follows (or the best guess). */
export function sheetPage() {
  const uuid = store().sheet;
  const page = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  if ( page && isCodexPage(page) ) return page;
  return candidateSheets()[0] ?? null;
}

/** Codex notes that hold beats, the highest session number first. */
export function candidateSheets() {
  const out = [];
  for ( const entry of game.journal ) {
    for ( const page of entry.pages ) {
      if ( !isCodexPage(page) ) continue;
      const md = getMarkdown(page);
      if ( !/\[!beat\b/i.test(md) ) continue;
      const { data } = splitFrontmatter(md);
      out.push({ page, n: Number(sessionOf(data, page.name)) || 0 });
    }
  }
  return out.sort((a, b) => b.n - a.n || a.page.name.localeCompare(b.page.name)).map(x => x.page);
}

export function setSheet(page) {
  mutate(s => { s.sheet = page?.uuid ?? null; });
}

/** Everything the panel needs to know about a sheet, parsed (cached by the Markdown's identity). */
const parsed = new WeakMap();
export function readSheet(page) {
  if ( !page ) return null;
  const md = getMarkdown(page);
  const hit = parsed.get(page);
  if ( hit && hit.md === md ) return hit.data;
  const { data: fm } = splitFrontmatter(md);
  const data = { beats: parseBeats(md), questions: parseCloseout(md), session: sessionOf(fm, page.name) };
  parsed.set(page, { md, data });
  return data;
}

/* -------------------------------------------- */
/*  The run                                     */
/* -------------------------------------------- */

const emptyRun = session => ({ session, startedAt: null, closedAt: null, active: false, beats: {}, notes: [], events: [], answers: {}, logUuid: null });

export function run(page = sheetPage()) {
  if ( !page ) return emptyRun("");
  return store().runs[page.uuid] ?? emptyRun(readSheet(page)?.session ?? "");
}

export function mutateRun(fn, page = sheetPage()) {
  if ( !page ) return;
  mutate(s => {
    s.runs[page.uuid] ??= emptyRun(readSheet(page)?.session ?? "");
    fn(s.runs[page.uuid]);
  });
}

export function setBeat(id, status, where = "", page = sheetPage()) {
  mutateRun(r => { r.beats[id] = status ? { s: status, t: new Date().toISOString(), where: String(where ?? "") } : { s: null }; }, page);
}

export function addNote(note, page = sheetPage()) {
  mutateRun(r => { r.notes.push({ id: foundry.utils.randomID(), t: new Date().toISOString(), ...note }); }, page);
}

export function removeNote(id, page = sheetPage()) {
  mutateRun(r => { r.notes = r.notes.filter(n => n.id !== id); }, page);
}

/** Record something the modules saw. Only while a session runs. */
export function addEvent(kind, label, text, page = sheetPage()) {
  if ( !run(page).active ) return;
  mutateRun(r => {
    r.events.push({ t: new Date().toISOString(), kind, label, text: String(text ?? "") });
    if ( r.events.length > MAX_EVENTS ) r.events = r.events.slice(-MAX_EVENTS);
  }, page);
}

/* -------------------------------------------- */
/*  Who is at the table                         */
/* -------------------------------------------- */

/** Is a hero (by name, as written in `pc=`) played by someone who is logged in? Unknown names count as present. */
export function isPresent(name) {
  const { users, actor } = playersFor(name);
  if ( !actor && !users.length ) return true;
  return users.some(u => u.active);
}

export const asleep = beat => isAsleep(beat, isPresent);

/** The player characters, for the spotlight. */
export function heroes() {
  return game.actors.filter(a => a.type === "character" && a.hasPlayerOwner)
    .map(a => ({ actor: a, name: a.name, short: a.name.split(/\s+/)[0], present: game.users.some(u => !u.isGM && u.active && a.testUserPermission(u, "OWNER")) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How much of tonight was about each hero: beats played for them, private lines sent to them, notes that name them.
 * @returns {{name: string, short: string, count: number, present: boolean}[]}
 */
export function spotlight(page = sheetPage(), whispersSent = []) {
  const r = run(page);
  const beats = readSheet(page)?.beats ?? [];
  return heroes().map(h => {
    const key = fold(h.short);
    const named = list => list.some(n => { const f = fold(n); return f === key || fold(h.name) === f || f.startsWith(`${key} `) || key.startsWith(f); });
    let count = beats.filter(b => r.beats[b.id]?.s === "played" && named(b.pc)).length;
    count += whispersSent.filter(w => (w.recipients ?? []).some(x => x.actorId === h.actor.id || named([x.name ?? ""]))).length;
    count += r.notes.filter(n => fold(n.text).split(" ").includes(key)).length;
    return { name: h.name, short: h.short, count, present: h.present };
  });
}

/** Tell the panel and the open notes to redraw (in-memory changes such as hot beats). */
export const refresh = () => emit();
