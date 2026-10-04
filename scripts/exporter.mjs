/**
 * Planar Codex — export notes back to Markdown files for the vault (zip download, or straight into a folder
 * when the browser allows it).
 */
import { MODULE_ID, localize, getMarkdown, isEditedSinceSync, codexPageOf } from "./codex.mjs";
import { linkIndex } from "./link-index.mjs";
import { toVaultMarkdown } from "./vault.mjs";
import { buildZip } from "./zip.mjs";
import { contentHash, escapeHTML } from "./markdown.mjs";

const { ApplicationV2 } = foundry.applications.api;

const PREFIX_FOR = { Actor: "actor", Item: "item", Scene: "scene", RollTable: "table", Playlist: "playlist", Macro: "macro", JournalEntry: "journal" };

/** Describe a world UUID for toVaultMarkdown: Codex notes become [[Note]], other documents [[prefix:Name]]. */
function describeUuid(uuid, hash) {
  let doc = null;
  try { doc = fromUuidSync(uuid); } catch(err) { return null; }
  if ( !doc ) return null;
  const page = doc.documentName === "JournalEntry" ? codexPageOf(doc) : (doc.documentName === "JournalEntryPage" ? doc : null);
  if ( page && codexPageOf(page) ) {
    let heading = null;
    if ( hash ) heading = Object.values(page.toc ?? {}).find(t => t.slug === hash)?.text ?? null;
    return { kind: "note", name: page.parent.name, heading };
  }
  if ( doc.documentName === "Item" && doc.parent ) return null;   // embedded items: keep the UUID
  let prefix = PREFIX_FOR[doc.documentName];
  if ( doc.documentName === "Item" && doc.type === "spell" ) prefix = "spell";
  if ( !prefix ) return null;
  return { kind: "doc", name: doc.name, prefix };
}

/** Collect exportable notes. */
export function collectNotes({ onlyChanged = true } = {}) {
  const notes = [];
  for ( const entry of linkIndex.index.entries ) {
    const page = entry.page;
    if ( onlyChanged && !isEditedSinceSync(page) ) continue;
    notes.push({ page, path: entry.path, markdown: toVaultMarkdown(getMarkdown(page), describeUuid) });
  }
  return notes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Mark notes as in sync with the vault (after the user saved the export over it). */
export async function markSynced(notes) {
  for ( const n of notes ) {
    const updates = { [`flags.${MODULE_ID}.importHash`]: contentHash(getMarkdown(n.page)) };
    if ( !n.page.getFlag(MODULE_ID, "path") ) updates[`flags.${MODULE_ID}.path`] = n.path;
    await n.page.update(updates);
  }
}

function download(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function writeToDirectory(notes) {
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  for ( const n of notes ) {
    const parts = n.path.split("/");
    let handle = dir;
    for ( const p of parts.slice(0, -1) ) handle = await handle.getDirectoryHandle(p, { create: true });
    const file = await handle.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await file.createWritable();
    await w.write(n.markdown);
    await w.close();
  }
}

export class CodexExporter extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-codex-exporter",
    classes: ["planar-codex", "codex-exporter"],
    window: { title: "PLANARCODEX.Export.Title", icon: "fa-solid fa-file-export", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      zip: CodexExporter.#onZip,
      folder: CodexExporter.#onFolder,
      refresh: CodexExporter.#onRefresh
    }
  };

  onlyChanged = true;

  async _renderHTML() {
    const notes = collectNotes({ onlyChanged: this.onlyChanged });
    const canWrite = typeof window.showDirectoryPicker === "function";
    const list = notes.length
      ? `<ul class="codex-export-list">${notes.map(n => `<li>${escapeHTML(n.path)}</li>`).join("")}</ul>`
      : `<p class="hint">${localize("Export.Nothing")}</p>`;
    return `
      <form autocomplete="off">
        <p class="hint">${localize("Export.Intro")}</p>
        <label class="checkbox"><input type="checkbox" name="onlyChanged" data-action="refresh" ${this.onlyChanged ? "checked" : ""}> ${localize("Export.OnlyChanged")}</label>
        <label class="checkbox"><input type="checkbox" name="markSynced" checked> ${localize("Export.MarkSynced")}</label>
        <h4>${localize("Export.Notes", { count: notes.length })}</h4>
        ${list}
        <footer class="form-footer">
          <button type="button" data-action="zip" ${notes.length ? "" : "disabled"}><i class="fa-solid fa-file-zipper"></i> ${localize("Export.Zip")}</button>
          ${canWrite ? `<button type="button" data-action="folder" ${notes.length ? "" : "disabled"}><i class="fa-solid fa-folder-open"></i> ${localize("Export.Folder")}</button>` : ""}
        </footer>
        ${canWrite ? "" : `<p class="hint">${localize("Export.NoFolderAccess")}</p>`}
      </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static #onRefresh(event, target) {
    this.onlyChanged = target.checked;
    this.render();
  }

  #markSynced() {
    return this.element.querySelector("input[name=markSynced]")?.checked;
  }

  static async #onZip() {
    const notes = collectNotes({ onlyChanged: this.onlyChanged });
    if ( !notes.length ) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    download(buildZip(notes.map(n => ({ path: n.path, data: n.markdown }))), `codex-export-${stamp}.zip`);
    if ( this.#markSynced() ) await markSynced(notes);
    ui.notifications.info(localize("Export.Done", { count: notes.length }));
    this.render();
  }

  static async #onFolder() {
    const notes = collectNotes({ onlyChanged: this.onlyChanged });
    if ( !notes.length ) return;
    try {
      await writeToDirectory(notes);
    } catch(err) {
      if ( err?.name !== "AbortError" ) ui.notifications.error(err.message);
      return;
    }
    if ( this.#markSynced() ) await markSynced(notes);
    ui.notifications.info(localize("Export.Done", { count: notes.length }));
    this.render();
  }
}
