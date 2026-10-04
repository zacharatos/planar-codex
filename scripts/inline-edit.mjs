/**
 * Planar Codex — edit a note in place, where you are reading it.
 *
 * The rendered note is swapped for the Codex editor at the same spot on screen (the block you double-clicked,
 * the heading whose pencil you pressed, or whatever was at the top of the window), and swapped back when you
 * are done, scrolled to where you stopped editing. Edits are saved with Ctrl+S, when you press Done / Esc,
 * and automatically if the note leaves the screen (window closed, page turned) with unsaved changes.
 */
import { MODULE_ID, getMarkdown, markdownUpdate, resolveAsset, localize, isCodexPage } from "./codex.mjs";
import { linkIndex } from "./link-index.mjs";
import { CodexAutocomplete, viewAdapter, warmPacks, fold } from "./autocomplete.mjs";
import { createCodexEditor } from "./editor/editor.mjs";
import { findHeading, extractHeadings } from "./markdown.mjs";

/** page uuid → InlineSession */
const sessions = new Map();
/** page uuid → { sheet, root } for the note as currently rendered in a journal */
const views = new Map();
/** page uuid → { line, offset } scroll position to restore after the next render */
const restores = new Map();
/** The view the GM last pointed at, for the keyboard shortcut. */
let lastView = null;

export const isEditingInline = page => sessions.has(page?.uuid);

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

function scrollParent(el) {
  for ( let p = el?.parentElement; p; p = p.parentElement ) {
    const style = getComputedStyle(p);
    if ( /(auto|scroll|overlay)/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 1 ) return p;
  }
  for ( let p = el?.parentElement; p; p = p.parentElement ) {
    if ( /(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY) ) return p;
  }
  return document.scrollingElement ?? document.documentElement;
}

function viewportTop(scroller) {
  return scroller === document.scrollingElement || scroller === document.documentElement ? 0 : scroller.getBoundingClientRect().top;
}

/** Blocks of the rendered note that carry their source line, in document order. */
function lineBlocks(root) {
  return Array.from(root.querySelectorAll("[data-codex-line]")).filter(el => !el.closest(".codex-embed"));
}

/**
 * The first line of the note that is on screen: the top block, or inside a tall block (a long list or callout)
 * the first paragraph, item or row that is visible.
 * @returns {{line: number, ch: number, anchor: HTMLElement}|null}
 */
function topVisibleTarget(root, markdown) {
  const blocks = lineBlocks(root);
  if ( !blocks.length ) return null;
  const scroller = scrollParent(blocks[0]);
  const top = viewportTop(scroller) + BAR_SPACE;
  const index = Math.max(0, blocks.findIndex(b => b.getBoundingClientRect().bottom > top + 8));
  const block = blocks[index] ?? blocks.at(-1);
  const from = Number(block.dataset.codexLine);
  if ( block.getBoundingClientRect().top >= top - 4 ) return { line: from, ch: 0, anchor: block };
  const inner = Array.from(block.querySelectorAll("li, p, tr, h1, h2, h3, h4, h5, h6, .codex-callout-title"))
    .find(el => el.getBoundingClientRect().top >= top - 4);
  if ( !inner ) return { line: from, ch: 0, anchor: block };
  const next = blocks[index + 1];
  const { line } = locateText(markdown, from, next ? Number(next.dataset.codexLine) : Infinity, inner.textContent ?? "");
  return { line, ch: 0, anchor: inner };
}

/** Room left at the top for the editor's sticky bar. */
const BAR_SPACE = 48;

/** The rendered block for a source line: the last block starting at or before it. */
function blockForLine(root, line) {
  let best = null;
  for ( const b of lineBlocks(root) ) {
    if ( Number(b.dataset.codexLine) <= line ) best = b;
    else break;
  }
  return best;
}

/* -------------------------------------------- */
/*  Finding the line that was clicked           */
/* -------------------------------------------- */

