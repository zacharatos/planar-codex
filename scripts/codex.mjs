/**
 * Planar Codex — Foundry-side helpers shared by the sheet, enricher, importer and exporter.
 */
import { convertMarkdown, splitFrontmatter, fmList, contentHash, MARKED_OPTIONS } from "./markdown.mjs";
import { Marked } from "../lib/marked.esm.js";

const engine = new Marked(MARKED_OPTIONS);
const render = md => engine.parse(md);
const lexer = md => engine.lexer(md);
const parser = tokens => engine.parser(tokens);

export const MODULE_ID = "planar-codex";
export const SHEET_CLASS = `${MODULE_ID}.CodexMarkdownSheet`;
export const FORMAT_MARKDOWN = 2;

/** Is this page one of ours (imported, or switched to the Codex sheet)? */
export function isCodexPage(page) {
  if ( !page || page.documentName !== "JournalEntryPage" || page.type !== "text" ) return false;
  return page.getFlag("core", "sheetClass") === SHEET_CLASS || !!page.getFlag(MODULE_ID, "path");
}

/** The first Codex page of a journal entry, if any. */
export function codexPageOf(entry) {
  if ( !entry ) return null;
  if ( entry.documentName === "JournalEntryPage" ) return isCodexPage(entry) ? entry : null;
  return entry.pages?.find(p => isCodexPage(p)) ?? null;
}

export function getMarkdown(page) {
  return page?.text?.markdown ?? "";
}

/** Secret ids currently revealed in the stored HTML (Foundry toggles them in `text.content`). */
export function revealedSecrets(page) {
  const html = page?.text?.content ?? "";
  const set = new Set();
  for ( const m of html.matchAll(/<section\b[^>]*>/gi) ) {
    const tag = m[0];
    if ( !/class="[^"]*\bsecret\b[^"]*\brevealed\b/.test(tag) ) continue;
    const id = tag.match(/id="([^"]+)"/);
    if ( id ) set.add(id[1]);
  }
  return set;
}

/** Build a detached container holding an HTML string. */
export function parseFragment(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

/** World setting: map from lower-cased file name / vault path to the uploaded URL. */
export function resolveAsset(name) {
  const map = game.settings.get(MODULE_ID, "assetMap") ?? {};
  const key = String(name).replace(/\\/g, "/").toLowerCase();
  return map[key] ?? map[key.split("/").pop()] ?? null;
}

/**
 * Convert Markdown for a page. GM view includes DM-only material; player view is what we store.
 * @param {string} markdown
 * @param {object} [options]
 * @param {boolean} [options.gm=false]
 * @param {JournalEntryPage} [options.page]   Used for stable secret ids and to keep revealed secrets revealed.
 * @param {boolean} [options.lines=false]      Tag blocks with their source line (for editing in place).
 */
export function convert(markdown, { gm = false, page = null, path = null, lines = false } = {}) {
  return convertMarkdown(markdown, {
    render,
    ...(lines ? { lexer, parser } : {}),
    parseFragment,
    gm,
    resolveAsset,
    revealed: page ? revealedSecrets(page) : new Set(),
    notePath: path ?? page?.getFlag(MODULE_ID, "path") ?? page?.uuid ?? ""
  });
}

/** Flags derived from a note's frontmatter, kept on the page for indexing. */
export function frontmatterFlags(markdown) {
  const { data } = splitFrontmatter(markdown);
  return {
    aliases: fmList(data, "aliases"),
    tags: fmList(data, "tags"),
    type: data.type ? String(data.type) : null,
    actor: data.actor ? String(data.actor) : null,
    player: fmList(data, "player")
  };
}

/** The full update object for new Markdown on a page (Markdown, stored player HTML, index flags). */
export function markdownUpdate(page, markdown) {
  const { html } = convert(markdown, { gm: false, page });
  return {
    "text.markdown": markdown,
    "text.content": html,
    "text.format": FORMAT_MARKDOWN,
    [`flags.${MODULE_ID}.meta`]: frontmatterFlags(markdown)
  };
}

export async function updateMarkdown(page, markdown) {
  return page.update(markdownUpdate(page, markdown));
}

/** Has the page been edited in Foundry since it was imported or last exported? */
export function isEditedSinceSync(page) {
  const h = page.getFlag(MODULE_ID, "importHash");
  return !h || contentHash(getMarkdown(page)) !== h;
}

export function localize(key, data) {
  const k = `PLANARCODEX.${key}`;
  return data ? game.i18n.format(k, data) : game.i18n.localize(k);
}

/** Folder names from the Codex root down to a document's folder (root excluded). */
export function folderTrail(doc, rootId = null) {
  const names = [];
  let f = doc.folder;
  while ( f && f.id !== rootId ) { names.unshift(f.name); f = f.folder; }
  return names;
}
