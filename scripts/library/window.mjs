/**
 * Planar Codex — Library: the reader window (GM only).
 *
 * Three views: the books (a list, or one book's contents), a section to read (with its place in the chapter,
 * the previous and next section, and the whole chapter on demand), and search results across the books.
 */
import { localize, renderMarkdown } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { searchBooks, sectionMarkdown, foldPlace } from "./core.mjs";
import { libraryBooks, loadBook, libraryPack, bookByCode } from "./store.mjs";
import { resolveCitation, openImporter } from "./index.mjs";

const { ApplicationV2 } = foundry.applications.api;
const esc = escapeHTML;
/** Sections deeper than this are part of their parent when stepping with ◀ ▶. */
const STEP_LEVEL = 4;

export class LibraryWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-codex-library",
    classes: ["planar-codex", "codex-library"],
    window: { title: "PLANARCODEX.Library.Title", icon: "fa-solid fa-book", resizable: true },
    position: { width: 620, height: 760 }
  };

  static #instance = null;

  /** @param {{cite?: string, before?: string, hints?: string[], query?: string, code?: string}} options */
  static async open(options = {}) {
    this.#instance ??= new this();
    const w = this.#instance;
    if ( options.cite ) await w.goCitation(options.cite, options.before, options.hints);
    else if ( options.query ) await w.search(options.query);
    else if ( options.code ) await w.showBook(options.code);
    if ( w.rendered ) { w.bringToFront?.(); w.render(); }
    else w.render({ force: true });
    return w;
  }

  static refresh() { if ( this.#instance?.rendered ) this.#instance.render(); }

  get title() { return localize("Library.Title"); }

  /** {view: "home"|"book"|"read"|"search", code, chapter, section, whole, query, scope, results, message} */
  state = { view: "home", code: null, chapter: 0, section: -1, whole: false, query: "", scope: "", results: [], message: "" };
  #scrollTop = false;

  /* -------------------------------------------- */
  /*  Navigation                                  */
  /* -------------------------------------------- */

  async goCitation(cite, before = "", hints = []) {
    const { parsed, book, hit } = await resolveCitation(cite, before, hints);
    if ( !book ) {
      const books = await libraryBooks();
      const message = books.length ? localize("Library.NoBook", { code: esc(parsed.code ?? "?") }) : localize("Library.Empty");
      return this.search(parsed.segments[parsed.segments.length - 1] ?? cite, { message });
    }
    if ( !hit ) return this.search(parsed.segments[parsed.segments.length - 1] ?? cite, { scope: book.code, message: localize("Library.NotFound", { cite: esc(cite) }) });
    this.#read(book.code, hit.chapter, hit.section);
    this.state.message = "";
  }

  async search(query, { scope = this.state.scope, message = "" } = {}) {
    const q = String(query ?? "").trim();
    const books = await libraryBooks();
    const chosen = scope ? books.filter(b => b.code === scope) : books;
    const list = [];
    for ( const b of chosen ) {
      const loaded = await loadBook(b);
      loaded.chapters.forEach((ch, i) => list.push({ book: b.name, code: b.code, chapter: i, name: ch.name, sections: ch.sections }));
    }
    Object.assign(this.state, { view: "search", query: q, scope, results: searchBooks(list, q, 60), message });
    this.#scrollTop = true;
  }

  async showBook(code) {
    Object.assign(this.state, { view: "book", code, message: "" });
    this.#scrollTop = true;
  }

  #read(code, chapter, section) {
    Object.assign(this.state, { view: "read", code, chapter, section, whole: false });
    this.#scrollTop = true;
  }

  /* -------------------------------------------- */
  /*  HTML                                        */
  /* -------------------------------------------- */

  async _renderHTML() {
    const books = await libraryBooks();
    const s = this.state;
    const scope = `<select name="scope"><option value="">${localize("Library.AllBooks")}</option>${books.map(b => `<option value="${esc(b.code)}" ${b.code === s.scope ? "selected" : ""}>${esc(b.code)} · ${esc(b.name)}</option>`).join("")}</select>`;
    const bar = `<form class="lib-search" autocomplete="off">
        <button type="button" class="lib-icon" data-lib="home" data-tooltip="${esc(localize("Library.Home"))}"><i class="fa-solid fa-book"></i></button>
        <input type="text" name="q" value="${esc(s.query)}" placeholder="${esc(localize("Library.SearchPlaceholder"))}">
        ${scope}
        <button type="button" class="lib-icon" data-lib="import" data-tooltip="${esc(localize("Library.ImportTitle"))}"><i class="fa-solid fa-book-medical"></i></button>
      </form>`;
    const msg = s.message ? `<p class="lib-message"><i class="fa-solid fa-circle-info"></i> ${s.message}</p>` : "";
    let body;
    if ( !books.length ) body = `<div class="lib-empty"><p>${localize("Library.Empty")}</p><button type="button" data-lib="import"><i class="fa-solid fa-book-medical"></i> ${localize("Library.ImportTitle")}</button></div>`;
    else if ( s.view === "search" ) body = this.#results();
    else if ( s.view === "read" ) body = await this.#reader();
    else if ( s.view === "book" ) body = await this.#contents(s.code);
    else body = `<ul class="lib-books">${books.map(b => `<li><a data-lib="book" data-code="${esc(b.code)}"><b>${esc(b.code)}</b> ${esc(b.name)} <span class="pr-count">${b.chapters}</span></a></li>`).join("")}</ul>`;
    return `<div class="lib">${bar}${msg}${body}</div>`;
  }

  #results() {
    const s = this.state;
    if ( !s.results.length ) return `<p class="lib-none">${localize("Library.NoResults", { q: esc(s.query) })}</p>`;
    return `<ul class="lib-results">${s.results.map(r => `<li><a data-lib="go" data-code="${esc(r.code)}" data-chapter="${r.chapter}" data-section="${r.section}">
        <span class="lib-where"><b>${esc(r.code)}</b> · ${esc(r.name)}</span> <span class="lib-head">${esc(r.heading)}</span>
        ${r.excerpt ? `<span class="lib-excerpt">${esc(r.excerpt)}</span>` : ""}</a></li>`).join("")}</ul>`;
  }

  async #contents(code) {
    const found = await bookByCode(code);
    if ( !found ) return `<p class="lib-none">${localize("Library.NoBook", { code: esc(code) })}</p>`;
    const book = await loadBook(found);
    const items = book.chapters.map((ch, ci) => {
      const heads = ch.sections.map((x, si) => ({ ...x, si })).filter(x => x.level && x.level <= 3)
        .map(x => `<li class="lib-l${x.level}"><a data-lib="go" data-code="${esc(code)}" data-chapter="${ci}" data-section="${x.si}">${esc(x.text)}</a></li>`).join("");
      return `<details class="lib-chapter"><summary><a data-lib="go" data-code="${esc(code)}" data-chapter="${ci}" data-section="-1">${esc(ch.name)}</a></summary><ul>${heads}</ul></details>`;
    }).join("");
    return `<h2 class="lib-title">${esc(book.name)}</h2>${items}`;
  }

  async #reader() {
    const s = this.state;
    const found = await bookByCode(s.code);
    if ( !found ) return `<p class="lib-none">${localize("Library.NoBook", { code: esc(s.code) })}</p>`;
    const book = await loadBook(found);
    const ch = book.chapters[s.chapter];
    if ( !ch ) return `<p class="lib-none">${localize("Library.Gone")}</p>`;
    const section = s.whole ? -1 : s.section;
    const trail = [];
    if ( s.section >= 0 ) {
      let level = ch.sections[s.section].level;
      for ( let i = s.section - 1; i >= 0; i-- ) {
        const x = ch.sections[i];
        if ( x.level && x.level < level ) { trail.unshift(x.text); level = x.level; }
      }
      trail.push(ch.sections[s.section].text);
    }
    const steps = ch.sections.map((x, i) => ({ ...x, i })).filter(x => x.level && x.level <= STEP_LEVEL);
    const at = steps.findIndex(x => x.i >= s.section);
    const prev = s.section >= 0 ? steps.filter(x => x.i < s.section).pop() : null;
    const next = at < 0 ? null : steps[steps[at].i === s.section ? at + 1 : at] ?? null;
    const nav = `<div class="lib-nav">
        <button type="button" data-lib="go" data-code="${esc(s.code)}" data-chapter="${s.chapter}" data-section="${prev ? prev.i : -1}" ${prev || s.section >= 0 ? "" : "disabled"}><i class="fa-solid fa-chevron-left"></i></button>
        <button type="button" data-lib="book" data-code="${esc(s.code)}"><i class="fa-solid fa-list"></i> ${localize("Library.Contents")}</button>
        ${s.section >= 0 ? `<button type="button" data-lib="whole" class="${s.whole ? "on" : ""}"><i class="fa-solid fa-file-lines"></i> ${localize("Library.WholeChapter")}</button>` : ""}
        <button type="button" data-lib="journal" data-tooltip="${esc(localize("Library.AsJournal"))}"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
        <button type="button" data-lib="go" data-code="${esc(s.code)}" data-chapter="${s.chapter}" data-section="${next ? next.i : s.section}" ${next ? "" : "disabled"}><i class="fa-solid fa-chevron-right"></i></button>
      </div>`;
    const same = (a, b) => foldPlace(a) === foldPlace(b);
    const crumbs = `<div class="lib-crumbs"><b>${esc(book.code)}</b> · ${esc(ch.name)}${trail.filter(t => !same(t, ch.name)).map(t => ` › ${esc(t)}`).join("")}</div>`;
    const html = renderMarkdown(sectionMarkdown(ch.markdown, ch.sections, section));
    return `${crumbs}${nav}<article class="lib-text codex-page">${html}</article>${nav}`;
  }

  _replaceHTML(result, content) {
    const scroller = content.closest(".window-content") ?? content;
    const top = scroller.scrollTop;
    const input = content.querySelector(".lib-search input[name=q]");
    const keep = input ? { focus: document.activeElement === input, value: input.value } : null;
    content.innerHTML = result;
    scroller.scrollTop = this.#scrollTop ? 0 : top;
    this.#scrollTop = false;
    const fresh = content.querySelector(".lib-search input[name=q]");
    if ( fresh && keep?.focus ) { fresh.value = keep.value; fresh.focus(); }
    if ( !content.dataset.wired ) {
      content.dataset.wired = "1";
      content.addEventListener("click", ev => this.#onClick(ev));
      content.addEventListener("submit", ev => { ev.preventDefault(); this.#onSubmit(ev.target); });
      content.addEventListener("change", ev => {
        if ( ev.target.name !== "scope" ) return;
        this.state.scope = ev.target.value;
        if ( this.state.view === "search" && this.state.query ) this.search(this.state.query).then(() => this.render());
      });
    }
  }

  async #onSubmit(form) {
    const q = form.querySelector("input[name=q]")?.value?.trim();
    if ( !q ) return;
    this.state.scope = form.querySelector("select[name=scope]")?.value ?? "";
    await this.search(q);
    this.render();
  }

  async #onClick(ev) {
    const el = ev.target.closest("[data-lib]");
    if ( !el ) return;
    ev.preventDefault();
    const d = el.dataset;
    switch ( d.lib ) {
      case "home": Object.assign(this.state, { view: "home", message: "" }); break;
      case "import": return openImporter();
      case "book": await this.showBook(d.code); break;
      case "go": this.#read(d.code, Number(d.chapter), Number(d.section)); this.state.message = ""; break;
      case "whole": this.state.whole = !this.state.whole; break;
      case "journal": {
        const found = await bookByCode(this.state.code);
        const entry = found ? await libraryPack()?.getDocument(found.id) : null;
        const page = entry?.pages.contents.sort((a, b) => a.sort - b.sort)[this.state.chapter];
        if ( entry ) entry.sheet.render(true, page ? { pageId: page.id } : {});
        return;
      }
      default: return;
    }
    this.render();
  }
}
