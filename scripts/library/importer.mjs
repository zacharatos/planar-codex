/**
 * Planar Codex — Library: Import books (GM). Pick the folder that holds the books (one subfolder per book,
 * one Markdown file per chapter); tick the books; they go into the GM-only Library compendium.
 */
import { localize } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { readBooksFolder, importBooks } from "./store.mjs";

const { ApplicationV2 } = foundry.applications.api;
const esc = escapeHTML;
/** Books with more chapters than this start unticked (rules books are already in the dnd5e compendiums). */
const BIG_BOOK = 60;

export class LibraryImporter extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-codex-library-import",
    classes: ["planar-codex", "codex-library-import"],
    window: { title: "PLANARCODEX.Library.ImportTitle", icon: "fa-solid fa-book-medical", resizable: true },
    position: { width: 560, height: "auto" }
  };

  static #instance = null;
  static open() {
    this.#instance ??= new this();
    this.#instance.render({ force: true });
    return this.#instance;
  }

  found = null;
  busy = false;
  status = "";

  async _renderHTML() {
    const books = this.found?.books ?? [];
    const rows = books.map((b, i) => `<label class="lib-import-row">
        <input type="checkbox" name="book" value="${i}" ${b.files.length <= BIG_BOOK ? "checked" : ""}>
        <input type="text" name="code-${i}" value="${esc(b.code)}" size="6" data-tooltip="${esc(localize("Library.CodeHint"))}">
        <span class="lib-import-name">${esc(b.folder)}</span> <span class="pr-count">${b.files.length}</span></label>`).join("");
    return `<form class="lib-import" autocomplete="off">
      <p class="hint">${localize("Library.ImportIntro")}</p>
      <div class="form-group">
        <button type="button" data-lib="pick"><i class="fa-solid fa-folder-open"></i> ${localize("Library.Pick")}</button>
        <span>${this.found ? `<b>${esc(this.found.root)}</b> · ${localize("Library.Found", { n: books.length })}` : localize("Library.NoFolder")}</span>
        <input type="file" name="folder" webkitdirectory directory multiple hidden>
      </div>
      ${books.length ? `<fieldset><legend>${localize("Library.Books")}</legend>${rows}<p class="hint">${localize("Library.BigHint", { n: BIG_BOOK })}</p></fieldset>
        <footer class="form-footer"><button type="button" data-lib="run" ${this.busy ? "disabled" : ""}><i class="fa-solid fa-book-medical"></i> ${localize("Library.Run")}</button></footer>` : ""}
      <p class="codex-status">${esc(this.status)}</p>
    </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector("input[name=folder]")?.addEventListener("change", ev => this.#read(ev.target.files));
    if ( !content.dataset.wired ) {
      content.dataset.wired = "1";
      content.addEventListener("click", ev => {
        const b = ev.target.closest("[data-lib]");
        if ( !b ) return;
        ev.preventDefault();
        if ( b.dataset.lib === "pick" ) content.querySelector("input[name=folder]")?.click();
        else if ( b.dataset.lib === "run" ) this.#run();
      });
    }
  }

  async #read(fileList) {
    const files = Array.from(fileList ?? []);
    if ( !files.length ) return;
    this.status = localize("Library.Reading");
    this.render();
    this.found = await readBooksFolder(files);
    this.status = "";
    this.render();
  }

  async #run() {
    if ( this.busy || !this.found ) return;
    const form = this.element.querySelector("form");
    const chosen = Array.from(form.querySelectorAll("input[name=book]:checked")).map(i => {
      const b = this.found.books[Number(i.value)];
      const code = form.elements[`code-${i.value}`]?.value?.trim() || b.code;
      return { ...b, code };
    });
    if ( !chosen.length ) return;
    this.busy = true;
    this.render();
    try {
      const done = await importBooks(chosen, { label: localize("Library.PackLabel"), progress: s => { this.status = s; this.render(); } });
      this.status = localize("Library.Done", { books: done.books, chapters: done.chapters });
      ui.notifications.info(this.status);
      const { LibraryWindow } = await import("./window.mjs");
      LibraryWindow.refresh();
    } catch(err) {
      console.error("planar-codex | library import failed", err);
      this.status = `${localize("Library.Failed")}: ${err.message}`;
      ui.notifications.error(this.status);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
