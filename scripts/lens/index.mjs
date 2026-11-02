/**
 * Planar Codex — Lens (Φακός): what it is looking at, and following the table.
 *
 * The Lens follows what the table shows (a Theater place or NPC card, a stop on the Atlas, the scene, a selected NPC token)
 * unless it is pinned, or the GM types a name. In memory only: each GM browser has its own Lens.
 */
import { MODULE_ID, localize } from "../codex.mjs";
import { subscribe, refresh } from "../prompter/state.mjs";
import { recentContexts } from "../prompter/context.mjs";
import { namesFromLabel } from "./core.mjs";

export const lens = { query: "", pinned: false, history: [], unseen: false, source: "", at: null };

/**
 * Point the Lens at a name (or several, "A · B").
 * @param {string} query
 * @param {object} [options]
 * @param {boolean} [options.auto]   the table moved (not the GM): marks the tab, or switches to it (setting)
 * @param {string} [options.source]  where it came from, for the panel ("Theater", "Atlas" …)
 */
export function setLensTarget(query, { auto = false, source = "" } = {}) {
  const q = String(query ?? "").trim();
  if ( !q ) return;
  if ( auto && lens.pinned ) return;
  if ( q !== lens.query ) {
    if ( lens.query ) lens.history = [lens.query, ...lens.history.filter(x => x !== lens.query && x !== q)].slice(0, 6);
    lens.query = q;
  }
  lens.source = source;
  lens.at = new Date().toISOString();
  if ( auto ) lens.unseen = true;
  refresh();
}

export function togglePin() {
  lens.pinned = !lens.pinned;
  refresh();
}

/* -------------------------------------------- */
/*  Following the table                         */
/* -------------------------------------------- */

const FOLLOW_KINDS = new Set(["place", "npc", "scene"]);
let lastContext = null;

/** Called on every Prompter state change: a new context heard (Theater, Atlas, a scene) moves the Lens. */
function followTable() {
  const c = recentContexts()[0];
  if ( !c || c === lastContext ) return;
  lastContext = c;
  if ( !FOLLOW_KINDS.has(c.kind) || !game.settings.get(MODULE_ID, "lensFollow") ) return;
  const names = namesFromLabel(c.text);
  if ( names.length ) setLensTarget(names.join(" · "), { auto: true, source: c.label ?? "" });
}

let tokenTimer = null;
function onControlToken(token, controlled) {
  if ( !controlled || !game.user.isGM || !game.settings.get(MODULE_ID, "lensTokens") ) return;
  const actor = token?.actor;
  if ( !actor || actor.hasPlayerOwner ) return;
  clearTimeout(tokenTimer);
  tokenTimer = setTimeout(() => setLensTarget(token.name || actor.name, { auto: true, source: localize("Lens.FromToken") }), 250);
}

export function initLens() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  register("lensFollow", {
    name: "PLANARCODEX.Settings.LensFollow", hint: "PLANARCODEX.Settings.LensFollowHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  register("lensTokens", {
    name: "PLANARCODEX.Settings.LensTokens", hint: "PLANARCODEX.Settings.LensTokensHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  register("lensSwitch", {
    name: "PLANARCODEX.Settings.LensSwitch", hint: "PLANARCODEX.Settings.LensSwitchHint",
    scope: "client", config: true, type: Boolean, default: false
  });
  Hooks.on("controlToken", onControlToken);
}

export function readyLens() {
  if ( !game.user.isGM ) return;
  lastContext = recentContexts()[0] ?? null;
  subscribe(followTable);
}
