/**
 * Planar Codex — Library: the books, kept in a GM-only world compendium (one journal entry per book, one page per chapter).
 *
 * Nothing of a book is shipped with the module: the GM imports the Markdown files he owns, into his own world.
 */
import { MODULE_ID, renderMarkdown } from "../codex.mjs";
import { bookFiles, chapterName, codeForFolder, parseBookIndex, batchBySize, sectionsOf } from "./core.mjs";

export const PACK_NAME = "planar-codex-library";
const GM_ONLY = { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" };

/** The Library compendium, if it exists. */
export function libraryPack() {
  return game.packs.get(`world.${PACK_NAME}`)
    ?? game.packs.find(p => p.metadata?.name === PACK_NAME && p.metadata?.packageType === "world") ?? null;
}

/** Create the compendium on first use (GM only), visible to GMs and Assistant GMs only. */
async function ensurePack(label) {
  let pack = libraryPack();
  if ( !pack ) {
    const CC = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
    pack = await CC.createCompendium({ name: PACK_NAME, label, type: "JournalEntry", ownership: GM_ONLY });
  }
  try {
    if ( pack.locked || pack.ownership?.PLAYER !== "NONE" || pack.ownership?.TRUSTED !== "NONE" ) {
      await pack.configure({ locked: false, ownership: { ...pack.ownership, ...GM_ONLY } });
    }
  } catch(err) { console.warn(`${MODULE_ID} | library: could not configure the compendium`, err); }
  return pack;
}

/* -------------------------------------------- */
/*  Reading a books folder in the browser       */
/* -------------------------------------------- */

/**
 * The books in a folder picked in the browser: each subfolder with Markdown files is a book.
 * An index note at the top (a table with "code" and "book" columns) gives the books' codes.
 * @param {File[]} files
 * @returns {Promise<{root: string, books: {folder, code, files: {path, name, file}[]}[]}>}
 */
export async function readBooksFolder(files) {
  const rel = f => (f.webkitRelativePath || f.name).replace(/\\/g, "/");
  const root = rel(files[0] ?? { name: "" }).split("/")[0] ?? "";
  const strip = p => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p);
  let index = [];
  const byFolder = new Map();
  for ( const f of files ) {
    const path = strip(rel(f));
    const parts = path.split("/");
    if ( parts.length === 1 && /\.md$/i.test(path) ) {
      const found = parseBookIndex(await f.text());
      if ( found.length ) index = found;
      continue;
    }
    if ( parts.length !== 2 || parts[0].startsWith("_") || parts[0].startsWith(".") ) continue;
    if ( !byFolder.has(parts[0]) ) byFolder.set(parts[0], new Map());
    byFolder.get(parts[0]).set(parts[1], f);
  }
  const books = [];
  for ( const [folder, map] of byFolder ) {
    const names = bookFiles([...map.keys()]);
    if ( !names.length ) continue;
    books.push({ folder, code: codeForFolder(folder, index), files: names.map(n => ({ path: `${folder}/${n}`, name: n, file: map.get(n) })) });
  }
  books.sort((a, b) => a.folder.localeCompare(b.folder));
  return { root, books };
}

/* -------------------------------------------- */
/*  Import                                      */
/* -------------------------------------------- */

/**
 * Import books into the Library, replacing earlier imports of the same books.
 * @param {{folder, code, files}[]} books
 * @param {{label: string, progress?: (text: string) => void}} options
 * @returns {Promise<{books: number, chapters: number}>}
 */
export async function importBooks(books, { label, progress = () => {} }) {
  const pack = await ensurePack(label);
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.library`] });
  let chapters = 0;
  for ( const book of books ) {
    progress(`${book.code} · ${book.folder}`);
    const old = index.filter(e => e.flags?.[MODULE_ID]?.library?.code === book.code || e.name === book.folder).map(e => e._id);
    if ( old.length ) await JournalEntry.implementation.deleteDocuments(old, { pack: pack.collection });
    const entry = await JournalEntry.implementation.create({
      name: book.folder,
      flags: { [MODULE_ID]: { library: { code: book.code, book: book.folder, chapters: book.files.length, importedAt: Date.now() } } }
    }, { pack: pack.collection });
    const pages = [];
    for ( const [i, f] of book.files.entries() ) {
      const markdown = await f.file.text();
      pages.push({
        size: markdown.length * 2,
        data: {
          name: chapterName(f.name), type: "text", sort: (i + 1) * 100,
          text: { format: 2, markdown, content: renderMarkdown(markdown) },
          flags: { [MODULE_ID]: { library: { file: f.name, order: i } } }
        }
      });
    }
    for ( const batch of batchBySize(pages) ) {
      await entry.createEmbeddedDocuments("JournalEntryPage", batch.map(p => p.data));
      chapters += batch.length;
      progress(`${book.code} · ${chapters}`);
    }
  }
  clearCache();
  return { books: books.length, chapters };
}

/* -------------------------------------------- */
/*  Loading for reading and search              */
/* -------------------------------------------- */

const cache = new Map();
let indexCache = null;
export function clearCache() { cache.clear(); indexCache = null; }

/** The books in the Library: [{id, code, name, chapters}]. */
export async function libraryBooks() {
  const pack = libraryPack();
  if ( !pack ) return [];
  if ( indexCache ) return indexCache;
  const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.library`] });
  indexCache = index.map(e => ({ id: e._id, code: e.flags?.[MODULE_ID]?.library?.code ?? e.name, name: e.name, chapters: e.flags?.[MODULE_ID]?.library?.chapters ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return indexCache;
}

/** A book by its code (any case), or null. */
export async function bookByCode(code) {
  const books = await libraryBooks();
  const c = String(code ?? "").toLowerCase();
  return books.find(b => b.code.toLowerCase() === c) ?? null;
}

/**
 * A book's chapters, loaded and split into sections: [{name, markdown, sections, page}]. Cached per book.
 * @param {{id, code, name}} book
 */
export async function loadBook(book) {
  if ( cache.has(book.id) ) return cache.get(book.id);
  const pack = libraryPack();
  const entry = await pack?.getDocument(book.id);
  const chapters = (entry?.pages.contents ?? []).sort((a, b) => a.sort - b.sort).map(page => {
    const markdown = page.text?.markdown ?? "";
    return { name: page.name, markdown, sections: sectionsOf(markdown), page };
  });
  const loaded = { ...book, chapters };
  cache.set(book.id, loaded);
  return loaded;
}