const words = s => fold(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(w => w.length >= 3);

/**
 * Refine a block's starting line to the line inside it that holds some text (a list item, a line of a callout).
 * @param {string} markdown
 * @param {number} from      First line of the block (0-based).
 * @param {number} to        First line after the block.
 * @param {string} text      Text of the element that was clicked.
 * @param {string} [word]    The word under the pointer, to place the cursor on it.
 * @returns {{line: number, ch: number}}
 */
export function locateText(markdown, from, to, text, word = "") {
  const lines = markdown.split("\n");
  const want = words(text).slice(0, 6);
  let line = from;
  if ( want.length ) {
    let best = -1, bestScore = 0;
    for ( let i = from; i < Math.min(to, lines.length); i++ ) {
      const have = new Set(words(lines[i]));
      let score = 0;
      for ( const [k, w] of want.entries() ) if ( have.has(w) ) score += k < 3 ? 2 : 1;
      if ( score > bestScore ) { bestScore = score; best = i; }
    }
    if ( best >= 0 ) line = best;
  }
  let ch = 0;
  const w = String(word ?? "").trim();
  if ( w && lines[line] ) {
    const idx = fold(lines[line]).indexOf(fold(w));
    if ( idx >= 0 ) ch = idx;
  }
  return { line, ch };
}

/* -------------------------------------------- */
/*  The session                                 */
/* -------------------------------------------- */

class InlineSession {
  constructor(page) {
    this.page = page;
    this.base = getMarkdown(page);
    this.host = null;
    this.editor = null;
    this.saving = false;
    this.lost = 0;
    this.watch = null;
  }

  get uuid() { return this.page.uuid; }

  /**
   * Show the editor in place of the rendered note.
   * @param {HTMLElement} root     The page's rendered element.
   * @param {{line: number, ch?: number, anchor?: HTMLElement|null, y?: number|null}} at
   */
  open(root, { line, ch = 0, anchor = null, y = null }) {
    const container = contentContainer(root);
    const scroller = scrollParent(container);
    const lineHeight = parseFloat(getComputedStyle(container).lineHeight) || 24;
    const offset = Math.max(BAR_SPACE, y != null ? y - viewportTop(scroller) - lineHeight / 2
      : anchor ? anchor.getBoundingClientRect().top - viewportTop(scroller) : BAR_SPACE);

    this.host = root.ownerDocument.createElement("div");
    this.host.className = "codex-editor planar-codex codex-page";
    this.host.innerHTML = `
      <div class="codex-editor-bar">
        <button type="button" data-act="done" class="codex-editor-done"><i class="fa-solid fa-check"></i> ${localize("Editor.Done")}</button>
        <button type="button" data-act="mode" class="codex-editor-mode"></button>
        <span class="codex-editor-state"></span>
        <span class="codex-editor-spacer"></span>
        <span class="codex-editor-hint">${localize("Editor.Hint")}</span>
        <button type="button" data-act="discard" data-tooltip="${localize("Editor.Discard")}" aria-label="${localize("Editor.Discard")}"><i class="fa-solid fa-rotate-left"></i></button>
        <button type="button" data-act="foundry" data-tooltip="${localize("Editor.Foundry")}" aria-label="${localize("Editor.Foundry")}"><i class="fa-solid fa-up-right-from-square"></i></button>
      </div>
      <div class="codex-editor-cm"></div>`;
    this.#placeHost(container, root);

    const page = this.page;
    this.editor = createCodexEditor({
      parent: this.host.querySelector(".codex-editor-cm"),
      doc: this.base,
      line,
      source: game.settings.get(MODULE_ID, "editorSource"),
      placeholder: localize("Editor.Placeholder"),
      preview: {
        assetURL: name => resolveAsset(name),
        isResolved: link => !link.target || !!link.type || !!linkIndex.resolvePage(link.target, page),
        openLink: target => this.#openLink(target)
      },
      onSave: () => this.save(),
      onDone: () => this.close({ save: true }),
      onChange: dirty => this.#showState(dirty ? "dirty" : "saved"),
      onModeChange: source => { this.#showMode(source); game.settings.set(MODULE_ID, "editorSource", source); },
      onDrop: (event, view) => onDrop(event, view, page)
    });
    const view = this.editor.view;
    if ( !ch ) {
      // Start after the line's Markdown markers (#, -, 1., [ ], >, [!type]), where the text begins.
      const text = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).text;
      const lead = /^(?:\s*>\s?)*(?:\s*\[![^\]]*\][+-]?\s*)?(?:\s*(?:[-*+]|\d+[.)])\s+)?(?:\[.\]\s+)?(?:#{1,6}\s+)?/.exec(text);
      ch = lead ? lead[0].length : 0;
    }
    if ( ch ) {
      const ln = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
      view.dispatch({ selection: { anchor: Math.min(ln.to, ln.from + ch) } });
    }
    if ( game.settings.get(MODULE_ID, "autocomplete") ) {
      this.ac = new CodexAutocomplete(viewAdapter(view));
      warmPacks();
    }
    this.host.addEventListener("click", ev => this.#onBar(ev));
    this.#showMode(this.editor.isSource());
    this.#showState("saved");

    // Line the editor up so the line sits where the rendered block was, then keep the cursor visible.
    this.#align(line, offset);
    view.focus();

    this.watch = setInterval(() => this.#checkAttached(), 1000);
    sessions.set(this.uuid, this);
  }

  /** The journal re-rendered the page while we were editing: put the editor back. */
  remount(root) {
    if ( !this.host ) return;
    const view = this.editor.view;
    const hadFocus = view.hasFocus || document.activeElement === document.body;
    const anchor = restores.get(this.uuid) ?? this.#cursorAnchor();
    restores.delete(this.uuid);
    this.#placeHost(contentContainer(root), root);
    view.requestMeasure();
    if ( anchor ) this.#align(anchor.line, anchor.offset);
    if ( hadFocus ) view.focus();
    this.lost = 0;
  }

  #placeHost(container, root) {
    if ( container !== root ) {
      container.classList.add("codex-hidden-for-edit");
      container.after(this.host);
      return;
    }
    // The note's blocks sit directly in the page element: hide them, keep the page header.
    const kids = Array.from(root.children).filter(el => el !== this.host && !el.matches("header, .journal-page-header"));
    if ( !kids.length ) return root.append(this.host);   // empty note
    for ( const el of kids ) el.classList.add("codex-hidden-for-edit");
    kids[0].before(this.host);
  }

  /**
   * Scroll so 0-based `line` of the editor sits `offset` px below the top of the scroll area, and keep it there
   * while CodeMirror measures the real line heights (a second or so), unless the user scrolls, clicks or types first.
   */
  #align(line, offset) {
    const view = this.editor.view;
    const doc = view.state.doc;
    const pos = doc.line(Math.min(Math.max(1, line + 1), doc.lines)).from;
    const scroller = scrollParent(view.dom);
    const run = () => {
      if ( !view.dom.isConnected ) return;
      const block = view.lineBlockAt(pos);
      const want = viewportTop(scroller) + offset;
      const have = view.documentTop + block.top;
      if ( Math.abs(have - want) > 1 ) scroller.scrollTop += have - want;
    };
    this.#stopAlign?.();
    const win = view.dom.ownerDocument.defaultView ?? window;
    const observer = new win.ResizeObserver(() => run());
    const timers = [60, 200, 450, 900].map(ms => setTimeout(run, ms));
    const stop = () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      for ( const [el, type] of listeners ) el.removeEventListener(type, stop, true);
      this.#stopAlign = null;
    };
    const listeners = [[scroller, "wheel"], [scroller, "touchstart"], [view.dom, "keydown"], [view.dom, "pointerdown"], [scroller, "pointerdown"]];
    for ( const [el, type] of listeners ) el.addEventListener(type, stop, { capture: true, passive: true });
    this.#stopAlign = stop;
    run();
    observer.observe(view.contentDOM);
    setTimeout(stop, 1500);
  }

  #stopAlign = null;

  /** Where the cursor (or the top of the visible text) is, for lining things up after editing. */
  #cursorAnchor() {
    const view = this.editor?.view;
    if ( !view?.dom.isConnected ) return null;
    const scroller = scrollParent(view.dom);
    const top = viewportTop(scroller);
    const bottom = top + scroller.clientHeight;
    const head = view.state.selection.main.head;
    const coords = view.coordsAtPos(head);
    if ( coords && coords.top >= top && coords.bottom <= bottom ) {
      return { line: view.state.doc.lineAt(head).number - 1, offset: coords.top - top };
    }
    const block = view.lineBlockAtHeight(top - view.documentTop + 4);
    return { line: view.state.doc.lineAt(block.from).number - 1, offset: view.documentTop + block.top - top };
  }

  #showState(state) {
    const el = this.host?.querySelector(".codex-editor-state");
    if ( !el ) return;
    el.dataset.state = state;
    el.textContent = localize(`Editor.State.${state}`);
  }

  #showMode(source) {
    const b = this.host?.querySelector(".codex-editor-mode");
    if ( !b ) return;
    b.innerHTML = source ? `<i class="fa-solid fa-code"></i> ${localize("Editor.Source")}` : `<i class="fa-solid fa-eye"></i> ${localize("Editor.Live")}`;
    b.dataset.tooltip = localize("Editor.ModeTooltip");
  }

  async #onBar(ev) {
    const b = ev.target.closest("button[data-act]");
    if ( !b || !this.host.querySelector(".codex-editor-bar").contains(b) ) return;
    ev.preventDefault();
    switch ( b.dataset.act ) {
      case "done": return this.close({ save: true });
      case "mode": this.editor.setSource(!this.editor.isSource()); this.editor.view.focus(); return;
      case "discard": {
        if ( this.editor.isDirty() ) {
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize("Editor.Discard") }, content: `<p>${localize("Editor.DiscardConfirm")}</p>`, rejectClose: false
          });
          if ( !ok ) return;
        }
        return this.close({ save: false });
      }
      case "foundry": {
        await this.close({ save: true });
        return this.page.sheet.render({ force: true, codexForce: true });
      }
    }
  }

  async #openLink(target) {
    const page = this.page;
    try {
      if ( target.kind === "url" ) return window.open(target.raw, "_blank", "noopener");
      if ( target.kind === "roll" ) return;
      if ( target.kind === "foundry" ) {
        const m = /^@UUID\[([^\]#]+)/.exec(target.raw);
        const doc = m ? await fromUuid(m[1]) : null;
        return doc?.sheet?.render(true);
      }
      const link = target.link;
      if ( link.type ) {
        const uuid = await linkIndex.resolveTyped(link.type, link.name);
        const doc = uuid ? await fromUuid(uuid) : null;
        if ( doc ) return doc.sheet?.render(true);
        return ui.notifications.warn(localize("Link.TypedMissing"));
      }
      if ( !link.target && link.heading ) {
        // A heading in this note: jump there in the editor.
        const md = this.editor.getValue();
        const h = findHeading(extractHeadings(md).map((x, i) => ({ ...x, i })), link.heading);
        if ( h ) {
          const lines = md.split("\n");
          let n = -1, idx = -1;
          for ( let i = 0; i < lines.length; i++ ) {
            if ( /^#{1,6}\s/.test(lines[i]) && ++n === h.i ) { idx = i; break; }
          }
          if ( idx >= 0 ) this.editor.focusLine(idx);
        }
        return;
      }
      const dest = linkIndex.resolvePage(link.target, page);
      if ( !dest ) return ui.notifications.info(localize("Link.CreateTooltip"));
      const anchor = link.heading ? linkIndex.headingSlug(dest, link.heading) : undefined;
      if ( dest.parent === page.parent ) return dest.parent.sheet.goToPage?.(dest.id, { anchor });
      return dest.parent.sheet.render(true, { pageId: dest.id, anchor });
    } catch(err) {
      console.error(`${MODULE_ID} | could not open link`, err);
    }
  }

  /** Save the current text. */
  async save({ quiet = false } = {}) {
    if ( !this.editor || this.saving ) return false;
    const md = this.editor.getValue();
    if ( md === this.base && !this.editor.isDirty() ) return true;
    const current = getMarkdown(this.page);
    if ( current !== this.base && current !== md ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: localize("Editor.ConflictTitle") },
        content: `<p>${localize("Editor.Conflict")}</p>`,
        rejectClose: false
      });
      if ( !ok ) return false;
    }
    this.saving = true;
    this.#showState("saving");
    try {
      const anchor = this.#cursorAnchor();
      if ( anchor ) restores.set(this.uuid, anchor);
      await this.page.update(markdownUpdate(this.page, md));
      this.base = md;
      this.editor.markSaved(md);
      this.#showState(this.editor.isDirty() ? "dirty" : "saved");
      return true;
    } catch(err) {
      console.error(`${MODULE_ID} | save failed`, err);
      this.#showState("error");
      if ( !quiet ) ui.notifications.error(localize("Editor.SaveFailed"));
      return false;
    } finally {
      this.saving = false;
    }
  }

  /** Leave the editor and show the rendered note again, at the same place. */
  async close({ save = true } = {}) {
    if ( !this.editor ) return;
    if ( save && this.editor.isDirty() ) {
      const ok = await this.save();
      if ( !ok ) return;
    }
    const anchor = this.#cursorAnchor();
    this.#teardown();
    const root = views.get(this.uuid)?.root;
    if ( anchor ) restores.set(this.uuid, anchor);
    if ( root?.isConnected ) applyRestore(this.page, root);
  }

  #teardown() {
    clearInterval(this.watch);
    this.#stopAlign?.();
    this.ac?.close();
    this.editor?.destroy();
    this.host?.remove();
    const root = views.get(this.uuid)?.root;
    for ( const el of root?.querySelectorAll(".codex-hidden-for-edit") ?? [] ) el.classList.remove("codex-hidden-for-edit");
    this.editor = null;
    this.host = null;
    sessions.delete(this.uuid);
  }

  /** If the editor has left the page (window closed, page turned), save what was typed and stop. */
  async #checkAttached() {
    if ( !this.host ) return clearInterval(this.watch);
    if ( this.host.isConnected ) { this.lost = 0; return; }
    if ( ++this.lost < 2 ) return;
    clearInterval(this.watch);
    const alive = !!this.page.parent?.pages.get(this.page.id);
    if ( alive && this.editor?.isDirty() ) {
      const ok = await this.save({ quiet: true });
      if ( ok ) ui.notifications.info(localize("Editor.AutoSaved", { name: this.page.parent?.name ?? this.page.name }));
    }
    this.#teardown();
  }
}

