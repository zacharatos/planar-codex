/**
 * Planar Codex — Prompter: what is happening at the table.
 *
 * Listens to Foundry and to the other Planar modules when they are active, and turns what it hears into
 *  - contexts, which make matching beats "hot" (a place shown, the party moved, a Long Rest …), and
 *  - events, written to the session's live log (private lines sent and read, coins paid, deaths …).
 * Everything here runs only in the active GM's browser. Modules that aren't installed are simply never heard from.
 */
import { MODULE_ID, localize } from "../codex.mjs";
import { beatsFor } from "./core.mjs";
import { sheetPage, readSheet, run, asleep, addEvent, refresh } from "./state.mjs";

const isActiveGM = () => !!game.user?.isGM && (game.users.activeGM?.id ?? game.user.id) === game.user.id;
const api = id => { const m = game.modules.get(id); return m?.active ? m.api ?? null : null; };
const snippet = (html, n = 70) => {
  const text = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

/* -------------------------------------------- */
/*  Hot beats                                   */
/* -------------------------------------------- */

/** beat id → {t, where}: beats something at the table just called for. In memory only. */
const hot = new Map();
/** The last things heard, newest first: [{kind, text, label, t}]. */
const recent = [];
const lastHeard = new Map();

export const hotBeats = () => hot;
export const recentContexts = () => recent;
export function cool(id) { if ( hot.delete(id) ) refresh(); }

/**
 * Something happened that beats can be waiting for.
 * @param {{kind: string, text?: string, long?: boolean}} context
 * @param {object} [options]
 * @param {string} [options.label]   Where it came from, for the panel ("Theater", "Atlas" …).
 * @param {boolean} [options.quiet]  No toast.
 */
export function hear(context, { label = "", quiet = false } = {}) {
  if ( !isActiveGM() ) return [];
  const key = `${context.kind}|${context.text ?? ""}|${context.long ?? ""}`;
  const now = Date.now();
  if ( now - (lastHeard.get(key) ?? 0) < 15000 ) return [];
  lastHeard.set(key, now);
  recent.unshift({ ...context, label, t: new Date().toISOString() });
  recent.length = Math.min(recent.length, 8);

  const page = sheetPage();
  const sheet = readSheet(page);
  if ( !sheet ) { refresh(); return []; }
  const where = [label, context.text].filter(Boolean).join(" · ");
  const found = beatsFor(sheet.beats, context, run(page).beats).filter(b => !asleep(b) && !hot.has(b.id));
  for ( const b of found ) hot.set(b.id, { t: new Date().toISOString(), where });
  if ( found.length && !quiet && game.settings.get(MODULE_ID, "prompterToasts") ) {
    ui.notifications.info(localize("Prompter.Toast", { titles: found.map(b => b.title).join(" · "), where: where || "—" }));
    if ( game.settings.get(MODULE_ID, "prompterChime") ) {
      foundry.audio.AudioHelper.play({ src: "sounds/notify.wav", volume: 0.35, autoplay: true, loop: false }, false);
    }
  }
  refresh();
  return found;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

const known = { whispers: new Map(), purse: new Set(), stops: new Set(), band: null, overlayPlace: null, overlayCast: new Set() };

/** Remember what already exists, so only new things are reported. Called on ready. */
export function primeContext() {
  const pw = api("planar-whispers");
  for ( const w of pw?.log?.().sent ?? [] ) known.whispers.set(w.id, { readers: readers(w), logged: !!w.sentAt });
  const atlas = api("planar-atlas");
  for ( const e of atlas?.purseLog?.() ?? [] ) known.purse.add(e.id);
  for ( const s of activeStops(atlas) ) known.stops.add(s.id);
  known.band = atlas?.clock?.()?.band ?? null;
  const ov = api("planar-theater")?.overlay?.();
  known.overlayPlace = ov?.place?.id ?? null;
  for ( const c of ov?.cast ?? [] ) known.overlayCast.add(c.id);
}

const readers = w => new Set(Object.entries(w.receipts ?? {}).filter(([, r]) => r?.state === "read").map(([id]) => id));
function activeStops(atlas) {
  const road = atlas?.road?.();
  const j = road?.journeys?.find(x => x.id === road.active);
  return j?.stops ?? [];
}

export function registerContextHooks() {
  // Planar Theater on its own stage: a place, an NPC card or a title card made visible.
  const shownAt = new Map();
  Hooks.on("updateTile", (tile, changed) => {
    if ( !isActiveGM() ) return;
    const meta = tile.flags?.["planar-theater"];
    if ( !meta ) return;
    const shown = changed?.hidden === false || (typeof changed?.alpha === "number" && changed.alpha >= 0.99 && !tile.hidden);
    if ( !shown || Date.now() - (shownAt.get(tile.id) ?? 0) < 10000 ) return;
    shownAt.set(tile.id, Date.now());
    const kind = meta.kind === "npc" ? "npc" : "place";
    const text = [meta.label, meta.name, meta.title, meta.text]
      .filter(v => typeof v === "string" && v.trim() && !/\.(webp|png|jpe?g|avif|gif)$/i.test(v)).join(" · ") || tile.name || "";
    if ( !text ) return;
    hear({ kind, text }, { label: localize("Prompter.Source.Theater") });
    addEvent("theater", localize("Prompter.Source.Theater"), text);
  });

  // Planar Theater over a map.
  Hooks.on("planar-theater.overlay", value => {
    if ( !isActiveGM() ) return;
    const place = value?.place;
    if ( place?.id && place.id !== known.overlayPlace ) {
      const text = [place.label, place.title && !/[/.]/.test(place.title) ? place.title : ""].filter(Boolean).join(" · ");
      hear({ kind: "place", text }, { label: localize("Prompter.Source.Theater") });
      addEvent("theater", localize("Prompter.Source.Theater"), text);
    }
    known.overlayPlace = place?.id ?? null;
    const cast = new Set();
    for ( const c of value?.cast ?? [] ) {
      cast.add(c.id);
      if ( known.overlayCast.has(c.id) ) continue;
      const text = c.label ?? c.name ?? "";
      if ( text ) hear({ kind: "npc", text }, { label: localize("Prompter.Source.Theater") });
    }
    known.overlayCast = cast;
  });

  // A scene becomes the players' scene.
  Hooks.on("updateScene", (scene, changed) => {
    if ( !isActiveGM() || changed?.active !== true ) return;
    hear({ kind: "scene", text: scene.name }, { label: localize("Prompter.Source.Scene") });
    addEvent("scene", localize("Prompter.Source.Scene"), scene.name);
  });

  // Settings other modules keep their logs in: the Atlas road, the Whispers log.
  const onSetting = setting => {
    if ( !isActiveGM() ) return;
    if ( setting.key === "planar-atlas.road" ) onRoad();
    else if ( setting.key === "planar-whispers.log" ) onWhispers();
  };
  Hooks.on("updateSetting", onSetting);
  Hooks.on("createSetting", onSetting);

  // The in-world clock (Planar Atlas): a new part of the day.
  Hooks.on("updateWorldTime", () => {
    if ( !isActiveGM() ) return;
    const atlas = api("planar-atlas");
    const c = atlas?.clock?.();
    if ( !c?.band || c.band === known.band ) return;
    known.band = c.band;
    hear({ kind: "time", text: c.band }, { label: localize("Prompter.Source.Clock") });
    addEvent("time", localize("Prompter.Source.Clock"), atlas.clockLabel?.() ?? c.band);
  });

  // Combat.
  Hooks.on("combatStart", combat => {
    if ( !isActiveGM() ) return;
    addEvent("combat", localize("Prompter.Source.Combat"), localize("Prompter.Event.CombatStart", { names: combatantNames(combat) }));
  });
  Hooks.on("deleteCombat", combat => {
    if ( !isActiveGM() || !combat?.started ) return;
    hear({ kind: "combat" }, { label: localize("Prompter.Source.Combat") });
    addEvent("combat", localize("Prompter.Source.Combat"), localize("Prompter.Event.CombatEnd", { rounds: combat.round ?? 0 }));
  });

  // Rests (dnd5e). The hook fires only in the browser that took the rest (often a player's);
  // the rest's chat card reaches the GM too. Either one counts, once.
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    onRest(actor, config?.type ? config.type === "long" : !!result?.longRest);
  });
  Hooks.on("createChatMessage", message => {
    if ( message?.type !== "rest" ) return;
    const actor = game.actors.get(message.speaker?.actor ?? "");
    onRest(actor, message.system?.type === "long");
  });

  // Heroic Inspiration given or used (dnd5e), and coins in or out of the Atlas common purse.
  Hooks.on("updateActor", (actor, changed) => {
    if ( !isActiveGM() ) return;
    const insp = foundry.utils.getProperty(changed ?? {}, "system.attributes.inspiration");
    if ( typeof insp === "boolean" && actor.hasPlayerOwner ) {
      addEvent("inspiration", localize("Prompter.Source.Inspiration"), localize(insp ? "Prompter.Event.InspirationGiven" : "Prompter.Event.InspirationUsed", { name: actor.name }));
    }
    if ( foundry.utils.hasProperty(changed ?? {}, "flags.planar-atlas.purseLog") ) onPurse();
  });

  // Planar Glitch.
  Hooks.on("planar-glitch.death", rec => {
    if ( !isActiveGM() ) return;
    hear({ kind: "death", text: rec?.actorName ?? "" }, { label: localize("Prompter.Source.Glitch") });
    addEvent("death", localize("Prompter.Source.Glitch"), localize("Prompter.Event.Death", { name: rec?.actorName ?? "?", cause: rec?.cause || "—", n: rec?.deathNo ?? "?" }));
  });
  Hooks.on("planar-glitch.return", rec => {
    if ( !isActiveGM() || !rec ) return;
    const glitches = (rec.glitches ?? []).map(g => g?.name ?? g?.label ?? g?.title).filter(Boolean).join(", ") || "—";
    addEvent("return", localize("Prompter.Source.Glitch"), localize("Prompter.Event.Return", { name: rec.actorName ?? "?", glitches }));
  });

  // Presence changes put beats to sleep or wake them.
  Hooks.on("userConnected", () => refresh());
}

