/**
 * Planar Codex — autocomplete inside the Markdown editor.
 *
 *   [[        notes, actors, items, spells, monsters, scenes, tables, playlists, macros
 *   [[spell:  only that kind (actor:, monster:, item:, spell:, scene:, table:, journal:, playlist:, macro:)
 *   [[Note#   headings of that note
 *   [[/       roll helpers: check, save, damage, heal, attack, roll, GM roll
 *
 * Works against Foundry's own <code-mirror> element through its public value/cursor,
 * and edits through the CodeMirror view when it can be reached (keeps undo), else through
 * the browser's editing commands.
 */
import { MODULE_ID, localize } from "./codex.mjs";
import { linkIndex } from "./link-index.mjs";
import { escapeHTML, extractHeadings, TYPE_PREFIXES } from "./markdown.mjs";
import { getMarkdown } from "./codex.mjs";

const MAX_RESULTS = 14;

/* -------------------------------------------- */
/*  Matching                                    */
/* -------------------------------------------- */

/** Lower case, accents stripped (Greek tonos included), single spaces. */
export function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** 0 = no match; higher is better. */
export function score(candidate, query) {
  const c = fold(candidate);
  const q = fold(query);
  if ( !q ) return 1;
  if ( c === q ) return 100;
  if ( c.startsWith(q) ) return 80;
  if ( c.split(/[\s\-–—_/:(]+/).some(w => w.startsWith(q)) ) return 60;
  if ( c.includes(q) ) return 40;
  // All query words appear somewhere.
  const words = q.split(" ").filter(Boolean);
  if ( words.length > 1 && words.every(w => c.includes(w)) ) return 30;
  return 0;
}

/**
 * What the text before the cursor asks for.
 * @param {string} before  Document text up to the cursor.
 * @returns {null|{start: number, query: string, mode: "link"|"heading"|"roll", note?: string, prefix?: string}}
 */
export function detectTrigger(before) {
  const open = before.lastIndexOf("[[");
  if ( open < 0 ) return null;
  const inside = before.slice(open + 2);
  if ( inside.includes("]]") || inside.includes("\n") || inside.length > 80 ) return null;
  if ( inside.startsWith("/") ) return { start: open, query: inside.slice(1), mode: "roll" };
  const hash = inside.indexOf("#");
  if ( hash >= 0 ) return { start: open, query: inside.slice(hash + 1), mode: "heading", note: inside.slice(0, hash) };
  const typed = inside.match(/^([A-Za-z]+):(.*)$/);
  if ( typed && TYPE_PREFIXES[typed[1].toLowerCase()] ) return { start: open, query: typed[2], mode: "link", prefix: typed[1].toLowerCase() };
  return { start: open, query: inside, mode: "link" };
}

/* -------------------------------------------- */
/*  Suggestions                                 */
/* -------------------------------------------- */

const WORLD_SOURCES = [
  { collection: "actors", prefix: "actor", icon: "fa-solid fa-user", label: "Actor" },
  { collection: "items", prefix: "item", icon: "fa-solid fa-suitcase", label: "Item" },
  { collection: "scenes", prefix: "scene", icon: "fa-solid fa-map", label: "Scene" },
  { collection: "tables", prefix: "table", icon: "fa-solid fa-table-list", label: "Table" },
  { collection: "playlists", prefix: "playlist", icon: "fa-solid fa-music", label: "Playlist" },
  { collection: "macros", prefix: "macro", icon: "fa-solid fa-code", label: "Macro" }
];

const PACK_SOURCES = [
  { pack: "dnd5e.spells24", prefix: "spell", icon: "fa-solid fa-wand-sparkles", label: "Spell" },
  { pack: "dnd5e.actors24", prefix: "monster", icon: "fa-solid fa-dragon", label: "Monster" },
  { pack: "dnd5e.equipment24", prefix: "item", icon: "fa-solid fa-shield-halved", label: "Equipment" }
];

const packCache = new Map();
export async function warmPacks() {
  for ( const src of PACK_SOURCES ) {
    if ( packCache.has(src.pack) ) continue;
    const pack = game.packs.get(src.pack);
    if ( !pack ) { packCache.set(src.pack, []); continue; }
    try {
      const index = await pack.getIndex({ fields: ["type"] });
      packCache.set(src.pack, Array.from(index).map(e => ({ name: e.name, type: e.type })));
    } catch(err) {
      console.warn(`${MODULE_ID} | could not index ${src.pack}`, err);
      packCache.set(src.pack, []);
    }
  }
}

const PREFIX_GROUP = {
  actor: ["actor"], npc: ["actor"], pc: ["actor"], monster: ["monster", "actor"], creature: ["monster", "actor"],
  item: ["item"], equipment: ["item"], weapon: ["item"], armor: ["item"], feat: ["item"], feature: ["item"],
  spell: ["spell", "item"], scene: ["scene"], table: ["table"], rolltable: ["table"], journal: ["note", "journal"],
  playlist: ["playlist"], macro: ["macro"]
};

/**
 * Build the suggestion list for a trigger.
 * @returns {Array<{label: string, detail: string, icon: string, insert: string, score: number, action?: string}>}
 */
export function suggest(trigger) {
  if ( trigger.mode === "roll" ) return rollSuggestions(trigger.query);
  if ( trigger.mode === "heading" ) return headingSuggestions(trigger);
  const q = trigger.query;
  const allowed = trigger.prefix ? new Set(PREFIX_GROUP[trigger.prefix] ?? [trigger.prefix]) : null;
  const ok = kind => !allowed || allowed.has(kind);
  const out = [];
  const seen = new Set();
  const push = s => {
    const key = s.insert;
    if ( seen.has(key) ) return;
    seen.add(key);
    out.push(s);
  };

  if ( ok("note") ) {
    for ( const e of linkIndex.index.entries ) {
      const names = [e.name, ...(e.aliases ?? [])];
      let best = 0, via = null;
      for ( const n of names ) {
        const s = score(n, q);
        if ( s > best ) { best = s; via = n === e.name ? null : n; }
      }
      if ( !best ) continue;
      const folder = e.path.split("/").slice(0, -1).join(" › ");
      push({ label: e.name, detail: via ? `${via} · ${folder}` : folder, icon: "fa-solid fa-book-open", insert: `[[${e.name}]]`, score: best + 8 });
    }
  }

  for ( const src of WORLD_SOURCES ) {
    if ( !ok(src.prefix) && !(src.prefix === "item" && ok("spell")) ) continue;
    const coll = game[src.collection];
    if ( !coll ) continue;
    for ( const d of coll ) {
      const s = score(d.name, q);
      if ( !s ) continue;
      let prefix = src.prefix;
      if ( src.collection === "items" && d.type === "spell" ) prefix = "spell";
      if ( allowed && !allowed.has(prefix) && !(prefix === "spell" && allowed.has("item")) ) continue;
      push({ label: d.name, detail: `${src.label}${d.type && d.type !== "base" ? ` · ${d.type}` : ""} · world`, icon: src.icon, insert: `[[${prefix}:${d.name}]]`, score: s + 4 });
    }
  }

  if ( fold(q).length >= 2 || trigger.prefix ) {
    for ( const src of PACK_SOURCES ) {
      if ( !ok(src.prefix) ) continue;
      for ( const e of packCache.get(src.pack) ?? [] ) {
        const s = score(e.name, q);
        if ( !s ) continue;
        push({ label: e.name, detail: `${src.label} · 2024`, icon: src.icon, insert: `[[${src.prefix}:${e.name}]]`, score: s });
      }
    }
  }

  return out.sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label)).slice(0, MAX_RESULTS);
}

