/**
 * Planar Codex — pure vault planning (what to import, where it goes) and export helpers.
 */
import { splitFrontmatter, fmList, contentHash, basename, dirname, extractLinks, isAssetTarget, normalizeKey } from "./markdown.mjs";

/** Folders skipped by default: tooling, generated sources, sync and editor state. */
export const DEFAULT_EXCLUDES = [
  ".obsidian", ".trash", ".git", ".stfolder", "#SyncVersion", "#recycle", "@eaDir",
  "Sources", "Tools", "Claude outputs", "node_modules"
];

/** Root files skipped by default (operating guides, not campaign notes). */
export const DEFAULT_EXCLUDED_FILES = ["CLAUDE.md", "AGENTS.md", "README.md"];

/**
 * Strip the vault's own folder name from browser `webkitRelativePath` values.
 * "Multiverse Adventures/Prep/Chapter 01.md" → "Prep/Chapter 01.md"
 */
export function stripRoot(paths) {
  const firsts = new Set(paths.map(p => p.replace(/\\/g, "/").split("/")[0]));
  if ( firsts.size === 1 && paths.every(p => p.replace(/\\/g, "/").includes("/")) ) {
    const root = [...firsts][0];
    return { root, paths: paths.map(p => p.replace(/\\/g, "/").slice(root.length + 1)) };
  }
  return { root: "", paths: paths.map(p => p.replace(/\\/g, "/")) };
}

/** Is a path excluded by a folder list (any path segment, or a top-level folder name)? */
export function isExcluded(path, excludes) {
  const parts = path.split("/");
  const segments = parts.slice(0, -1);
  if ( segments.some(s => s.startsWith(".")) ) return true;
  if ( parts[parts.length - 1].startsWith(".") ) return true;
  return segments.some(s => excludes.includes(s)) || excludes.includes(segments.join("/"));
}

/** Top-level folders in a file list with Markdown counts, for the import dialog. */
export function summarizeFolders(paths) {
  const map = new Map();
  for ( const p of paths ) {
    if ( !/\.md$/i.test(p) ) continue;
    const parts = p.split("/");
    const top = parts.length > 1 ? parts[0] : "";
    map.set(top, (map.get(top) ?? 0) + 1);
  }
  return [...map.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => a.folder.localeCompare(b.folder));
}

/**
 * Turn vault files into an import plan.
 * @param {Array<{path: string, text: string}>} mdFiles   Markdown files (vault-relative path + content).
 * @param {object} [options]
 * @param {string[]} [options.excludes]       Folder names to skip.
 * @param {string[]} [options.excludedFiles]  Root file names to skip.
 * @returns {{notes: object[], skipped: object[], folders: string[], assetRefs: Map<string, string[]>}}
 */
export function planImport(mdFiles, { excludes = DEFAULT_EXCLUDES, excludedFiles = DEFAULT_EXCLUDED_FILES } = {}) {
  const notes = [];
  const skipped = [];
  const folders = new Set();
  const assetRefs = new Map();
  for ( const f of mdFiles ) {
    const path = f.path.replace(/\\/g, "/");
    if ( isExcluded(path, excludes) ) { skipped.push({ path, reason: "excluded folder" }); continue; }
    if ( !path.includes("/") && excludedFiles.includes(path) ) { skipped.push({ path, reason: "excluded file" }); continue; }
    const text = String(f.text ?? "").replace(/\r\n?/g, "\n");
    if ( !text.trim() ) { skipped.push({ path, reason: "empty note" }); continue; }
    const { data } = splitFrontmatter(text);
    if ( data["codex-import"] === false || data.codex === false ) { skipped.push({ path, reason: "codex-import: false" }); continue; }
    const folder = dirname(path);
    if ( folder ) {
      const parts = folder.split("/");
      for ( let i = 1; i <= parts.length; i++ ) folders.add(parts.slice(0, i).join("/"));
    }
    for ( const link of extractLinks(text) ) {
      if ( link.embed && isAssetTarget(link.target) ) {
        const list = assetRefs.get(link.target) ?? [];
        list.push(path);
        assetRefs.set(link.target, list);
      }
    }
    notes.push({
      path,
      name: basename(path),
      folder,
      markdown: text,
      hash: contentHash(text),
      frontmatter: data,
      aliases: fmList(data, "aliases"),
      tags: fmList(data, "tags"),
      type: data.type ? String(data.type) : null,
      visibility: data.visibility ? String(data.visibility) : null,
      startsWithTitle: /^\s*#\s+/.test(splitFrontmatter(text).body)
    });
  }
  return { notes, skipped, folders: [...folders].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)), assetRefs };
}

/**
 * Decide what happens to each planned note given what is already in the world.
 * @param {object[]} notes                          From planImport.
 * @param {Map<string, {markdown: string, importHash: string}>} existing  Keyed by normalised vault path.
 * @param {"keep"|"vault"|"both"} onConflict
 * @returns {Array<{note: object, action: "create"|"update"|"skip"|"conflict-keep"|"conflict-vault"|"conflict-both", reason: string}>}
 */
export function diffImport(notes, existing, onConflict = "keep") {
  return notes.map(note => {
    const ex = existing.get(normalizeKey(note.path));
    if ( !ex ) return { note, action: "create", reason: "new note" };
    const foundryHash = contentHash(ex.markdown ?? "");
    const vaultChanged = note.hash !== ex.importHash;
    const foundryEdited = foundryHash !== ex.importHash;
    if ( !vaultChanged && !foundryEdited ) return { note, action: "skip", reason: "unchanged" };
    if ( !vaultChanged && foundryEdited ) return { note, action: "skip", reason: "edited in Foundry (export to update the vault)" };
    if ( note.hash === foundryHash ) return { note, action: "skip", reason: "same text in both" };
    if ( vaultChanged && !foundryEdited ) return { note, action: "update", reason: "changed in the vault" };
    return { note, action: `conflict-${onConflict}`, reason: "changed in both the vault and Foundry" };
  });
}

/**
 * Convert Foundry-only syntax in a page's Markdown back to vault-portable syntax.
 * World document links become typed wikilinks; links to Codex notes become plain wikilinks.
 * @param {string} markdown
 * @param {(uuid: string, hash: string|null) => (null|{kind: "note"|"doc", name: string, prefix?: string, heading?: string})} describe
 */
export function toVaultMarkdown(markdown, describe) {
  return String(markdown).replace(/@UUID\[([^\]#]+)(?:#([^\]]+))?\](?:\{([^}]*)\})?/g, (full, uuid, hash, label) => {
    if ( uuid.startsWith("Compendium.") ) return full;
    const d = describe(uuid, hash ?? null);
    if ( !d ) return full;
    const lbl = label && label !== d.name ? `|${label}` : "";
    if ( d.kind === "note" ) return `[[${d.name}${d.heading ? `#${d.heading}` : ""}${lbl}]]`;
    return `[[${d.prefix}:${d.name}${lbl}]]`;
  });
}

/** The vault path for a page that has no recorded path (a note created inside Foundry). */
export function pathForNewNote(folderNames, pageName) {
  const safe = s => String(s).replace(/[\\/:*?"<>|]/g, "-").trim();
  return [...folderNames.map(safe), `${safe(pageName)}.md`].join("/");
}