const lastRest = new Map();
function onRest(actor, long) {
  if ( !isActiveGM() || !actor?.hasPlayerOwner ) return;
  const key = `${actor.id}|${long}`;
  if ( Date.now() - (lastRest.get(key) ?? 0) < 60000 ) return;
  lastRest.set(key, Date.now());
  hear({ kind: "rest", long }, { label: localize("Prompter.Source.Rest") });
  addEvent("rest", localize("Prompter.Source.Rest"), localize(long ? "Prompter.Event.LongRest" : "Prompter.Event.ShortRest", { name: actor.name }));
}

const combatantNames = combat => [...new Set((combat?.combatants ?? []).map(c => c.name).filter(Boolean))].slice(0, 6).join(", ");

function onRoad() {
  const atlas = api("planar-atlas");
  for ( const stop of activeStops(atlas) ) {
    if ( known.stops.has(stop.id) ) continue;
    known.stops.add(stop.id);
    const text = stop.label || "";
    if ( text ) hear({ kind: "place", text }, { label: localize("Prompter.Source.Atlas") });
    const when = [stop.day ? localize("Prompter.Event.Day", { day: stop.day }) : "", stop.time].filter(Boolean).join(" · ");
    addEvent("move", localize("Prompter.Source.Atlas"), `→ ${text || "?"}${when ? ` (${when})` : ""}`);
  }
}