function headingSuggestions(trigger) {
  const page = trigger.note ? linkIndex.resolvePage(trigger.note) : null;
  const source = page ?? null;
  const md = source ? getMarkdown(source) : (trigger.currentMarkdown ?? "");
  const noteName = trigger.note || "";
  return extractHeadings(md)
    .map(h => ({ h, s: score(h.text, trigger.query) }))
    .filter(x => x.s)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_RESULTS)
    .map(({ h, s }) => {
      const clean = h.text.replace(/[\[\]:|#^`*]/g, " ").replace(/\s+/g, " ").trim();
      return { label: h.text.replace(/[`*]/g, ""), detail: `H${h.level}`, icon: "fa-solid fa-heading", insert: `[[${noteName}#${clean}]]`, score: s };
    });
}

const ROLLS = [
  { key: "check", label: "Ability or skill check", icon: "fa-solid fa-dice-d20" },
  { key: "save", label: "Saving throw", icon: "fa-solid fa-shield" },
  { key: "damage", label: "Damage", icon: "fa-solid fa-burst" },
  { key: "heal", label: "Healing", icon: "fa-solid fa-heart-pulse" },
  { key: "attack", label: "Attack roll", icon: "fa-solid fa-crosshairs" },
  { key: "r", label: "Dice roll (public)", icon: "fa-solid fa-dice" },
  { key: "gmr", label: "Dice roll (GM only)", icon: "fa-solid fa-user-secret" }
];

function rollSuggestions(query) {
  return ROLLS.map(r => ({ r, s: Math.max(score(r.key, query), score(r.label, query)) }))
    .filter(x => x.s)
    .sort((a, b) => b.s - a.s)
    .map(({ r, s }) => ({ label: `/${r.key}`, detail: r.label, icon: r.icon, insert: null, action: r.key, score: s }));
}

/* -------------------------------------------- */
/*  Roll helper dialog                          */
/* -------------------------------------------- */

function optionsFrom(obj, empty) {
  const opts = Object.entries(obj).map(([k, v]) => `<option value="${k}">${escapeHTML(game.i18n.localize(v?.label ?? v))}</option>`).join("");
  return (empty ? `<option value="">${empty}</option>` : "") + opts;
}

/** Ask for the roll's details and return the enricher text, or null. */
export async function buildRoll(kind) {
  const cfg = CONFIG.DND5E ?? {};
  const abilities = optionsFrom(cfg.abilities ?? {}, "—");
  const skills = optionsFrom(cfg.skills ?? {}, "—");
  const dmgTypes = optionsFrom(cfg.damageTypes ?? {}, "—");
  const field = (label, input) => `<div class="form-group"><label>${label}</label><div class="form-fields">${input}</div></div>`;
  let content = "";
  switch ( kind ) {
    case "check":
      content = field("Ability", `<select name="ability">${abilities}</select>`)
        + field("Skill", `<select name="skill">${skills}</select>`)
        + field("Or skill 2", `<select name="skill2">${skills}</select>`)
        + field("Tool (id, optional)", `<input type="text" name="tool" placeholder="thief, painter …">`)
        + field("DC", `<input type="number" name="dc" min="1" max="40">`);
      break;
    case "save":
      content = field("Ability", `<select name="ability">${abilities}</select>`) + field("DC", `<input type="number" name="dc" min="1" max="40">`);
      break;
    case "damage":
      content = field("Formula", `<input type="text" name="formula" placeholder="2d6+3">`)
        + field("Type", `<select name="type">${dmgTypes}</select>`)
        + field("Show average", `<input type="checkbox" name="average" checked>`);
      break;
    case "heal":
      content = field("Formula", `<input type="text" name="formula" placeholder="2d4+2">`);
      break;
    case "attack":
      content = field("Bonus", `<input type="text" name="bonus" placeholder="+5">`);
      break;
    default:
      content = field("Formula", `<input type="text" name="formula" placeholder="1d20">`) + field("Label (optional)", `<input type="text" name="label">`);
  }
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: ROLLS.find(r => r.key === kind)?.label ?? "Roll", icon: "fa-solid fa-dice-d20" },
    classes: ["planar-codex", "codex-roll-form"],
    content: `<div class="codex-roll-form">${content}</div>`,
    ok: {
      label: localize("Autocomplete.Insert"),
      callback: (event, button) => Object.fromEntries(new FormData(button.form).entries())
    },
    rejectClose: false
  });
  if ( !data ) return null;
  const v = k => String(data[k] ?? "").trim();
  switch ( kind ) {
    case "check": {
      const parts = [];
      if ( v("ability") ) parts.push(`ability=${v("ability")}`);
      const skills = [v("skill"), v("skill2")].filter(Boolean);
      if ( skills.length ) parts.push(`skill=${skills.join("/")}`);
      if ( v("tool") ) parts.push(`tool=${v("tool")}`);
      if ( v("dc") ) parts.push(`dc=${v("dc")}`);
      return parts.length ? `[[/check ${parts.join(" ")}]]` : null;
    }
    case "save":
      return v("ability") ? `[[/save ability=${v("ability")}${v("dc") ? ` dc=${v("dc")}` : ""}]]` : null;
    case "damage":
      return v("formula") ? `[[/damage ${v("formula").replace(/\s+/g, "")}${v("type") ? ` ${v("type")}` : ""}${data.average ? " average" : ""}]]` : null;
    case "heal":
      return v("formula") ? `[[/heal ${v("formula").replace(/\s+/g, "")}]]` : null;
    case "attack":
      return v("bonus") ? `[[/attack ${v("bonus").startsWith("+") || v("bonus").startsWith("-") ? v("bonus") : `+${v("bonus")}`}]]` : null;
    default:
      return v("formula") ? `[[/${kind} ${v("formula")}]]${v("label") ? `{${v("label")}}` : ""}` : null;
  }
}

/* -------------------------------------------- */
/*  Editor plumbing                             */
/* -------------------------------------------- */

/** The CodeMirror EditorView behind Foundry's <code-mirror> element, if reachable. */
function editorView(editor) {
  const content = editor.querySelector(".cm-content");
  const candidates = [content?.cmView?.view, content?.cmView?.rootView?.view, content?.cmTile?.view, content?.cmTile?.root?.view];
  return candidates.find(v => v && typeof v.dispatch === "function" && v.state?.doc) ?? null;
}

/** Replace [from, to) with text and put the cursor after it. */
function replaceRange(editor, from, to, text) {
  const view = editorView(editor);
  if ( view ) {
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
    view.focus();
    return;
  }
  // Fallback: browser editing commands on the focused contenteditable (CodeMirror handles them as typing).
  const cursor = editor.cursor ?? to;
  editor.focus();
  for ( let i = 0; i < cursor - from; i++ ) document.execCommand("delete");
  for ( let i = 0; i < to - cursor; i++ ) document.execCommand("forwardDelete");
  document.execCommand("insertText", false, text);
}

function caretRect(editor) {
  const cur = editor.querySelector(".cm-cursor-primary, .cm-cursor");
  const r = cur?.getBoundingClientRect();
  if ( r && (r.width || r.height) ) return r;
  const sel = window.getSelection();
  if ( sel?.rangeCount ) {
    const rr = sel.getRangeAt(0).getBoundingClientRect();
    if ( rr.width || rr.height ) return rr;
  }
  return editor.getBoundingClientRect();
}

/** Adapter for Foundry's <code-mirror> element (its CodeMirror view is private, so this works through value/cursor). */
function foundryAdapter(editor) {
  return {
    element: editor,
    get connected() { return editor.isConnected; },
    value: () => editor.value ?? "",
    cursor: () => editor.cursor,
    replace: (from, to, text) => replaceRange(editor, from, to, text),
    caretRect: () => caretRect(editor),
    focus: () => editor.focus()
  };
}

/**
 * Adapter for a CodeMirror 6 EditorView we own (the Codex editor).
 * @param {import("@codemirror/view").EditorView} view
 */
export function viewAdapter(view) {
  return {
    element: view.dom,
    get connected() { return view.dom.isConnected; },
    value: () => view.state.doc.toString(),
    cursor: () => view.state.selection.main.head,
    replace: (from, to, text) => {
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true, userEvent: "input.complete" });
      view.focus();
    },
    caretRect: () => {
      const r = view.coordsAtPos(view.state.selection.main.head);
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : view.dom.getBoundingClientRect();
    },
    focus: () => view.focus()
  };
}

/**
 * Attach autocomplete to every <code-mirror> inside a rendered sheet.
 * @param {HTMLElement} root
 */
export function attachAutocomplete(root) {
  if ( !game.settings.get(MODULE_ID, "autocomplete") ) return;
  for ( const editor of root.querySelectorAll("code-mirror") ) {
    if ( editor.dataset.codexAc ) continue;
    editor.dataset.codexAc = "1";
    new CodexAutocomplete(foundryAdapter(editor));
  }
  warmPacks();
}

export class CodexAutocomplete {
  /** @param {ReturnType<typeof viewAdapter>} adapter */
  constructor(adapter) {
    this.ed = adapter;
    this.menu = null;
    this.items = [];
    this.active = 0;
    this.trigger = null;
    this.pending = false;
    const el = adapter.element;
    el.addEventListener("keydown", ev => this.#onKeyDown(ev), true);
    el.addEventListener("keyup", ev => { if ( !["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(ev.key) ) this.schedule(); });
    el.addEventListener("input", () => this.schedule());
    el.addEventListener("focusout", () => setTimeout(() => this.close(), 150));
  }

  get isOpen() { return !!this.menu; }

  schedule() {
    if ( this.pending ) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.#update(); });
  }

  #update() {
    if ( !this.ed.connected ) return this.close();
    const value = this.ed.value();
    const cursor = this.ed.cursor();
    if ( !Number.isInteger(cursor) ) return this.close();
    const trigger = detectTrigger(value.slice(0, cursor));
    if ( !trigger ) return this.close();
    trigger.cursor = cursor;
    trigger.end = value.slice(cursor, cursor + 2) === "]]" ? cursor + 2 : cursor;
    trigger.currentMarkdown = value;
    this.trigger = trigger;
    this.items = suggest(trigger);
    this.active = 0;
    this.#render();
  }

  #render() {
    if ( !this.menu ) {
      this.menu = (this.ed.element.ownerDocument ?? document).createElement("div");
      this.menu.className = "codex-ac";
      this.menu.addEventListener("mousedown", ev => ev.preventDefault());
      (this.ed.element.ownerDocument ?? document).body.append(this.menu);
    }
    const t = this.trigger;
    const hint = t.mode === "roll" ? localize("Autocomplete.HintRoll")
      : t.mode === "heading" ? localize("Autocomplete.HintHeading")
      : localize("Autocomplete.HintLink");
    const rows = this.items.length
      ? this.items.map((s, i) => `<div class="codex-ac-item${i === this.active ? " active" : ""}" data-index="${i}"><i class="${s.icon}"></i><span class="label">${escapeHTML(s.label)}</span><span class="detail">${escapeHTML(s.detail ?? "")}</span></div>`).join("")
      : `<div class="codex-ac-empty">${localize("Autocomplete.Nothing")}</div>`;
    this.menu.innerHTML = `<div class="codex-ac-hint">${hint}</div>${rows}`;
    for ( const el of this.menu.querySelectorAll(".codex-ac-item") ) {
      el.addEventListener("click", () => this.#choose(Number(el.dataset.index)));
    }
    const r = this.ed.caretRect();
    const win = this.ed.element.ownerDocument?.defaultView ?? window;
    const h = Math.min(340, this.menu.offsetHeight || 200);
    const below = r.bottom + 4 + h < win.innerHeight;
    this.menu.style.left = `${Math.max(4, Math.min(r.left, win.innerWidth - 470))}px`;
    this.menu.style.top = below ? `${r.bottom + 4}px` : `${Math.max(4, r.top - h - 4)}px`;
    this.menu.querySelector(".codex-ac-item.active")?.scrollIntoView({ block: "nearest" });
  }

  #onKeyDown(ev) {
    if ( !this.menu ) return;
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); };
    switch ( ev.key ) {
      case "ArrowDown": stop(); this.active = (this.active + 1) % Math.max(1, this.items.length); this.#render(); break;
      case "ArrowUp": stop(); this.active = (this.active - 1 + this.items.length) % Math.max(1, this.items.length); this.#render(); break;
      case "Enter":
      case "Tab": if ( this.items.length ) { stop(); this.#choose(this.active); } break;
      case "Escape": stop(); this.close(); break;
    }
  }

  async #choose(index) {
    const s = this.items[index];
    const t = this.trigger;
    if ( !s || !t ) return;
    this.close();
    let text = s.insert;
    if ( s.action ) {
      text = await buildRoll(s.action);
      if ( !text ) { this.ed.focus(); return; }
    }
    this.ed.replace(t.start, t.end, text);
  }

  close() {
    this.menu?.remove();
    this.menu = null;
    this.trigger = null;
  }
}
