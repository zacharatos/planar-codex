/**
 * Planar Codex — creating notes and the Codex root folder.
 */
import { MODULE_ID, SHEET_CLASS, FORMAT_MARKDOWN, convert, frontmatterFlags, localize } from "./codex.mjs";
import { contentHash } from "./markdown.mjs";

/** The Codex root journal folder, created on first use. */
export async function ensureRootFolder(name = null) {
  const id = game.settings.get(MODULE_ID, "rootFolder");
  const existing = id ? game.folders.get(id) : null;
  if ( existing ) return existing;
  const folderName = name || game.settings.get(MODULE_ID, "rootFolderName") || "Codex";
  const found = game.folders.find(f => f.type === "JournalEntry" && !f.folder && f.name === folderName);
  const folder = found ?? await Folder.create({ name: folderName, type: "JournalEntry", sorting: "a", color: "#3b2a4d" });
  await game.settings.set(MODULE_ID, "rootFolder", folder.id);
  return folder;
}

/** Data for a Codex text page. */
export function pageData({ name, markdown, path = null, importHash = null, showTitle = false }) {
  const { html } = convert(markdown, { gm: false, path });
  const flags = { meta: frontmatterFlags(markdown) };
  if ( path ) flags.path = path;
  if ( importHash ) { flags.importHash = importHash; flags.importedAt = Date.now(); }
  return {
    name,
    type: "text",
    title: { show: showTitle, level: 1 },
    text: { format: FORMAT_MARKDOWN, markdown, content: html },
    flags: { core: { sheetClass: SHEET_CLASS }, [MODULE_ID]: flags }
  };
}

/**
 * Create a new note (journal entry with one Codex page).
 * @returns {Promise<JournalEntryPage>}
 */
export async function createCodexNote({ name, folder = null, markdown = null } = {}) {
  const root = folder ?? (await ensureRootFolder()).id;
  const md = markdown ?? `# ${name}\n\n`;
  const entry = await JournalEntry.create({
    name,
    folder: root,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    pages: [pageData({ name, markdown: md })]
  });
  ui.notifications.info(localize("Note.Created", { name }));
  return entry.pages.contents[0];
}

export { contentHash };