function onWhispers() {
  const pw = api("planar-whispers");
  for ( const w of pw?.log?.().sent ?? [] ) {
    const names = (w.recipients ?? []).map(r => r.name ?? r.userName).filter(Boolean).join(", ");
    const what = w.title || snippet(w.html) || (w.img ? "🖼" : "");
    const seen = known.whispers.get(w.id) ?? { readers: new Set(), logged: false };
    if ( !seen.logged && w.sentAt ) {
      addEvent("whisper", localize("Prompter.Source.Whisper"), `→ ${names} «${what}»`);
      seen.logged = true;
    }
    const now = readers(w);
    for ( const userId of now ) {
      if ( seen.readers.has(userId) ) continue;
      const r = (w.recipients ?? []).find(x => x.userId === userId);
      addEvent("read", localize("Prompter.Source.Whisper"), localize("Prompter.Event.Read", { name: r?.name ?? r?.userName ?? "?", what }));
    }
    seen.readers = now;
    known.whispers.set(w.id, seen);
  }
}

const COINS = ["pp", "gp", "ep", "sp", "cp"];
const coinsText = delta => COINS.filter(k => Number(delta?.[k])).map(k => `${delta[k] > 0 ? "+" : ""}${delta[k]} ${k}`).join(" ");

function onPurse() {
  const atlas = api("planar-atlas");
  for ( const e of atlas?.purseLog?.() ?? [] ) {
    if ( known.purse.has(e.id) ) continue;
    known.purse.add(e.id);
    addEvent("purse", localize("Prompter.Source.Purse"), [coinsText(e.delta), e.why, e.who ? `(${e.who})` : ""].filter(Boolean).join(" · "));
  }
}

/** The private lines sent since the session started (for the spotlight). */
export function whispersSince(iso) {
  if ( !iso ) return [];
  return (api("planar-whispers")?.log?.().sent ?? []).filter(w => w.sentAt && w.sentAt >= iso);
}

export { api as moduleApi };