/** The element holding the rendered note (the parent of its blocks). */
export function contentContainer(root) {
  const block = root.querySelector("[data-codex-line]");
  if ( block?.parentElement ) return block.parentElement;
  return root.querySelector(".journal-page-content, .editor-content") ?? root;
}

/* -------------------------------------------- */
/*  Dropping documents into the editor          */
/* -------------------------------------------- */

function onDrop(event, view, page) {
  let data;
  try { data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? ""); }
  catch { return false; }
  if ( !data?.type ) return false;
  event.preventDefault();
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
  (async () => {
    let text = null;
    const doc = data.uuid ? await fromUuid(data.uuid) : null;
    if ( doc && ["JournalEntry", "JournalEntryPage"].includes(doc.documentName) ) {
      const target = doc.documentName === "JournalEntry" ? doc.pages.find(p => isCodexPage(p)) : doc;
      if ( target && isCodexPage(target) ) {
        const anchor = data.anchor?.name ? `#${data.anchor.name}` : "";
        text = `[[${target.parent.name}${anchor}]]`;
      }
    }
    if ( !text && doc ) text = `@UUID[${doc.uuid}]{${String(doc.name ?? "").replace(/[{}]/g, "")}}`;
    if ( !text ) return;
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, userEvent: "input.drop" });
    view.focus();
  })();
  return true;
}

