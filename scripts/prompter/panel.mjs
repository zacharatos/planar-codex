/**
 * Planar Codex — the Prompter panel (GM only).
 *
 * The session's deck beside the canvas: what must happen tonight, what the table just called for,
 * the rest of the deck, what to listen for, a spotlight per hero, a quick note box and the feed of
 * what the other modules saw. Start and Close the session here; closing writes the live log note.
 *
 * The same window is the GM console: a second tab, the Lens (../lens/), shows everything the notes know about
 * what is in front of the table; the book button opens the Library (../library/).
 */
import { MODULE_ID, localize, convert, getMarkdown, isCodexPage, updateMarkdown } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { decorateCallouts } from "../actions.mjs";
import { createCodexNote } from "../notes.mjs";
import { parseNote, buildLiveLog, pad2, duration, hash, isKindOfMoment, NOTE_TAGS, lastActivity, closeNudge, isNight, KINDS, KIND_ICONS, nowCards } from "./core.mjs";
import { kindInfo, kindOf, kindFilter, setKindFilter, writeKind } from "./kinds.mjs";
import { showRuleToast } from "./toasts.mjs";
import {
  subscribe, sheetPage, setSheet, candidateSheets, readSheet, run, mutateRun, setBeat, addNote, removeNote,
  asleep, absentHeroes, spotlight, setPresent, livePresence, flush
} from "./state.mjs";
import { hotBeats, cool, hear, recentContexts, whispersSince, moduleApi, isActiveGM, gmRest, herePlace, seenPeople } from "./context.mjs";
import { lens, setLensTarget } from "../lens/index.mjs";
import { renderLens, onLensClick, onLensSearch, labelTableCells } from "../lens/view.mjs";
import { openLibrary, wireCitations } from "../library/index.mjs";
import { assetsVersion, thingFor, triggerNames } from "../keys/index.mjs";
import { placeCardFor, npcCardNamed } from "../lens/data.mjs";
import { namesFromLabel, wfhOf, stripMd } from "../lens/core.mjs";
import { parseKey } from "../keys/core.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const TextEditorImpl = () => foundry.applications.ux.TextEditor.implementation;
const esc = escapeHTML;

