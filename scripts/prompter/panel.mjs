/**
 * Planar Codex — the Prompter panel (GM only).
 *
 * The session's deck beside the canvas: what must happen tonight, what the table just called for,
 * the rest of the deck, what to listen for, a spotlight per hero, a quick note box and the feed of
 * what the other modules saw. Start and Close the session here; closing writes the live log note.
 */
import { MODULE_ID, localize, convert, getMarkdown, isCodexPage, updateMarkdown } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { decorateCallouts } from "../actions.mjs";
import { createCodexNote } from "../notes.mjs";
import { parseNote, buildLiveLog, pad2, duration, hash, isKindOfMoment, NOTE_TAGS } from "./core.mjs";
import {
  subscribe, sheetPage, setSheet, candidateSheets, readSheet, run, mutateRun, setBeat, addNote, removeNote,
  asleep, spotlight, flush
} from "./state.mjs";
import { hotBeats, cool, hear, recentContexts, whispersSince, moduleApi } from "./context.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const TextEditorImpl = () => foundry.applications.ux.TextEditor.implementation;
const esc = escapeHTML;
const hhmm = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const DONE = ["played", "skipped"];

export class PrompterPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-codex-prompter",
    classes: ["planar-codex", "codex-prompter"],
    window: { title: "PLANARCODEX.Prompter.Title", icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 440, height: 760 }
  };

  /** @type {PrompterPanel|null} */
  static instance = null;

  static open() {
    if ( !game.user.isGM ) return null;
    this.instance ??= new this();
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
    const app = this.open();
    setTimeout(() => app?.element?.querySelector(".pr-note input")?.focus(), 150);
  }

  expanded = new Set();
  #unsubscribe = null;
  #timer = null;
  #ticker = null;
  #bodies = new Map();
  #sent = new Map();

  get title() { return localize("Prompter.Title"); }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#unsubscribe = subscribe(() => this.renderSoon());
    this.#ticker = setInterval(() => this.#tick(), 30000);
  }

  _onClose(options) {
    super._onClose?.(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
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
    const page = sheetPage();
    if ( !page ) {
      return `<div class="pr-empty"><p>${localize("Prompter.NoSheet")}</p>
        <button type="button" data-pr="pick-sheet"><i class="fa-solid fa-list"></i> ${localize("Prompter.PickSheet")}</button></div>`;
    }
    const sheet = readSheet(page);
    const r = run(page);
    const hot = hotBeats();
    const status = id => r.beats[id]?.s ?? null;
    const beats = sheet.beats;
    const open = beats.filter(b => !DONE.includes(status(b.id)));
    const awake = open.filter(b => !asleep(b));
    const sleeping = open.filter(b => asleep(b));
    const must = awake.filter(b => b.priority === "must");
    const now = awake.filter(b => b.priority !== "must" && hot.has(b.id)).sort((a, b) => hot.get(b.id).t.localeCompare(hot.get(a.id).t));
    const later = b => (status(b.id) === "later" ? 1 : 0);
    const deck = awake.filter(b => ["should", "fit"].includes(b.priority) && !hot.has(b.id))
      .sort((a, b) => later(a) - later(b) || (a.priority === b.priority ? a.order - b.order : a.priority === "should" ? -1 : 1));
    const watch = awake.filter(b => b.priority === "watch" && !hot.has(b.id));
    const done = beats.filter(b => DONE.includes(status(b.id))).sort((a, b) => String(r.beats[b.id].t).localeCompare(String(r.beats[a.id].t)));

    const section = (cls, icon, title, list, empty = "") => (list.length || empty ? `<section class="pr-section ${cls}">
      <h3><i class="${icon}"></i> ${title} <span class="pr-count">${list.length}</span></h3>
      ${list.length ? list.map(b => this.#card(b, r, hot)).join("") : `<p class="pr-none">${empty}</p>`}</section>` : "");

    return `<div class="prompter">
      ${this.#header(page, sheet, r)}
      ${this.#spotlight(page, r)}
      ${r.active ? "" : `<div class="pr-start-hint"><i class="fa-solid fa-circle-info"></i> ${localize(r.closedAt ? "Prompter.ClosedHint" : "Prompter.StartHint")}</div>`}
      ${section("pr-must", "fa-solid fa-circle-exclamation", localize("Prompter.Section.Must"), must, localize("Prompter.MustDone"))}
      ${section("pr-now", "fa-solid fa-bolt", localize("Prompter.Section.Now"), now)}
      ${section("pr-deck", "fa-solid fa-layer-group", localize("Prompter.Section.Deck"), deck, localize("Prompter.DeckEmpty"))}
      ${section("pr-watch", "fa-solid fa-ear-listen", localize("Prompter.Section.Watch"), watch)}
      ${sleeping.length ? `<details class="pr-fold pr-sleep"><summary><i class="fa-solid fa-moon"></i> ${localize("Prompter.Section.Sleeping")} <span class="pr-count">${sleeping.length}</span></summary>${sleeping.map(b => this.#card(b, r, hot)).join("")}</details>` : ""}
      ${done.length ? `<details class="pr-fold pr-done"><summary><i class="fa-solid fa-check-double"></i> ${localize("Prompter.Section.Done")} <span class="pr-count">${done.length}</span></summary>${done.map(b => this.#card(b, r, hot)).join("")}</details>` : ""}
      ${this.#feed(r)}
      ${this.#noteBox()}
    </div>`;
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
    </header>`;
  }

  #spotlight(page, r) {
    const list = spotlight(page, whispersSince(r.startedAt));
    if ( !list.length ) return "";
    const max = Math.max(...list.filter(h => h.present).map(h => h.count), 0);
    const chips = list.map(h => {
      const cls = ["pr-hero", h.present ? "" : "pr-absent", h.present && h.count === 0 && max > 0 ? "pr-zero" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" data-pr="hero-note" data-name="${esc(h.short)}" data-tooltip="${esc(localize(h.present ? "Prompter.SpotlightTip" : "Prompter.Absent", { name: h.name }))}">${esc(h.short)} <b>${h.count}</b></button>`;
    }).join("");
    return `<div class="pr-spot"><i class="fa-solid fa-lightbulb" data-tooltip="${esc(localize("Prompter.Spotlight"))}"></i> ${chips}</div>`;
  }

  #card(b, r, hot) {
    const st = r.beats[b.id]?.s ?? null;
    const isDone = DONE.includes(st);
    const h = hot.get(b.id);
    const open = this.expanded.has(b.id);
    const ledger = b.ledger.map(n => `<span class="pr-ledger">#${esc(n)}</span>`).join("");
    const missed = b.missed ? `<span class="pr-missed" data-tooltip="${esc(localize("Prompter.MissedTip", { n: b.missed }))}">×${b.missed}</span>` : "";
    const pcs = b.pc.map(n => `<span class="pr-pc">${esc(n)}</span>`).join("");
    const trig = b.at.map(t => `<span class="pr-trig ${isKindOfMoment(t) ? "pr-kind" : ""}">${esc(t)}</span>`).join("");
    const buttons = isDone
      ? `<span class="pr-when">${st === "played" ? "✓" : "✗"} ${hhmm(r.beats[b.id].t)}</span><button type="button" class="pr-btn" data-pr="reset" data-tooltip="${esc(localize("Prompter.Reset"))}"><i class="fa-solid fa-rotate-left"></i></button>`
      : `<button type="button" class="pr-btn pr-ok" data-pr="played" data-tooltip="${esc(localize("Prompter.Played"))}"><i class="fa-solid fa-check"></i></button>
         <button type="button" class="pr-btn pr-no" data-pr="skip" data-tooltip="${esc(localize("Prompter.Skip"))}"><i class="fa-solid fa-xmark"></i></button>`;
    const classes = ["pr-card", `pr-${b.priority}`, h && !isDone ? "pr-hot" : "", open ? "pr-open" : "", st === "later" ? "pr-later" : "", isDone ? `pr-${st}` : ""].filter(Boolean).join(" ");
    return `<article class="${classes}" data-beat="${esc(b.id)}">
      <div class="pr-row" data-pr="toggle">
        <i class="pr-caret fa-solid ${open ? "fa-caret-down" : "fa-caret-right"}"></i>
        <span class="pr-title">${esc(b.title)}</span>
        <span class="pr-meta">${ledger}${missed}</span>
        <span class="pr-btns">${buttons}</span>
      </div>
      ${h && !isDone ? `<div class="pr-heard"><i class="fa-solid fa-bolt"></i> ${esc(h.where)} · ${hhmm(h.t)} <a data-pr="cool">${localize("Prompter.NotNow")}</a></div>` : ""}
      ${open ? `<div class="pr-sub">${pcs}${trig}</div>
        <div class="pr-body" data-body="${esc(b.id)}"><i class="fa-solid fa-spinner fa-spin"></i></div>
        <div class="pr-acts">
          ${isDone ? "" : `<button type="button" data-pr="later"><i class="fa-solid fa-forward"></i> ${localize("Prompter.Later")}</button>`}
          <button type="button" data-pr="jump"><i class="fa-solid fa-location-arrow"></i> ${localize("Prompter.Jump")}</button>
        </div>` : ""}
    </article>`;
  }

  #feed(r) {
    const items = [
      ...r.notes.map(n => ({ t: n.t, html: `${n.tags.map(t => `<span class="pr-tag">#${esc(t)}</span>`).join(" ")} ${esc(n.text)} <a class="pr-del" data-pr="del-note" data-note="${esc(n.id)}" data-tooltip="${esc(localize("Prompter.DeleteNote"))}"><i class="fa-solid fa-trash"></i></a>`, note: true })),
      ...r.events.map(e => ({ t: e.t, html: `<b>${esc(e.label ?? e.kind)}</b> ${esc(e.text)}` }))
    ].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 12);
    const heard = recentContexts().slice(0, 1)[0];
    if ( !items.length && !heard ) return "";
    return `<section class="pr-section pr-feed"><h3><i class="fa-solid fa-satellite-dish"></i> ${localize("Prompter.Section.Feed")}</h3>
      <ul>${items.map(i => `<li class="${i.note ? "pr-feed-note" : ""}"><span class="pr-t">${hhmm(i.t)}</span> ${i.html}</li>`).join("")}</ul></section>`;
  }

  #noteBox() {
    const tags = NOTE_TAGS.map(t => `<button type="button" class="pr-tagbtn" data-pr="tag" data-tag="${t}">#${t}</button>`).join("");
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
    const folds = Object.fromEntries(Array.from(content.querySelectorAll("details.pr-fold")).map(d => [d.className, d.open]));
    content.innerHTML = result;
    for ( const d of content.querySelectorAll("details.pr-fold") ) if ( folds[d.className] ) d.open = true;
    scroller.scrollTop = top;
    const fresh = content.querySelector(".pr-note input");
    if ( fresh && keep ) {
      fresh.value = keep.value;
      if ( keep.focus ) { fresh.focus(); fresh.setSelectionRange(keep.sel ?? keep.value.length, keep.sel ?? keep.value.length); }
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
      root.addEventListener("submit", ev => { ev.preventDefault(); this.#submitNote(); });
    }
    await this.#fillBodies();
  }

  #tick() {
    if ( !this.rendered ) return;
    const r = run();
    const el = this.element.querySelector(".pr-elapsed b");
    if ( el && r.active && r.startedAt ) el.textContent = duration(Date.now() - new Date(r.startedAt));
    const w = this.element.querySelector(".pr-world");
    const label = moduleApi("planar-atlas")?.clockLabel?.();
    if ( w && label ) w.lastChild.textContent = ` ${label}`;
  }

  async #fillBodies() {
    const page = sheetPage();
    if ( !page ) return;
    const beats = readSheet(page).beats;
    for ( const el of this.element.querySelectorAll(".pr-body[data-body]") ) {
      const beat = beats.find(b => b.id === el.dataset.body);
      if ( !beat ) continue;
      const key = `${page.uuid}|${beat.id}|${hash(beat.body)}`;
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
      case "toggle":
        if ( ev.target.closest(".pr-btns") ) return;
        if ( this.expanded.has(id) ) this.expanded.delete(id); else this.expanded.add(id);
        return this.render();
      case "played": {
        const where = hotBeats().get(id)?.where ?? recentContexts()[0]?.text ?? "";
        setBeat(id, "played", where, page); this.expanded.delete(id); return cool(id);
      }
      case "skip": setBeat(id, "skipped", "", page); this.expanded.delete(id); return cool(id);
      case "later": setBeat(id, "later", "", page); this.expanded.delete(id); return cool(id);
      case "reset": return setBeat(id, null, "", page);
      case "cool": return cool(id);
      case "jump": return jumpTo(page, readSheet(page).beats.find(b => b.id === id)?.line ?? 0);
      case "open-sheet": return jumpTo(page, null);
      case "pick-sheet": return this.#pickSheet();
      case "start-session": return startSession(page);
      case "close-session": return closeSession(page);
      case "write-log": return writeLiveLog(page, { open: true });
      case "del-note": return removeNote(target.dataset.note, page);
      case "tag": return this.#insert(`#${target.dataset.tag} `);
      case "hero-note": return this.#insert(`${target.dataset.name}: `);
    }
  }

  #insert(text) {
    const input = this.element.querySelector(".pr-note input");
    if ( !input ) return;
    input.value = `${input.value}${input.value && !input.value.endsWith(" ") ? " " : ""}${text}`;
    input.focus();
  }

  #submitNote() {
    const input = this.element.querySelector(".pr-note input");
    const { text, tags } = parseNote(input?.value ?? "");
    if ( !text && !tags.length ) return;
    addNote({ text, tags });
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
  const open = sheet.beats.filter(b => !DONE.includes(r.beats[b.id]?.s) && !asleep(b));
  const must = open.filter(b => b.priority === "must");
  const questions = sheet.questions.map((q, i) => `<div class="form-group stacked"><label>${i + 1}. ${esc(q)}</label>
    <textarea name="q${i}" rows="2">${esc(r.answers?.[i] ?? "")}</textarea></div>`).join("");
  const warn = must.length ? `<p class="pr-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${localize("Prompter.CloseMust", { titles: must.map(b => esc(b.title)).join(" · ") })}</p>` : "";
  const answers = await DialogV2.prompt({
    window: { title: localize("Prompter.CloseTitle") },
    position: { width: 520 },
    classes: ["planar-codex", "codex-prompter-close"],
    content: `${warn}<p>${localize("Prompter.CloseIntro", { open: open.length })}</p>${questions}`,
    ok: {
      label: localize("Prompter.CloseOk"),
      icon: "fa-solid fa-flag-checkered",
      callback: (event, button) => Object.fromEntries(sheet.questions.map((q, i) => [i, button.form.elements[`q${i}`]?.value ?? ""]))
    }
  }).catch(() => null);
  if ( !answers ) return;
  mutateRun(run => {
    run.answers = answers;
    run.events.push({ t: new Date().toISOString(), kind: "session", label: localize("Prompter.Source.Prompter"), text: localize("Prompter.Event.Closed") });
    run.active = false;
    run.closedAt = new Date().toISOString();
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
    questions: sheet.questions, asleep, spotlight: spotlight(page, whispersSince(r.startedAt)).map(h => ({ name: h.name, count: h.count, present: h.present }))
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

