/**
 * Planar Codex — vault importer (one-off, re-runnable for new or changed notes).
 */
import { MODULE_ID, localize, getMarkdown } from "./codex.mjs";
import { ensureRootFolder, pageData } from "./notes.mjs";
import { planImport, diffImport, stripRoot, summarizeFolders, DEFAULT_EXCLUDES, DEFAULT_EXCLUDED_FILES } from "./vault.mjs";
import { linkReport } from "./resolver.mjs";
import { normalizeKey, basename, escapeHTML, IMAGE_EXTENSIONS, contentHash } from "./markdown.mjs";
import { linkIndex } from "./link-index.mjs";

const { ApplicationV2 } = foundry.applications.api;

export class CodexImporter extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "planar-codex-importer",
    classes: ["planar-codex", "codex-importer"],
    window: { title: "PLANARCODEX.Import.Title", icon: "fa-solid fa-file-import", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      pick: CodexImporter.#onPick,
      run: CodexImporter.#onRun
    }
  };

  /** @type {{root: string, md: Array<{path: string, file: File}>, assets: Map<string, File>}|null} */
  vault = null;
  busy = false;
  status = "";

  async _renderHTML() {
    const excludes = game.settings.get(MODULE_ID, "lastExcludes") ?? DEFAULT_EXCLUDES;
    const conflict = game.settings.get(MODULE_ID, "lastConflict") ?? "keep";
    const rootName = game.settings.get(MODULE_ID, "rootFolderName") || "Codex";
    let folders = "";
    if ( this.vault ) {
      const summary = summarizeFolders(this.vault.md.map(f => f.path));
      folders = summary.map(({ folder, count }) => {
        const label = folder || localize("Import.RootFiles");
        const checked = folder === "" ? "checked" : (excludes.includes(folder) ? "" : "checked");
        return `<label class="codex-folder"><input type="checkbox" name="folder" value="${escapeHTML(folder)}" ${checked}> ${escapeHTML(label)} <span class="count">${count}</span></label>`;
      }).join("");
    }
    const radio = (v, label) => `<label><input type="radio" name="conflict" value="${v}" ${conflict === v ? "checked" : ""}> ${label}</label>`;
    return `
      <form class="codex-import-form" autocomplete="off">
        <p class="hint">${localize("Import.Intro")}</p>
        <div class="form-group">
          <button type="button" data-action="pick"><i class="fa-solid fa-folder-open"></i> ${localize("Import.Pick")}</button>
          <span class="codex-vault-name">${this.vault ? `<strong>${escapeHTML(this.vault.root || "vault")}</strong> · ${this.vault.md.length} notes · ${this.vault.assets.size} files` : localize("Import.NoVault")}</span>
          <input type="file" name="vault" webkitdirectory directory multiple hidden>
        </div>
        ${this.vault ? `
        <fieldset><legend>${localize("Import.Folders")}</legend><div class="codex-folders">${folders}</div>
          <p class="hint">${localize("Import.FoldersHint")}</p></fieldset>
        <div class="form-group"><label>${localize("Import.RootFolder")}</label><input type="text" name="rootName" value="${escapeHTML(rootName)}"></div>
        <fieldset><legend>${localize("Import.Conflicts")}</legend>
          ${radio("keep", localize("Import.ConflictKeep"))}
          ${radio("vault", localize("Import.ConflictVault"))}
          ${radio("both", localize("Import.ConflictBoth"))}
        </fieldset>
        <footer class="form-footer"><button type="button" data-action="run" ${this.busy ? "disabled" : ""}><i class="fa-solid fa-file-import"></i> ${localize("Import.Run")}</button></footer>` : ""}
        <p class="codex-status">${escapeHTML(this.status)}</p>
      </form>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const input = content.querySelector("input[name=vault]");
    input?.addEventListener("change", ev => this.#readVault(ev.target.files));
  }

  static #onPick() {
    this.element.querySelector("input[name=vault]")?.click();
  }

  async #readVault(fileList) {
    const files = Array.from(fileList ?? []);
    if ( !files.length ) return;
    const { root, paths } = stripRoot(files.map(f => f.webkitRelativePath || f.name));
    const md = [];
    const assets = new Map();
    files.forEach((file, i) => {
      const path = paths[i];
      const ext = path.split(".").pop().toLowerCase();
      if ( ext === "md" ) md.push({ path, file });
      else if ( IMAGE_EXTENSIONS.includes(ext) || ["pdf", "mp3", "ogg", "webm", "mp4", "m4a", "wav"].includes(ext) ) {
        assets.set(path.toLowerCase(), file);
        if ( !assets.has(basename(path).toLowerCase()) ) assets.set(basename(path).toLowerCase(), file);
      }
    });
    this.vault = { root, md, assets };
    this.status = "";
    this.render();
  }

  static async #onRun() {
    if ( this.busy || !this.vault ) return;
    const form = this.element.querySelector("form");
    const included = new Set(Array.from(form.querySelectorAll("input[name=folder]:checked")).map(i => i.value));
    const allFolders = Array.from(form.querySelectorAll("input[name=folder]")).map(i => i.value);
    const unchecked = allFolders.filter(f => f && !included.has(f));
    const checked = allFolders.filter(f => f && included.has(f));
    const excludes = [...new Set([...DEFAULT_EXCLUDES.filter(f => !checked.includes(f)), ...unchecked])];
    const excludedFiles = included.has("") ? DEFAULT_EXCLUDED_FILES : this.vault.md.filter(f => !f.path.includes("/")).map(f => f.path);
    const onConflict = form.querySelector("input[name=conflict]:checked")?.value ?? "keep";
    const rootName = form.querySelector("input[name=rootName]")?.value?.trim() || "Codex";
    await game.settings.set(MODULE_ID, "lastExcludes", unchecked);
    await game.settings.set(MODULE_ID, "lastConflict", onConflict);
    if ( rootName !== game.settings.get(MODULE_ID, "rootFolderName") ) {
      await game.settings.set(MODULE_ID, "rootFolderName", rootName);
      await game.settings.set(MODULE_ID, "rootFolder", "");
    }
    this.busy = true;
    this.status = localize("Import.Reading");
    this.render();
    try {
      const report = await importVault(this.vault, { excludes, excludedFiles, onConflict, progress: s => { this.status = s; this.render(); } });
      this.status = localize("Import.Done");
      new CodexImportReport(report).render({ force: true });
    } catch(err) {
      console.error(`${MODULE_ID} | import failed`, err);
      this.status = `${localize("Import.Failed")}: ${err.message}`;
      ui.notifications.error(this.status);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

/**
 * Import a vault that was read in the browser.
 * @param {{md: Array<{path: string, file: File}>, assets: Map<string, File>}} vault
 */
export async function importVault(vault, { excludes, excludedFiles, onConflict = "keep", progress = () => {} } = {}) {
  const texts = await Promise.all(vault.md.map(async f => ({ path: f.path, text: await f.file.text() })));
  const plan = planImport(texts, { excludes, excludedFiles });

  // What is already in the world, keyed by vault path.
  const existing = new Map();
  for ( const entry of game.journal ) {
    for ( const page of entry.pages ) {
      const path = page.getFlag(MODULE_ID, "path");
      if ( path ) existing.set(normalizeKey(path), { page, markdown: getMarkdown(page), importHash: page.getFlag(MODULE_ID, "importHash") });
    }
  }
  const decisions = diffImport(plan.notes, existing, onConflict);

  // Upload embedded files first, so the stored HTML points at them.
  progress(localize("Import.Uploading"));
  const uploaded = await uploadAssets(plan.assetRefs, vault.assets);

  // Folders.
  progress(localize("Import.Folders"));
  const root = await ensureRootFolder();
  const folderIds = new Map([["", root.id]]);
  for ( const path of plan.folders ) {
    const parentPath = path.split("/").slice(0, -1).join("/");
    const parent = folderIds.get(parentPath) ?? root.id;
    const name = path.split("/").pop();
    const depth = path.split("/").length + 1;
    if ( depth > CONST.FOLDER_MAX_DEPTH ) { folderIds.set(path, parent); continue; }
    let folder = game.folders.find(f => f.type === "JournalEntry" && f.folder?.id === parent && f.name === name);
    folder ??= await Folder.create({ name, type: "JournalEntry", folder: parent, sorting: "a" });
    folderIds.set(path, folder.id);
  }

  // Create and update.
  const toCreate = [];
  const toUpdate = [];
  const counts = { create: 0, update: 0, skip: 0, conflictKept: 0, conflictVault: 0, conflictBoth: 0 };
  const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  const conflicts = [];
  for ( const d of decisions ) {
    const n = d.note;
    const visibility = (n.visibility ?? "").toLowerCase();
    const entryData = path => ({
      name: n.name,
      folder: folderIds.get(n.folder) ?? root.id,
      ownership: { default: ["players", "public", "all"].includes(visibility) ? OBSERVER : NONE },
      flags: { [MODULE_ID]: { path } },
      pages: [pageData({ name: n.name, markdown: n.markdown, path, importHash: n.hash, showTitle: !n.startsWithTitle })]
    });
    switch ( d.action ) {
      case "create": toCreate.push(entryData(n.path)); counts.create++; break;
      case "update":
      case "conflict-vault": {
        const page = existing.get(normalizeKey(n.path)).page;
        const data = pageData({ name: n.name, markdown: n.markdown, path: n.path, importHash: n.hash });
        toUpdate.push({ page, data });
        if ( d.action === "update" ) counts.update++; else { counts.conflictVault++; conflicts.push({ path: n.path, result: localize("Import.ConflictTookVault") }); }
        break;
      }
      case "conflict-both": {
        const copyPath = n.path.replace(/\.md$/i, " (vault).md");
        const copy = entryData(copyPath);
        copy.name = `${n.name} (vault)`;
        copy.pages[0].name = copy.name;
        toCreate.push(copy);
        counts.conflictBoth++;
        conflicts.push({ path: n.path, result: localize("Import.ConflictMadeCopy") });
        break;
      }
      case "conflict-keep":
        counts.conflictKept++;
        conflicts.push({ path: n.path, result: localize("Import.ConflictKeptFoundry") });
        break;
      default: counts.skip++;
    }
  }

  const batch = 40;
  for ( let i = 0; i < toCreate.length; i += batch ) {
    progress(localize("Import.Creating", { done: i, total: toCreate.length }));
    await JournalEntry.createDocuments(toCreate.slice(i, i + batch));
  }
  for ( const { page, data } of toUpdate ) {
    await page.update({ text: data.text, [`flags.${MODULE_ID}`]: data.flags[MODULE_ID] });
  }
  linkIndex.invalidate();

  // Link report over everything now in the world plus the vault notes.
  const all = new Map();
  for ( const entry of linkIndex.index.entries ) all.set(normalizeKey(entry.path), { path: entry.path, markdown: getMarkdown(entry.page), aliases: entry.aliases });
  const links = linkReport([...all.values()], { assetExists: t => uploaded.has(t.toLowerCase()) || uploaded.has(basename(t).toLowerCase()) });

  return {
    counts,
    notes: plan.notes.length,
    skipped: plan.skipped,
    conflicts,
    assets: { uploaded: uploaded.size, missing: links.missingAssets },
    links,
    decisions: decisions.map(d => ({ path: d.note.path, action: d.action, reason: d.reason }))
  };
}

/** Upload files embedded in notes to the world folder and record their URLs in the asset map. */
async function uploadAssets(assetRefs, files) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  const base = `worlds/${game.world.id}/planar-codex`;
  const map = foundry.utils.deepClone(game.settings.get(MODULE_ID, "assetMap") ?? {});
  const uploaded = new Map();
  const made = new Set();
  const mkdirs = async dir => {
    const parts = dir.split("/");
    for ( let i = 1; i <= parts.length; i++ ) {
      const d = parts.slice(0, i).join("/");
      if ( made.has(d) ) continue;
      try { await FilePicker.createDirectory("data", d); } catch(err) { /* already exists */ }
      made.add(d);
    }
  };
  for ( const target of assetRefs.keys() ) {
    const key = target.replace(/\\/g, "/").toLowerCase();
    const file = files.get(key) ?? files.get(basename(key));
    if ( !file ) continue;
    const rel = (file.webkitRelativePath || file.name).split("/").slice(1).join("/") || file.name;
    const dir = [base, ...rel.split("/").slice(0, -1)].join("/").replace(/[^\w\-./ ]/g, "_");
    await mkdirs(dir);
    const res = await FilePicker.upload("data", dir, file, {}, { notify: false });
    const url = res?.path;
    if ( !url ) continue;
    map[key] = url;
    map[basename(key)] = url;
    map[rel.toLowerCase()] = url;
    uploaded.set(key, url);
    uploaded.set(basename(key), url);
  }
  await game.settings.set(MODULE_ID, "assetMap", map);
  return uploaded;
}

/* -------------------------------------------- */
/*  Report                                      */
/* -------------------------------------------- */

export class CodexImportReport extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["planar-codex", "codex-report"],
    window: { title: "PLANARCODEX.Report.Title", icon: "fa-solid fa-clipboard-check", resizable: true },
    position: { width: 640, height: 640 }
  };

  constructor(report, options = {}) {
    super(options);
    this.report = report;
  }

  async _renderHTML() {
    const r = this.report;
    const li = (items, fn) => items.length ? `<ul>${items.map(fn).join("")}</ul>` : `<p class="hint">${localize("Report.None")}</p>`;
    const c = r.counts;
    return `
      <section class="codex-report-body">
        <h3>${localize("Report.Summary")}</h3>
        <table class="codex-report-counts">
          <tr><th>${localize("Report.Created")}</th><td>${c.create}</td></tr>
          <tr><th>${localize("Report.Updated")}</th><td>${c.update}</td></tr>
          <tr><th>${localize("Report.Unchanged")}</th><td>${c.skip}</td></tr>
          <tr><th>${localize("Report.Conflicts")}</th><td>${c.conflictKept + c.conflictVault + c.conflictBoth}</td></tr>
          <tr><th>${localize("Report.Files")}</th><td>${r.assets.uploaded}</td></tr>
          <tr><th>${localize("Report.Links")}</th><td>${r.links.resolved} / ${r.links.links} ${localize("Report.Resolved")} · ${r.links.typed} ${localize("Report.Typed")}</td></tr>
        </table>
        <h3>${localize("Report.Dangling")} (${r.links.dangling.length})</h3>
        ${li(r.links.dangling, d => `<li><strong>${escapeHTML(d.from)}</strong> line ${d.line}: [[${escapeHTML(d.target)}${d.heading ? `#${escapeHTML(d.heading)}` : ""}]]</li>`)}
        <h3>${localize("Report.Ambiguous")} (${r.links.ambiguous.length})</h3>
        ${li(r.links.ambiguous, d => `<li><strong>${escapeHTML(d.from)}</strong>: [[${escapeHTML(d.target)}]] → ${escapeHTML(d.chosen)} (${localize("Report.Also")}: ${d.others.map(escapeHTML).join(", ")})</li>`)}
        <h3>${localize("Report.MissingFiles")} (${r.assets.missing.length})</h3>
        ${li(r.assets.missing, d => `<li><strong>${escapeHTML(d.from)}</strong>: ${escapeHTML(d.target)}</li>`)}
        <h3>${localize("Report.ConflictList")} (${r.conflicts.length})</h3>
        ${li(r.conflicts, d => `<li><strong>${escapeHTML(d.path)}</strong>: ${escapeHTML(d.result)}</li>`)}
        <h3>${localize("Report.Skipped")} (${r.skipped.length})</h3>
        ${li(r.skipped, d => `<li>${escapeHTML(d.path)} <span class="hint">(${escapeHTML(d.reason)})</span></li>`)}
      </section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }
}

export { contentHash };