/** A trigger chip: a key shows its note's name (the key itself in the tooltip). */
function triggerChip(t) {
  const p = parseKey(t);
  const thing = p ? thingFor(p.base) : null;
  const text = thing ? `${String(thing.title).split(/\s*\(/)[0]}${p.with.length ? ` + ${p.with.map(k => String(thingFor(k)?.title ?? k).split(/\s*\(/)[0]).join(" + ")}` : ""}` : t;
  return `<span class="pr-trig ${isKindOfMoment(t) ? "pr-kind" : ""} ${thing ? "pr-trig-key" : ""}" ${thing ? `data-tooltip="${esc(t)}"` : ""}>${esc(text)}</span>`;
}
const hhmm = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const DONE = ["played", "skipped"];
const UNDO_MS = 6000;
const FEED_SETTING = "prompterFeedOpen";
const feedOpen = () => { try { return game.settings.get(MODULE_ID, FEED_SETTING) !== false; } catch(err) { return true; } };
const setFeedOpen = open => game.settings.set(MODULE_ID, FEED_SETTING, !!open).catch(() => {});
/** Offer to close after this long with nothing happening at the table. */
const IDLE_MINUTES = 30;

export class PrompterPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-codex-prompter",
    classes: ["planar-codex", "codex-prompter"],
    window: { title: "PLANARCODEX.Prompter.Title", icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 440, height: 760 }
  };

  /** @type {PrompterPanel|null} */
  static instance = null;

  static open({ tab = null } = {}) {
    if ( !game.user.isGM ) return null;
    this.instance ??= new this();
    if ( tab && tab !== this.instance.tab ) {
      this.instance.tab = tab;
      if ( this.instance.rendered ) this.instance.render();
    }
    const w = Math.min(460, window.innerWidth - 40);
    const h = Math.max(420, Math.min(window.innerHeight - 90, 920));
    const left = Math.max(10, window.innerWidth - w - (document.getElementById("sidebar")?.offsetWidth ?? 300) - 24);
    if ( !this.instance.rendered ) this.instance.render({ force: true, position: { width: w, height: h, left, top: 60 } });
    else this.instance.bringToFront?.();
    return this.instance;
  }

  static toggle() {
    if ( this.instance?.rendered ) return this.instance.close();
    return this.open();
  }

  /** Open the panel and put the cursor in the note box. */
  static note() {
    const app = this.open({ tab: "prompter" });
    setTimeout(() => app?.element?.querySelector(".pr-note input")?.focus(), 150);
  }

  /** Open the Lens tab with the cursor in its search box. */
  static lens() {
    const app = this.open({ tab: "lens" });
    setTimeout(() => { const i = app?.element?.querySelector(".lens-search input"); i?.focus(); i?.select(); }, 150);
  }

  /** "prompter" or "lens". */
  tab = "prompter";
  expanded = new Set();
  #unsubscribe = null;
  #timer = null;
  #ticker = null;
  #bodies = new Map();
  #sent = new Map();
  /** The last ✓ / ✗ / later, for the Undo bar: {id, prev, text, until}. */
  #undo = null;
  #undoTimer = null;
  /** The cards in the Now strip, in order (keys 1 / 2 / 3 play them), and the place it was built for. */
  nowIds = [];
  #nowPlace = null;
  /** Cards whose kind picker is open (the GM clicked the kind badge). */
  picking = new Set();
  /** The close offer on screen ("rest" | "idle" | null), and the activity the GM last said "not yet" to. */
  #nudge = null;
  #nudgeDismissed = null;

  get title() { return localize(this.tab === "lens" ? "Lens.Title" : "Prompter.Title"); }

  /** Did the GM last click inside this window? Then plain keys are ours (see #onKey), else they're Foundry's (the hotbar). */
  #focused = false;
  #onPointer = ev => { this.#focused = !!this.element?.contains(ev.target); };
  #onKeyBound = ev => this.#onKey(ev);

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#unsubscribe = subscribe(() => this.renderSoon());
    document.addEventListener("pointerdown", this.#onPointer, true);
    document.addEventListener("keydown", this.#onKeyBound, true);
    this.#ticker = setInterval(() => this.#tick(), 30000);
  }

  _onClose(options) {
    super._onClose?.(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    document.removeEventListener("pointerdown", this.#onPointer, true);
    document.removeEventListener("keydown", this.#onKeyBound, true);
    clearInterval(this.#ticker);
    PrompterPanel.instance = null;
  }

  renderSoon() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { if ( this.rendered ) this.render(); }, 80);
  }

  /* -------------------------------------------- */
  /*  HTML                                        */
  /* -------------------------------------------- */

  async _renderHTML() {
    if ( lens.unseen && this.tab !== "lens" && game.settings.get(MODULE_ID, "lensSwitch") ) this.tab = "lens";
    if ( this.tab === "lens" ) lens.unseen = false;
    const body = this.tab === "lens" ? await renderLens() : await this.#prompterHTML();
    return `${this.#tabs()}${body}`;
  }

  #tabs() {
    const tab = (id, icon, label) => `<button type="button" class="cx-tab ${this.tab === id ? "active" : ""}" data-pr="tab" data-tab="${id}">
      <i class="${icon}"></i> ${label}${id === "lens" && lens.unseen ? ' <span class="cx-dot" aria-hidden="true">●</span>' : ""}</button>`;
    return `<nav class="cx-tabs">
      ${tab("prompter", "fa-solid fa-scroll", localize("Prompter.Title"))}
      ${tab("lens", "fa-solid fa-magnifying-glass", localize("Lens.Title"))}
      <button type="button" class="cx-tab cx-library" data-pr="library" data-tooltip="${esc(localize("Library.Title"))}"><i class="fa-solid fa-book"></i></button>
    </nav>`;
  }

  async #prompterHTML() {
    const page = sheetPage();
    if ( !page ) {
      return `<div class="pr-empty"><p>${localize("Prompter.NoSheet")}</p>
        <button type="button" data-pr="pick-sheet"><i class="fa-solid fa-list"></i> ${localize("Prompter.PickSheet")}</button></div>`;
    }
    const sheet = readSheet(page);
    const r = run(page);
    const hot = hotBeats();
    const status = id => r.beats[id]?.s ?? null;
    const filter = kindFilter();
    const show = b => filter === "all" || kindOf(b) === filter;
    const isRule = b => kindOf(b) === "rule";
    const beats = sheet.beats;
    const strip = this.#nowData(beats, r, hot);
    const inStrip = new Set(strip.cards.map(x => x.beat.id));
    this.nowIds = strip.cards.map(x => x.beat.id);
    // Rule cards are looked up, not played: their own section (folded unless the Κανόνες chip is on), never "missed".
    const rules = beats.filter(isRule).filter(show);
    const cards = beats.filter(b => !isRule(b));
    const open = cards.filter(b => !DONE.includes(status(b.id)) && !inStrip.has(b.id));
    const awake = open.filter(b => !asleep(b));
    const sleeping = open.filter(b => asleep(b)).filter(show);
    const must = awake.filter(b => b.priority === "must").filter(show);
    const now = awake.filter(b => b.priority !== "must" && hot.has(b.id)).filter(show).sort((a, b) => hot.get(b.id).t.localeCompare(hot.get(a.id).t));
    const later = b => (status(b.id) === "later" ? 1 : 0);
    const deck = awake.filter(b => ["should", "fit"].includes(b.priority) && !hot.has(b.id)).filter(show)
      .sort((a, b) => later(a) - later(b) || (a.priority === b.priority ? a.order - b.order : a.priority === "should" ? -1 : 1));
    const watch = awake.filter(b => b.priority === "watch" && !hot.has(b.id)).filter(show);
    const done = cards.filter(b => DONE.includes(status(b.id))).filter(show).sort((a, b) => String(r.beats[b.id].t).localeCompare(String(r.beats[a.id].t)));

    const section = (cls, icon, title, list, empty = "") => (list.length || (empty && filter === "all") ? `<section class="pr-section ${cls}">
      <h3><i class="${icon}"></i> ${title} <span class="pr-count">${list.length}</span></h3>
      ${list.length ? list.map(b => this.#card(b, r, hot)).join("") : `<p class="pr-none">${empty}</p>`}</section>` : "");
    const rulesHTML = !rules.length ? ""
      : filter === "rule" ? section("pr-rules", "fa-solid fa-scale-balanced", localize("Prompter.Section.Rules"), rules)
        : `<details class="pr-fold pr-rules"><summary><i class="fa-solid fa-scale-balanced"></i> ${localize("Prompter.Section.Rules")} <span class="pr-count">${rules.length}</span></summary>${rules.map(b => this.#card(b, r, hot)).join("")}</details>`;
    const nothing = filter !== "all" && !(must.length || now.length || deck.length || watch.length || sleeping.length || done.length || rules.length);

    this.#nudge = closeNudge(r, Date.now(), { idleMinutes: IDLE_MINUTES, dismissedAt: this.#nudgeDismissed });
    return `<div class="prompter">
      ${isActiveGM() ? "" : `<div class="pr-banner pr-banner-warn" role="alert"><i class="fa-solid fa-triangle-exclamation"></i> ${localize("Prompter.NotActiveGM")}</div>`}
      ${this.#header(page, sheet, r)}
      ${this.#nudgeBar()}
      ${this.#spotlight(page, r)}
      ${this.#filters(beats, r, filter)}
      ${r.active ? "" : `<div class="pr-start-hint"><i class="fa-solid fa-circle-info"></i> ${localize(r.closedAt ? "Prompter.ClosedHint" : "Prompter.StartHint")}</div>`}
      ${this.#nowStrip(strip, r, hot)}
      ${section("pr-must", "fa-solid fa-circle-exclamation", localize("Prompter.Section.Must"), must, strip.cards.length ? "" : localize("Prompter.MustDone"))}
      ${section("pr-now", "fa-solid fa-bolt", localize("Prompter.Section.Now"), now)}
      ${deck.length ? `<details class="pr-fold pr-deck" ${strip.cards.length ? "" : "open"}><summary><i class="fa-solid fa-layer-group"></i> ${localize("Prompter.Section.Deck")} <span class="pr-count">${deck.length}</span></summary>${deck.map(b => this.#card(b, r, hot)).join("")}</details>`
        : section("pr-deck", "fa-solid fa-layer-group", localize("Prompter.Section.Deck"), deck, localize("Prompter.DeckEmpty"))}
      ${watch.length ? `<details class="pr-fold pr-watch"><summary><i class="fa-solid fa-ear-listen"></i> ${localize("Prompter.Section.Watch")} <span class="pr-count">${watch.length}</span></summary>${watch.map(b => this.#card(b, r, hot)).join("")}</details>` : ""}
      ${sleeping.length ? `<details class="pr-fold pr-sleep"><summary><i class="fa-solid fa-moon"></i> ${localize("Prompter.Section.Sleeping")} <span class="pr-count">${sleeping.length}</span></summary>${sleeping.map(b => this.#card(b, r, hot)).join("")}</details>` : ""}
      ${rulesHTML}
      ${nothing ? `<p class="pr-none pr-filter-empty">${localize("Prompter.FilterEmpty")}</p>` : ""}
      ${done.length ? `<details class="pr-fold pr-done"><summary><i class="fa-solid fa-check-double"></i> ${localize("Prompter.Section.Done")} <span class="pr-count">${done.length}</span></summary>${done.map(b => this.#card(b, r, hot)).join("")}</details>` : ""}
      ${this.#feed(r)}
      ${this.#noteBox()}
      ${this.#undoBar()}
    </div>`;
  }

  /**
   * What the Now strip shows: where the party is (and its place card), who is here, and the two or three cards for it.
   * @returns {{here: object|null, card: object|null, name: string, people: {name: string, q: string, tip: string, seen: boolean}[], cards: object[]}}
   */
  #nowData(beats, r, hot) {
    const here = herePlace();
    let card = null;
    try { card = here ? placeCardFor(here.text) : null; } catch(err) { console.warn(err); }
    const label = here ? namesFromLabel(here.text) : [];
    const name = card ? (card.card.name || card.page.parent.name) : (label[0] ?? here?.text ?? "");
    const places = here ? [...new Set([here.text, ...label, ...(card ? [...card.names, ...card.theater, card.atlas].filter(Boolean) : [])])] : [];
    this.#nowPlace = here ? { name, q: card ? (card.card.name || card.names[0] || here.text) : (label[0] ?? here.text) } : null;
    // Who is here: people the table just showed (Theater NPC cards), then the place card's regulars.
    const people = [];
    const add = (n, seen) => {
      const q = n.card ? (n.card.name || n.page.parent.name) : n.name;
      if ( !q || people.some(p => p.q === q) ) return;
      const w = n.card ? wfhOf(n.card.by.wfh?.body) : {};
      const tip = [w.want && `${localize("Lens.Want")}: ${stripMd(w.want)}`, w.fear && `${localize("Lens.Fear")}: ${stripMd(w.fear)}`].filter(Boolean).join(" · ");
      people.push({ name: q, q, tip, seen });
    };
    const seenNames = seenPeople();
    for ( const text of seenNames ) {
      const first = namesFromLabel(text)[0] ?? text;
      const c = (() => { try { return npcCardNamed(first); } catch(err) { return null; } })();
      add(c ? { card: c.card, page: c.page } : { name: first }, true);
    }
    for ( const n of card?.who ?? [] ) add({ card: n.card, page: n.page }, false);
    const people2 = seenNames.flatMap(t => [t, ...namesFromLabel(t)]);
    const cards = r.active || here ? nowCards(beats, {
      status: r.beats, hot, places, since: here?.t ?? null, people: people2, regulars: card?.regulars ?? [],
      band: moduleApi("planar-atlas")?.clock?.()?.band ?? "", asleep, kindOf, expand: triggerNames
    }) : [];
    return { here, card, name, people, cards };
  }

  /** The band on top: here, who is here, and at most three cards (1 / 2 / 3 play them). */
  #nowStrip(strip, r, hot) {
    if ( !strip.here && !strip.cards.length ) return "";
    const when = strip.here?.t ? hhmm(strip.here.t) : "";
    const place = strip.here ? `<div class="pr-now-where">
        <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
        <a class="pr-now-place" data-pr="now-place" data-tooltip="${esc(localize(strip.card ? "Prompter.NowStrip.PlaceTip" : "Prompter.NowStrip.NoCardTip", { name: strip.name }))}">${esc(strip.name)}</a>
        <span class="pr-now-from">${esc([strip.here.label, when].filter(Boolean).join(" · "))}</span>
        <a class="pr-now-card" data-pr="now-place">${localize(strip.card ? "Prompter.NowStrip.PlaceCard" : "Prompter.NowStrip.Lens")}</a>
      </div>` : `<div class="pr-now-where pr-now-nowhere"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${localize("Prompter.NowStrip.Nowhere")}</div>`;
    const people = strip.people.length ? `<div class="pr-now-who"><span class="pr-now-lbl">${localize("Prompter.NowStrip.Here")}</span>
      ${strip.people.map(p => `<button type="button" class="pr-now-npc ${p.seen ? "pr-seen" : ""}" data-pr="now-npc" data-q="${esc(p.q)}" ${p.tip || p.seen ? `data-tooltip="${esc([p.seen ? localize("Prompter.NowStrip.OnStage") : "", p.tip].filter(Boolean).join(" · "))}"` : ""}>${p.seen ? '<i class="fa-solid fa-eye" aria-hidden="true"></i> ' : ""}${esc(p.name)}</button>`).join("")}</div>` : "";
    const cards = strip.cards.length ? strip.cards.map((x, i) => this.#card(x.beat, r, hot, { n: i + 1, why: x.why })).join("")
      : `<p class="pr-none">${localize("Prompter.NowStrip.Empty")}</p>`;
    return `<section class="pr-nowstrip" aria-label="${esc(localize("Prompter.NowStrip.Title"))}">
      <div class="pr-now-title">${localize("Prompter.NowStrip.Title")} <span class="pr-now-keys" data-tooltip="${esc(localize("Prompter.NowStrip.KeysTip"))}"><i class="fa-regular fa-keyboard"></i> 1 · 2 · 3</span></div>
      ${place}${people}${cards}</section>`;
  }

  /** Play the n-th card of the Now strip (keys 1 / 2 / 3, Alt+1 / 2 / 3 anywhere). */
  playNow(n) {
    const id = this.nowIds[n - 1];
    const page = sheetPage();
    if ( !id || !page ) return false;
    this.#play(id, page);
    return true;
  }

  #play(id, page) {
    // Where it happened: only what called the card (if it was hot). The last thing heard can be anywhere.
    const where = hotBeats().get(id)?.where ?? "";
    this.#offerUndo(id, page, "Prompter.UndoPlayed", this.#titleOf(page, id));
    setBeat(id, "played", where, page); this.expanded.delete(id); return cool(id);
  }

  #undoLast() {
    const u = this.#undo;
    if ( !u ) return;
    this.#undo = null;
    clearTimeout(this.#undoTimer);
    mutateRun(r => { r.beats[u.id] = u.prev; }, sheetPage());
  }

  /**
   * Keys at the table (§ 6.4): 1 / 2 / 3 play the Now cards, U undoes, R opens the place card. Only after a click in this
   * window (until a click elsewhere) and never while typing, so the hotbar's digits work everywhere else.
   */
  #onKey(ev) {
    if ( !this.#focused || !this.rendered || this.tab !== "prompter" ) return;
    if ( ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat ) return;
    if ( ev.target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']") ) return;
    const k = String(ev.key).toLowerCase();
    let done = false;
    if ( ["1", "2", "3"].includes(k) ) done = this.playNow(Number(k));
    else if ( k === "u" ) { done = !!this.#undo; this.#undoLast(); }
    else if ( k === "r" ) done = this.openHere();
    if ( done ) { ev.preventDefault(); ev.stopPropagation(); }
  }

  /** Open the Lens on where the party is. */
  openHere() {
    if ( !this.#nowPlace ) return false;
    setLensTarget(this.#nowPlace.q, { source: localize("Prompter.NowStrip.Title") });
    this.tab = "lens";
    this.render();
    return true;
  }

  /** "Played: X · Undo" for a few seconds after ✓, ✗ or later (a misclick used to stick). */
  #undoBar() {
    const u = this.#undo;
    if ( !u || Date.now() > u.until ) return "";
    return `<div class="pr-undo" role="status"><span>${esc(u.text)}</span>
      <button type="button" data-pr="undo"><i class="fa-solid fa-rotate-left"></i> ${localize("Prompter.Undo")}</button></div>`;
  }

  /** The offer to close: after a Long Rest, or when the table has been quiet for a while. */
  #nudgeBar() {
    if ( !this.#nudge ) return "";
    const text = this.#nudge === "rest" ? localize("Prompter.NudgeRest") : localize("Prompter.NudgeIdle", { min: IDLE_MINUTES });
    return `<div class="pr-banner pr-banner-nudge" role="status"><i class="fa-solid fa-moon"></i> <span>${text}</span>
      <button type="button" class="pr-close" data-pr="close-session"><i class="fa-solid fa-flag-checkered"></i> ${localize("Prompter.Close")}</button>
      <button type="button" data-pr="nudge-later">${localize("Prompter.NotYet")}</button></div>`;
  }

  /** Remember a beat's state before a change, and show the Undo bar. */
  #offerUndo(id, page, textKey, title) {
    const prev = foundry.utils.deepClone(run(page).beats[id] ?? { s: null });
    this.#undo = { id, prev, text: localize(textKey, { title }), until: Date.now() + UNDO_MS };
    clearTimeout(this.#undoTimer);
    this.#undoTimer = setTimeout(() => { this.#undo = null; this.renderSoon(); }, UNDO_MS + 50);
  }

  #header(page, sheet, r) {
    const atlas = moduleApi("planar-atlas");
    const world = atlas?.clockLabel?.() ?? "";
    const elapsed = r.active && r.startedAt ? duration(Date.now() - new Date(r.startedAt)) : "";
    const startBtn = r.active
      ? `<button type="button" class="pr-close" data-pr="close-session"><i class="fa-solid fa-flag-checkered"></i> ${localize("Prompter.Close")}</button>`
      : `<button type="button" class="pr-start" data-pr="start-session"><i class="fa-solid fa-play"></i> ${localize(r.closedAt ? "Prompter.Reopen" : "Prompter.Start")}</button>`;
    return `<header class="pr-head">
      <div class="pr-head-row">
        <a class="pr-sheet" data-pr="open-sheet" data-tooltip="${esc(localize("Prompter.OpenSheet"))}"><i class="fa-solid fa-file-lines"></i> ${esc(page.parent?.name ?? page.name)}</a>
        <button type="button" class="pr-icon" data-pr="pick-sheet" data-tooltip="${esc(localize("Prompter.PickSheet"))}"><i class="fa-solid fa-list"></i></button>
        <button type="button" class="pr-icon" data-pr="write-log" data-tooltip="${esc(localize("Prompter.WriteLog"))}"><i class="fa-solid fa-file-pen"></i></button>
      </div>
      <div class="pr-head-row">
        ${startBtn}
        ${elapsed ? `<span class="pr-elapsed" data-tooltip="${esc(localize("Prompter.Elapsed"))}"><i class="fa-regular fa-clock"></i> <b>${elapsed}</b></span>` : ""}
        ${world ? `<span class="pr-world" data-tooltip="${esc(localize("Prompter.WorldClock"))}"><i class="fa-solid fa-sun"></i> ${esc(world)}</span>` : ""}
        <span class="pr-session">${localize("Prompter.SessionN", { n: esc(pad2(sheet.session) || "?") })}</span>
      </div>
      <div class="pr-head-row pr-rests">
        <button type="button" class="pr-rest ${isNight(atlas?.clock?.()?.band ?? "") ? "pr-glow" : ""}" data-pr="rest" data-long="1" data-tooltip="${esc(localize("Prompter.RestTip", { rest: localize("Prompter.LongRest") }))}"><i class="fa-solid fa-bed"></i> ${localize("Prompter.LongRest")}</button>
        <button type="button" class="pr-rest" data-pr="rest" data-long="" data-tooltip="${esc(localize("Prompter.RestTip", { rest: localize("Prompter.ShortRest") }))}"><i class="fa-solid fa-mug-hot"></i> ${localize("Prompter.ShortRest")}</button>
      </div>
    </header>`;
  }

  #spotlight(page, r) {
    const list = spotlight(page, whispersSince(r.startedAt));
    if ( !list.length ) return "";
    const max = Math.max(...list.filter(h => h.present).map(h => h.count), 0);
    const chips = list.map(h => {
      const cls = ["pr-hero", h.present ? "" : "pr-absent", h.present && h.count === 0 && max > 0 ? "pr-zero" : ""].filter(Boolean).join(" ");
      const toggle = `<button type="button" class="pr-hero-toggle" data-pr="hero-toggle" data-actor="${esc(h.actorId)}" data-on="${h.present ? "" : "1"}"
        aria-label="${esc(localize(h.present ? "Prompter.HeroIn" : "Prompter.HeroOut", { name: h.name }))}" data-tooltip="${esc(localize(h.present ? "Prompter.HeroIn" : "Prompter.HeroOut", { name: h.name }))}">
        <i class="fa-solid ${h.present ? "fa-user-check" : "fa-user-slash"}"></i></button>`;
      return `<span class="pr-hero-chip ${h.present ? "" : "pr-absent"}"><button type="button" class="${cls}" data-pr="hero-note" data-name="${esc(h.short)}" data-tooltip="${esc(localize(h.present ? "Prompter.SpotlightTip" : "Prompter.Absent", { name: h.name }))}">${esc(h.short)}${h.present ? ` <b>${h.count}</b>` : ` · ${localize("Prompter.AbsentShort")}`}</button>${toggle}</span>`;
    }).join("");
    return `<div class="pr-spot"><i class="fa-solid fa-lightbulb" data-tooltip="${esc(localize("Prompter.Spotlight"))}"></i> ${chips}</div>`;
  }

  /** Όλα · Σκηνές · Στοιχεία · Ψίθυροι · Πρόσωπα · Γεγονότα · Κανόνες, with how many open cards each has. */
  #filters(beats, r, filter) {
    const counts = Object.fromEntries(KINDS.map(k => [k, 0]));
    for ( const b of beats ) {
      const k = kindOf(b);
      if ( k === "rule" || !DONE.includes(r.beats[b.id]?.s) ) counts[k]++;
    }
    const used = KINDS.filter(k => counts[k]);
    if ( used.length < 2 && filter === "all" ) return "";
    const chip = (k, label, n) => `<button type="button" class="pr-filter ${filter === k ? "active" : ""} ${k === "all" ? "" : `pr-kind-${k}`}" data-pr="filter" data-kind="${k}" aria-pressed="${filter === k}">
      ${k === "all" ? "" : `<span aria-hidden="true">${KIND_ICONS[k]}</span> `}${label}${n === null ? "" : ` <b>${n}</b>`}</button>`;
    return `<nav class="pr-filters" aria-label="${esc(localize("Prompter.KindFilter"))}">
      ${chip("all", localize("Prompter.Kinds.all"), null)}
      ${KINDS.filter(k => counts[k] || filter === k).map(k => chip(k, localize(`Prompter.Kinds.${k}`), counts[k])).join("")}
    </nav>`;
  }

  /** The kind badge (click: change it), and the picker when Codex can't tell or the GM asked. */
  #kindBadge(b, info) {
    const label = localize(`Prompter.Kind.${info.kind}`);
    const tip = localize(info.written ? "Prompter.KindWrittenTip" : "Prompter.KindGuessTip", { kind: label });
    return `<button type="button" class="pr-kind-badge pr-kind-${info.kind} ${info.written ? "" : "pr-guess"}" data-pr="kind-menu" data-tooltip="${esc(tip)}" aria-label="${esc(tip)}">${KIND_ICONS[info.kind]}</button>`;
  }

  #kindPicker(b, info, asked) {
    const chips = KINDS.map(k => `<button type="button" class="pr-kind-pick pr-kind-${k} ${info.kind === k ? "active" : ""}" data-pr="kind-set" data-kind="${k}">
      <span aria-hidden="true">${KIND_ICONS[k]}</span> ${localize(`Prompter.Kind.${k}`)}</button>`).join("");
    return `<div class="pr-kind-picker" role="group" aria-label="${esc(localize("Prompter.KindAsk"))}">
      <span class="pr-kind-ask">${localize(asked ? "Prompter.KindAsk" : "Prompter.KindChange")}</span>${chips}</div>`;
  }

  #card(b, r, hot, { n = 0, why = "" } = {}) {
    const info = kindInfo(b);
    if ( info.kind === "rule" ) return this.#ruleCard(b, r, info);
    const st = r.beats[b.id]?.s ?? null;
    const isDone = DONE.includes(st);
    const h = hot.get(b.id);
    const open = this.expanded.has(b.id);
    const ledger = b.ledger.map(n => `<span class="pr-ledger">#${esc(n)}</span>`).join("");
    const missed = b.missed ? `<span class="pr-missed" data-tooltip="${esc(localize("Prompter.MissedTip", { n: b.missed }))}">×${b.missed}</span>` : "";
    const pcs = b.pc.map(n => `<span class="pr-pc">${esc(n)}</span>`).join("");
    const trig = b.at.map(triggerChip).join("");
    // A clue is found or not found; a whisper is sent; the rest are played or skipped.
    const ok = { clue: ["Prompter.Found", "fa-magnifying-glass-plus"], whisper: ["Prompter.Sent", "fa-check"] }[info.kind] ?? ["Prompter.Played", "fa-check"];
    const no = info.kind === "clue" ? ["Prompter.NotFound", "fa-eye-slash"] : ["Prompter.Skip", "fa-xmark"];
    const doneMark = st === "played" ? (info.kind === "clue" ? "🔍" : "✓") : "✗";
    const lensBtn = info.kind === "npc" && !isDone ? `<button type="button" class="pr-btn pr-lens" data-pr="lens-npc" data-tooltip="${esc(localize("Prompter.OpenLens", { name: this.#personOf(b) }))}"><i class="fa-solid fa-user"></i></button>` : "";
    const buttons = isDone
      ? `<span class="pr-when">${doneMark} ${hhmm(r.beats[b.id].t)}</span><button type="button" class="pr-btn" data-pr="reset" data-tooltip="${esc(localize("Prompter.Reset"))}"><i class="fa-solid fa-rotate-left"></i></button>`
      : `${lensBtn}<button type="button" class="pr-btn pr-ok" data-pr="played" data-tooltip="${esc(localize(ok[0]))}"><i class="fa-solid ${ok[1]}"></i></button>
         <button type="button" class="pr-btn pr-no" data-pr="skip" data-tooltip="${esc(localize(no[0]))}"><i class="fa-solid ${no[1]}"></i></button>`;
    const asked = !info.sure && !info.written && !isDone;
    const picker = asked || this.picking.has(b.id) ? this.#kindPicker(b, info, asked) : "";
    const classes = ["pr-card", `pr-${b.priority}`, `pr-kind-${info.kind}`, h && !isDone ? "pr-hot" : "", open ? "pr-open" : "", st === "later" ? "pr-later" : "", isDone ? `pr-${st}` : "", n ? "pr-in-now" : ""].filter(Boolean).join(" ");
    const num = n ? `<kbd class="pr-now-n" data-tooltip="${esc(localize(`Prompter.NowStrip.Why.${why || "must"}`))}">${n}</kbd>` : "";
    return `<article class="${classes}" data-beat="${esc(b.id)}">
      <div class="pr-row" data-pr="toggle">
        <i class="pr-caret fa-solid ${open ? "fa-caret-down" : "fa-caret-right"}"></i>
        ${num}${this.#kindBadge(b, info)}
        <span class="pr-title">${esc(b.title)}</span>
        <span class="pr-meta">${ledger}${missed}</span>
        <span class="pr-btns">${buttons}</span>
      </div>
      ${picker}
      ${h && !isDone ? `<div class="pr-heard"><i class="fa-solid fa-bolt"></i> ${esc(h.where)} · ${hhmm(h.t)} <a data-pr="cool">${localize("Prompter.NotNow")}</a></div>` : ""}
      ${!isDone && asleep(b) ? `<div class="pr-asleep"><i class="fa-solid fa-moon"></i> ${localize("Prompter.AsleepWhy", { names: esc(absentHeroes(b).join(", ")) })}</div>` : ""}
      ${open ? `<div class="pr-sub">${pcs}${trig}</div>
        <div class="pr-body" data-body="${esc(b.id)}"><i class="fa-solid fa-spinner fa-spin"></i></div>
        <div class="pr-acts">
          ${isDone ? "" : `<button type="button" data-pr="later"><i class="fa-solid fa-forward"></i> ${localize("Prompter.Later")}</button>`}
          <button type="button" data-pr="jump"><i class="fa-solid fa-location-arrow"></i> ${localize("Prompter.Jump")}</button>
        </div>` : ""}
    </article>`;
  }

  /** A rule card: in the deck to look up, never ticked; its toast shows at its moment (or now, with ⚖). */
  #ruleCard(b, r, info) {
    const open = this.expanded.has(b.id);
    const times = (r.events ?? []).filter(e => e.kind === "rule" && e.beat === b.id).map(e => hhmm(e.t));
    const sleeping = asleep(b);
    const trig = b.at.map(triggerChip).join("");
    const pcs = b.pc.map(n => `<span class="pr-pc">${esc(n)}</span>`).join("");
    const picker = this.picking.has(b.id) ? this.#kindPicker(b, info, false) : "";
    return `<article class="pr-card pr-kind-rule ${open ? "pr-open" : ""} ${sleeping ? "pr-sleeping" : ""}" data-beat="${esc(b.id)}">
      <div class="pr-row" data-pr="toggle">
        <i class="pr-caret fa-solid ${open ? "fa-caret-down" : "fa-caret-right"}"></i>
        ${this.#kindBadge(b, info)}
        <span class="pr-title">${esc(b.title)}</span>
        <span class="pr-meta">${times.length ? `<span class="pr-reminded" data-tooltip="${esc(localize("Prompter.RemindedTip", { times: times.join(", ") }))}">⚖ ${times.length}</span>` : ""}</span>
        <span class="pr-btns"><button type="button" class="pr-btn pr-rule-show" data-pr="rule-show" data-tooltip="${esc(localize("Prompter.RuleShow"))}"><i class="fa-solid fa-scale-balanced"></i></button></span>
      </div>
      ${picker}
      ${sleeping ? `<div class="pr-asleep"><i class="fa-solid fa-moon"></i> ${localize("Prompter.AsleepWhy", { names: esc(absentHeroes(b).join(", ")) })}</div>` : ""}
      ${open ? `<div class="pr-sub">${pcs}${trig}</div>
        <div class="pr-body" data-body="${esc(b.id)}"><i class="fa-solid fa-spinner fa-spin"></i></div>
        <div class="pr-acts"><button type="button" data-pr="jump"><i class="fa-solid fa-location-arrow"></i> ${localize("Prompter.Jump")}</button></div>` : ""}
    </article>`;
  }

  /** The person an NPC card is about: its first moment that names one, else its title. */
  #personOf(b) {
    return b.at.find(t => !isKindOfMoment(t)) ?? b.title;
  }

  #feed(r) {
    const items = [
      ...r.notes.map(n => ({ t: n.t, html: `${n.tags.map(t => `<span class="pr-tag">#${esc(t)}</span>`).join(" ")} ${esc(n.text)}${n.where ? ` <span class="pr-note-where">📍 ${esc(n.where)}</span>` : ""} <a class="pr-del" data-pr="del-note" data-note="${esc(n.id)}" data-tooltip="${esc(localize("Prompter.DeleteNote"))}"><i class="fa-solid fa-trash"></i></a>`, note: true })),
      ...r.events.map(e => ({ t: e.t, html: `<b>${esc(e.label ?? e.kind)}</b> ${esc(e.text)}` }))
    ].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 12);
    const heard = recentContexts().slice(0, 1)[0];
    if ( !items.length && !heard ) return "";
    // Folds away (remembered per GM); folded, the summary still shows the latest line.
    const open = feedOpen();
    const last = items[0] ? `<span class="pr-feed-last"><span class="pr-t">${hhmm(items[0].t)}</span> ${items[0].html.replace(/<a class="pr-del"[\s\S]*?<\/a>/, "")}</span>` : "";
    const total = r.notes.length + r.events.length;
    return `<details class="pr-fold pr-feed" ${open ? "open" : ""}><summary><i class="fa-solid fa-satellite-dish"></i> ${localize("Prompter.Section.Feed")} <span class="pr-count">${total}</span>${last}</summary>
      <ul>${items.map(i => `<li class="${i.note ? "pr-feed-note" : ""}"><span class="pr-t">${hhmm(i.t)}</span> ${i.html}</li>`).join("")}</ul></details>`;
  }

  #noteBox() {
    // One tap writes the note at once, with where the party is and the time; typed text goes with it. Shift-click adds the tag to the text instead.
    const tip = esc(localize("Prompter.QuickTip"));
    const tags = NOTE_TAGS.map(t => `<button type="button" class="pr-tagbtn ${t === "paid" ? "pr-tag-paid" : ""}" data-pr="tag" data-tag="${t}" data-tooltip="${tip}">${t === "paid" ? esc(localize("Prompter.QuickPaid")) : `#${t}`}</button>`).join("");
    return `<form class="pr-note" autocomplete="off">
      <input type="text" name="note" placeholder="${esc(localize("Prompter.NotePlaceholder"))}">
      <button type="submit" data-tooltip="${esc(localize("Prompter.AddNote"))}"><i class="fa-solid fa-plus"></i></button>
      <div class="pr-tags">${tags}</div>
    </form>`;
  }

  _replaceHTML(result, content) {
    const scroller = content.closest(".window-content") ?? content;
    const top = scroller.scrollTop;
    const input = content.querySelector(".pr-note input");
    const keep = input ? { value: input.value, focus: document.activeElement === input, sel: input.selectionStart } : null;
    const lensInput = content.querySelector(".lens-search input");
    const lensKeep = lensInput && document.activeElement === lensInput ? { value: lensInput.value, sel: lensInput.selectionStart } : null;
    const folds = Object.fromEntries(Array.from(content.querySelectorAll("details.pr-fold")).map(d => [d.className, d.open]));
    content.innerHTML = result;
    for ( const d of content.querySelectorAll("details.pr-fold") ) if ( d.className in folds ) d.open = folds[d.className];
    scroller.scrollTop = top;
    const fresh = content.querySelector(".pr-note input");
    if ( fresh && keep ) {
      fresh.value = keep.value;
      if ( keep.focus ) { fresh.focus(); fresh.setSelectionRange(keep.sel ?? keep.value.length, keep.sel ?? keep.value.length); }
    }
    const freshLens = content.querySelector(".lens-search input");
    if ( freshLens && lensKeep ) {
      freshLens.value = lensKeep.value;
      freshLens.focus();
      freshLens.setSelectionRange(lensKeep.sel ?? lensKeep.value.length, lensKeep.sel ?? lensKeep.value.length);
    }
  }

  /* -------------------------------------------- */
  /*  Behaviour                                   */
  /* -------------------------------------------- */

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    const root = this.element;
    if ( !root.dataset.prompterWired ) {
      root.dataset.prompterWired = "1";
      root.addEventListener("click", ev => this.#onClick(ev));
      // <details> toggles don't bubble: listen in the capture phase. The feed's open/closed state is remembered.
      root.addEventListener("toggle", ev => {
        if ( ev.target.matches?.("details.pr-feed") && ev.target.open !== feedOpen() ) setFeedOpen(ev.target.open);
      }, true);
      root.addEventListener("submit", ev => {
        ev.preventDefault();
        if ( ev.target.closest(".lens-search") ) onLensSearch(ev.target.closest(".lens-search"));
        else this.#submitNote();
      });
      wireCitations(root);
    }
    const title = root.querySelector(".window-title");
    if ( title && title.textContent !== this.title ) title.textContent = this.title;
    if ( this.tab === "prompter" ) await this.#fillBodies();
    // Place and NPC cards in the Lens: read-alouds get Show / Post, private lines get Whisper.
    else {
      for ( const el of root.querySelectorAll(".lens-deco") ) decorateCallouts(el, { source: el.dataset.source ?? "" });
      labelTableCells(root);
    }
  }

  #tick() {
    if ( !this.rendered ) return;
    const r = run();
    const el = this.element.querySelector(".pr-elapsed b");
    if ( el && r.active && r.startedAt ) el.textContent = duration(Date.now() - new Date(r.startedAt));
    const w = this.element.querySelector(".pr-world");
    const label = moduleApi("planar-atlas")?.clockLabel?.();
    if ( w && label ) w.lastChild.textContent = ` ${label}`;
    // The close offer appears by itself once the table has been quiet long enough.
    if ( this.tab === "prompter" && closeNudge(r, Date.now(), { idleMinutes: IDLE_MINUTES, dismissedAt: this.#nudgeDismissed }) !== this.#nudge ) this.renderSoon();
  }

  async #fillBodies() {
    const page = sheetPage();
    if ( !page ) return;
    const beats = readSheet(page).beats;
    for ( const el of this.element.querySelectorAll(".pr-body[data-body]") ) {
      const beat = beats.find(b => b.id === el.dataset.body);
      if ( !beat ) continue;
      const key = `${page.uuid}|${beat.id}|${hash(beat.body)}|${assetsVersion()}`;
      let html = this.#bodies.get(key);
      if ( html === undefined ) {
        const { html: raw } = convert(beat.body || "", { gm: true, page });
        html = await TextEditorImpl().enrichHTML(raw, { relativeTo: page, secrets: true, rollData: {} });
        this.#bodies.set(key, html);
      }
      if ( !el.isConnected ) continue;
      el.innerHTML = html || `<p class="pr-none">${localize("Prompter.NoBody")}</p>`;
      el.classList.add("codex-page");
      decorateCallouts(el, {
        source: page.uuid,
        onUse: (kind, box) => {
          if ( kind !== "whisper" ) return;
          // The beat is played once every private line on its card has been sent.
          const lines = Array.from(el.querySelectorAll(".codex-callout-whisper"));
          const sent = this.#sent.get(beat.id) ?? new Set();
          sent.add(lines.indexOf(box));
          this.#sent.set(beat.id, sent);
          if ( sent.size < lines.length ) return;
          if ( game.settings.get(MODULE_ID, "prompterWhisperPlays") && run(page).beats[beat.id]?.s !== "played" ) {
            setBeat(beat.id, "played", localize("Prompter.ByWhisper"), page);
            cool(beat.id);
          }
        }
      });
    }
  }

  async #onClick(ev) {
    const content = this.element.querySelector(".window-content") ?? this.element;
    const lensTarget = ev.target.closest("[data-lens]");
    if ( lensTarget && content.contains(lensTarget) ) {
      ev.preventDefault();
      return onLensClick(lensTarget, this, jumpTo);
    }
    const target = ev.target.closest("[data-pr]");
    if ( !target || !content.contains(target) ) return;
    // Buttons inside a beat's body (Whisper, Show …) and links handle themselves.
    if ( target.closest(".pr-body") ) return;
    const action = target.dataset.pr;
    const card = target.closest("[data-beat]");
    const id = card?.dataset.beat;
    const page = sheetPage();
    ev.preventDefault();
    switch ( action ) {
      case "tab": this.tab = target.dataset.tab; return this.render();
      case "library": return openLibrary();
      case "toggle":
        if ( ev.target.closest(".pr-btns") ) return;
        if ( this.expanded.has(id) ) this.expanded.delete(id); else this.expanded.add(id);
        return this.render();
      case "played": return this.#play(id, page);
      case "now-place": return this.openHere();
      case "now-npc":
        setLensTarget(target.dataset.q, { source: localize("Prompter.NowStrip.Title") });
        this.tab = "lens";
        return this.render();
      case "skip":
        this.#offerUndo(id, page, "Prompter.UndoSkipped", this.#titleOf(page, id));
        setBeat(id, "skipped", "", page); this.expanded.delete(id); return cool(id);
      case "later":
        this.#offerUndo(id, page, "Prompter.UndoLater", this.#titleOf(page, id));
        setBeat(id, "later", "", page); this.expanded.delete(id); return cool(id);
      case "undo": return this.#undoLast();
      case "rest": return gmRest(!!target.dataset.long);
      case "filter": {
        const k = target.dataset.kind;
        await setKindFilter(k === kindFilter() ? "all" : k);
        return this.render();
      }
      case "kind-menu":
        if ( this.picking.has(id) ) this.picking.delete(id); else this.picking.add(id);
        return this.render();
      case "kind-set": {
        const beat = readSheet(page)?.beats.find(b => b.id === id);
        const kind = target.dataset.kind;
        this.picking.delete(id);
        const ok = await writeKind(page, beat, kind).catch(err => { console.warn(err); return false; });
        if ( ok ) ui.notifications.info(localize("Prompter.KindSaved", { title: beat.title, kind: localize(`Prompter.Kind.${kind}`) }));
        else if ( beat && kindOf(beat) !== kind ) ui.notifications.warn(localize("Prompter.KindNotSaved"));
        return this.render();
      }
      case "lens-npc": {
        const beat = readSheet(page)?.beats.find(b => b.id === id);
        if ( !beat ) return;
        setLensTarget(this.#personOf(beat), { source: localize("Prompter.Title") });
        this.tab = "lens";
        return this.render();
      }
      case "rule-show": {
        const beat = readSheet(page)?.beats.find(b => b.id === id);
        return showRuleToast(beat, page, localize("Prompter.RuleByHand"));
      }
      case "hero-toggle": return setPresent(target.dataset.actor, !!target.dataset.on, page);
      case "nudge-later": this.#nudgeDismissed = lastActivity(run(page)); return this.render();
      case "reset": return setBeat(id, null, "", page);
      case "cool": return cool(id);
      case "jump": return jumpTo(page, readSheet(page).beats.find(b => b.id === id)?.line ?? 0);
      case "open-sheet": return jumpTo(page, null);
      case "pick-sheet": return this.#pickSheet();
      case "start-session": return startSession(page);
      case "close-session": return closeSession(page);
      case "write-log": return writeLiveLog(page, { open: true });
      case "del-note": return removeNote(target.dataset.note, page);
      case "tag": return ev.shiftKey ? this.#insert(`#${target.dataset.tag} `) : this.#quickNote(target.dataset.tag);
      case "hero-note": return this.#insert(`${target.dataset.name}: `);
    }
  }

  #titleOf(page, id) { return readSheet(page)?.beats.find(b => b.id === id)?.title ?? ""; }

  #insert(text) {
    const input = this.element.querySelector(".pr-note input");
    if ( !input ) return;
    input.value = `${input.value}${input.value && !input.value.endsWith(" ") ? " " : ""}${text}`;
    input.focus();
  }

  /** A note in one tap: the tag, what's typed (if anything), where the party is. */
  #quickNote(tag) {
    const input = this.element.querySelector(".pr-note input");
    const { text, tags } = parseNote(input?.value ?? "", [tag]);
    const note = { text, tags };
    if ( this.#nowPlace?.name ) note.where = this.#nowPlace.name;
    addNote(note);
    if ( input ) input.value = "";
    ui.notifications.info(localize("Prompter.QuickSaved", { tag: `#${tag}`, where: note.where ?? "—" }));
  }

  #submitNote() {
    const input = this.element.querySelector(".pr-note input");
    const { text, tags } = parseNote(input?.value ?? "");
    if ( !text && !tags.length ) return;
    addNote(this.#nowPlace?.name ? { text, tags, where: this.#nowPlace.name } : { text, tags });
    input.value = "";
  }

  async #pickSheet() {
    const list = candidateSheets();
    if ( !list.length ) return ui.notifications.warn(localize("Prompter.NoSheet"));
    const current = sheetPage()?.uuid;
    const options = list.map(p => `<option value="${p.uuid}" ${p.uuid === current ? "selected" : ""}>${esc(p.parent?.name ?? p.name)}</option>`).join("");
    const uuid = await DialogV2.prompt({
      window: { title: localize("Prompter.PickSheet") },
      content: `<div class="form-group"><label>${localize("Prompter.Sheet")}</label><select name="sheet">${options}</select></div>`,
      ok: { label: localize("Prompter.Use"), callback: (event, button) => button.form.elements.sheet.value }
    }).catch(() => null);
    if ( uuid ) { setSheet(fromUuidSync(uuid)); this.expanded.clear(); }
  }
}

/* -------------------------------------------- */
/*  Session                                     */
/* -------------------------------------------- */

export function startSession(page = sheetPage()) {
  if ( !page ) return;
  const session = readSheet(page).session;
  mutateRun(r => {
    // Who is at the table, taken now and kept for the whole run (the log is written from it, even the next day).
    // Reopening with nobody logged in keeps the evening's snapshot.
    const live = livePresence();
    if ( !r.present || Object.values(live).some(Boolean) ) r.present = live;
    r.active = true;
    r.startedAt ??= new Date().toISOString();
    r.closedAt = null;
    r.session = session;
    r.events.push({ t: new Date().toISOString(), kind: "session", label: localize("Prompter.Source.Prompter"), text: localize("Prompter.Event.Started") });
  }, page);
  setSheet(page);
  // Tell the other modules which session this is (their logs and the party's road keep it).
  if ( session ) {
    moduleApi("planar-atlas")?.setNext?.({ session })?.catch?.(() => {});
    if ( game.settings.settings.has("planar-whispers.session") ) game.settings.set("planar-whispers", "session", session).catch(() => {});
  }
  setTimeout(() => hear({ kind: "start" }, { label: localize("Prompter.Source.Prompter") }), 300);
}

export async function closeSession(page = sheetPage()) {
  if ( !page ) return;
  const sheet = readSheet(page);
  const r = run(page);
  const open = sheet.beats.filter(b => !DONE.includes(r.beats[b.id]?.s) && !asleep(b) && kindOf(b) !== "rule");
  const must = open.filter(b => b.priority === "must");
  const questions = sheet.questions.map((q, i) => `<div class="form-group stacked"><label>${i + 1}. ${esc(q)}</label>
    <textarea name="q${i}" rows="2">${esc(r.answers?.[i] ?? "")}</textarea></div>`).join("");
  const warn = must.length ? `<p class="pr-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${localize("Prompter.CloseMust", { titles: must.map(b => esc(b.title)).join(" · ") })}</p>` : "";
  // Closed long after the last thing at the table (the next day): offer to close as of then.
  const last = lastActivity(r);
  const late = last && Date.now() - new Date(last).getTime() > 45 * 60000;
  const asOf = late ? `<div class="form-group"><label class="checkbox"><input type="checkbox" name="asOf" checked> ${localize("Prompter.CloseAsOf", { time: hhmm(last) })}</label></div>` : "";
  let closeAt = null;
  const answers = await DialogV2.prompt({
    window: { title: localize("Prompter.CloseTitle") },
    position: { width: 520 },
    classes: ["planar-codex", "codex-prompter-close"],
    content: `${warn}<p>${localize("Prompter.CloseIntro", { open: open.length })}</p>${asOf}${questions}`,
    ok: {
      label: localize("Prompter.CloseOk"),
      icon: "fa-solid fa-flag-checkered",
      callback: (event, button) => {
        if ( late && button.form.elements.asOf?.checked ) closeAt = last;
        return Object.fromEntries(sheet.questions.map((q, i) => [i, button.form.elements[`q${i}`]?.value ?? ""]));
      }
    }
  }).catch(() => null);
  if ( !answers ) return;
  mutateRun(run => {
    const at = closeAt ?? new Date().toISOString();
    run.answers = answers;
    run.events.push({ t: at, kind: "session", label: localize("Prompter.Source.Prompter"), text: localize("Prompter.Event.Closed") });
    run.active = false;
    run.closedAt = at;
  }, page);
  await flush();
  await writeLiveLog(page, { open: true });
}

/** Write (or rewrite) «Session NN - live log» next to the session notes. */
export async function writeLiveLog(page = sheetPage(), { open = false } = {}) {
  if ( !page ) return null;
  const sheet = readSheet(page);
  const r = run(page);
  const nn = pad2(sheet.session || "?");
  const name = `Session ${nn} - live log`;
  const markdown = buildLiveLog({
    sheetName: page.parent?.name ?? page.name, session: sheet.session || "?", beats: sheet.beats, state: r,
    questions: sheet.questions, asleep, absent: absentHeroes, kindOf,
    spotlight: spotlight(page, whispersSince(r.startedAt)).map(h => ({ name: h.name, count: h.count, present: h.present }))
  });
  let logPage = r.logUuid ? fromUuidSync(r.logUuid, { strict: false }) : null;
  if ( !logPage || !isCodexPage(logPage) ) {
    logPage = game.journal.find(e => e.name === name)?.pages.find(p => isCodexPage(p)) ?? null;
  }
  if ( logPage ) {
    if ( getMarkdown(logPage) !== markdown ) await updateMarkdown(logPage, markdown);
  } else {
    const folder = sessionsFolder(page);
    logPage = await createCodexNote({ name, folder, markdown });
  }
  if ( logPage && r.logUuid !== logPage.uuid ) mutateRun(x => { x.logUuid = logPage.uuid; }, page);
  if ( open && logPage ) logPage.parent.sheet.render(true, { pageId: logPage.id });
  ui.notifications.info(localize("Prompter.LogWritten", { name }));
  return logPage;
}

/** The Codex "Sessions" folder if there is one, else the run sheet's folder. */
function sessionsFolder(page) {
  const rootId = game.settings.get(MODULE_ID, "rootFolder");
  const isUnderRoot = f => { let x = f; while ( x ) { if ( x.id === rootId ) return true; x = x.folder; } return false; };
  const sessions = game.folders.find(f => f.type === "JournalEntry" && /^sessions$/i.test(f.name) && (!rootId || isUnderRoot(f)));
  return sessions?.id ?? page.parent?.folder?.id ?? null;
}

/** Open the run sheet, scrolled to a source line (or the top). */
export async function jumpTo(page, line) {
  if ( !page ) return;
  const sheet = page.parent.sheet;
  await sheet.render(true, { pageId: page.id });
  if ( line === null || line === undefined ) return;
  for ( let i = 0; i < 20; i++ ) {
    await new Promise(r => setTimeout(r, 100));
    const blocks = Array.from(sheet.element?.querySelectorAll(`[data-page-id="${page.id}"] [data-codex-line], .codex-page [data-codex-line]`) ?? []);
    if ( !blocks.length ) continue;
    let best = blocks[0];
    for ( const b of blocks ) if ( Number(b.dataset.codexLine) <= line ) best = b;
    best.scrollIntoView({ block: "center", behavior: "smooth" });
    best.classList.add("codex-flash");
    setTimeout(() => best.classList.remove("codex-flash"), 1600);
    return;
  }
}

