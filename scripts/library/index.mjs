/**
 * Planar Codex — Library (Βιβλιοθήκη): opening the books from citations, the keybinding and the API.
 * See core.mjs (pure), store.mjs (the compendium), window.mjs (the reader) and importer.mjs (Import books).
 */
import { MODULE_ID } from "../codex.mjs";
import { parseCitation, findSection, placeScore } from "./core.mjs";
import { bookByCode, loadBook, libraryBooks, libraryPack } from "./store.mjs";

let windows = null;
/** The window classes, loaded on first use (players never need them). */
async function loadWindows() {
  windows ??= { ...(await import("./window.mjs")), ...(await import("./importer.mjs")) };
  return windows;
}

/**
 * Open the Library (GM only).
 * @param {object} [options]
 * @param {string} [options.cite]    a citation to open at (`ToFW, Ch. 2 › Harmonium Officers`)
 * @param {string} [options.before]  the citation before it, for "› M3" (same book)
 * @param {string[]} [options.hints] book codes cited around it, the most cited first
 * @param {string} [options.query]   search for this
 * @param {string} [options.code]    open this book's contents
 */
export async function openLibrary(options = {}) {
  if ( !game.user.isGM ) return null;
  const { LibraryWindow } = await loadWindows();
  return LibraryWindow.open(options);
}

export async function openImporter() {
  if ( !game.user.isGM ) return null;
  const { LibraryImporter } = await loadWindows();
  return LibraryImporter.open();
}

/**
 * Where a citation points.
 * "› M3" has no book: it is looked for first in the book of the citation before it (with that citation's places as context),
 * then in the books of `hints` (the other citations around it), then in every book; the first exact heading wins.
 * @param {string} text
 * @param {string} [before]   the citation before it
 * @param {string[]} [hints]  book codes cited nearby, most used first
 * @returns {Promise<{parsed, book: object|null, hit: {chapter, section, score}|null}>}
 */
export async function resolveCitation(text, before = "", hints = []) {
  const parsed = parseCitation(text);
  if ( parsed.code ) {
    const found = await bookByCode(parsed.code);
    if ( !found ) return { parsed, book: null, hit: null };
    const book = await loadBook(found);
    return { parsed, book, hit: findSection(book.chapters, parsed.segments) };
  }
  const prev = before ? parseCitation(before) : null;
  const codes = [...new Set([prev?.code, ...hints, ...(await libraryBooks()).map(b => b.code)].filter(Boolean).map(c => c.toLowerCase()))];
  const target = parsed.segments[parsed.segments.length - 1] ?? "";
  let fallback = null;
  for ( const code of codes ) {
    const found = await bookByCode(code);
    if ( !found ) continue;
    const book = await loadBook(found);
    const segments = prev && code === prev.code?.toLowerCase() ? [...prev.segments, ...parsed.segments] : parsed.segments;
    const hit = findSection(book.chapters, segments);
    if ( !hit ) continue;
    const ch = book.chapters[hit.chapter];
    const heading = hit.section < 0 ? ch.name : ch.sections[hit.section].text;
    const result = { parsed: { ...parsed, code: book.code, segments }, book, hit };
    if ( placeScore(heading, target) >= 60 ) return result;
    fallback ??= result;
  }
  return fallback ?? { parsed, book: null, hit: null };
}

/**
 * Book citation chips under `root` open the Library when the GM clicks them.
 * A chip with no book ("› M3") uses the citation before it in the same view.
 */
export function wireCitations(root) {
  if ( !game.user.isGM || !root || root.dataset.codexCites ) return;
  root.dataset.codexCites = "1";
  root.classList.add("codex-cites-live");
  root.addEventListener("click", ev => {
    const cite = ev.target.closest?.("cite.codex-cite");
    if ( !cite || !root.contains(cite) ) return;
    ev.preventDefault();
    ev.stopPropagation();
    const all = Array.from(root.querySelectorAll("cite.codex-cite")).map(c => c.textContent.trim());
    const i = all.indexOf(cite.textContent.trim());
    const before = all.slice(0, i).reverse().find(c => !/^›/.test(c)) ?? "";
    openLibrary({ cite: cite.textContent.trim(), before, hints: bookHints(all) });
  });
}

/** The book codes cited in a view, the most cited first. */
export function bookHints(citations) {
  const count = new Map();
  for ( const c of citations ) {
    const code = parseCitation(c).code;
    if ( code ) count.set(code, (count.get(code) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

export function initLibrary() {
  game.keybindings.register(MODULE_ID, "library", {
    name: "PLANARCODEX.Keybindings.Library",
    hint: "PLANARCODEX.Keybindings.LibraryHint",
    editable: [{ key: "KeyB", modifiers: ["Alt"] }],
    restricted: true,
    onDown: () => { openLibrary(); return true; }
  });
}

/** The Library part of the Codex API: game.modules.get("planar-codex").api.library */
export const libraryApi = {
  open: options => openLibrary(options),
  importBooks: () => openImporter(),
  resolve: (cite, before, hints) => resolveCitation(cite, before, hints),
  books: () => libraryBooks(),
  pack: () => libraryPack()
};