/* -------------------------------------------- */
/*  Hooks used by the sheet                     */
/* -------------------------------------------- */

/** Restore the reading position after editing or saving. */
function applyRestore(page, root) {
  const r = restores.get(page.uuid);
  if ( !r ) return;
  restores.delete(page.uuid);
  const run = () => {
    const block = blockForLine(root, r.line);
    if ( !block ) return;
    const scroller = scrollParent(block);
    const have = block.getBoundingClientRect().top - viewportTop(scroller);
    scroller.scrollTop += have - r.offset;
  };
  run();
  requestAnimationFrame(run);
}

/**
 * Start editing a page in place.
 * @param {JournalEntryPage} page
 * @param {{line?: number, ch?: number, anchor?: HTMLElement|null, y?: number}} [at]  Where to open: a 0-based source line,
 *   lined up with `anchor`'s top or the screen position `y`. Defaults to the block at the top of the window.
 * @returns {boolean} Whether the editor opened.
 */
export function editInPlace(page, at = {}) {
  if ( !page?.isOwner ) return false;
  const existing = sessions.get(page.uuid);
  if ( existing?.host?.isConnected ) { existing.editor.view.focus(); return true; }
  existing?.close({ save: true });
  const v = views.get(page.uuid);
  if ( !v?.root?.isConnected ) return false;
  let { line, anchor = null, ch = 0, y = null } = at;
  if ( line == null ) {
    const target = topVisibleTarget(v.root, getMarkdown(page));
    line = target?.line ?? 0;
    anchor = target?.anchor ?? null;
  }
  const session = new InlineSession(page);
  session.open(v.root, { line, ch, anchor, y });
  return true;
}

/**
 * Called from the sheet's _onRender in view mode.
 * @param {foundry.applications.api.ApplicationV2} sheet
 * @param {HTMLElement} root
 */
export function onViewRendered(sheet, root) {
  const page = sheet.document;
  views.set(page.uuid, { sheet, root });
  const session = sessions.get(page.uuid);
  if ( session ) session.remount(root);
  else applyRestore(page, root);
  if ( !page.isOwner ) return;

  // A pencil on each heading: edit from there.
  for ( const h of root.querySelectorAll(":is(h1, h2, h3, h4, h5, h6)[data-codex-line]") ) {
    if ( h.closest(".codex-embed") || h.querySelector(".codex-edit-here") ) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "codex-edit-here";
    b.dataset.tooltip = localize("Editor.EditSection");
    b.setAttribute("aria-label", localize("Editor.EditSection"));
    b.innerHTML = `<i class="fa-solid fa-pen"></i>`;
    b.addEventListener("click", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      editInPlace(page, { line: Number(h.dataset.codexLine), anchor: h });
    });
    h.append(b);
  }

  if ( root.dataset.codexInline ) return;
  root.dataset.codexInline = "1";
  root.addEventListener("pointerenter", () => { lastView = page; });
  root.addEventListener("pointerdown", () => { lastView = page; });

  // Double-click a paragraph, list item or callout line: edit right there.
  root.addEventListener("dblclick", ev => {
    if ( !game.settings.get(MODULE_ID, "dblclickEdit") ) return;
    const t = ev.target;
    if ( t.closest("a, button, input, select, textarea, summary, img, .inline-roll, .content-link, .codex-editor, .codex-embed, .codex-properties, .codex-backlinks") ) return;
    const block = t.closest("[data-codex-line]");
    if ( !block || !root.contains(block) ) return;
    ev.preventDefault();
    const word = window.getSelection()?.toString() ?? "";
    window.getSelection()?.removeAllRanges();
    const from = Number(block.dataset.codexLine);
    const blocks = lineBlocks(root);
    const next = blocks[blocks.indexOf(block) + 1];
    const to = next ? Number(next.dataset.codexLine) : Infinity;
    const inner = t.closest("li, p, td, th, h1, h2, h3, h4, h5, h6, .codex-callout-title") ?? block;
    const md = getMarkdown(page);
    const { line, ch } = locateText(md, from, to, inner.textContent ?? "", word);
    editInPlace(page, { line, ch, anchor: inner, y: ev.clientY });
  });
}

/** Keyboard shortcut: edit the note under the pointer at the place on screen. */
export function editHereFromKeyboard() {
  for ( const s of sessions.values() ) {
    if ( s.editor?.view.hasFocus ) { s.close({ save: true }); return true; }
  }
  const page = lastView;
  if ( !page || !views.get(page.uuid)?.root?.isConnected ) return false;
  return editInPlace(page);
}

/** Before a sheet opens its own edit window: open in place instead, when the note is on screen. */
export function interceptEdit(page) {
  if ( !game.settings.get(MODULE_ID, "inlineEdit") ) return false;
  if ( !views.get(page.uuid)?.root?.isConnected ) return false;
  return editInPlace(page);
}

/** Unsaved inline edits block a reload with the browser's own warning. */
globalThis.window?.addEventListener("beforeunload", ev => {
  for ( const s of sessions.values() ) {
    if ( s.editor?.isDirty() ) { ev.preventDefault(); ev.returnValue = ""; return; }
  }
});

export function anyInlineSession() { return sessions.size > 0; }
