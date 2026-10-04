/**
 * Planar Codex — entry point.
 * Import an Obsidian vault into Foundry as Markdown journal pages, then read, edit and run the campaign from them.
 */
import { MODULE_ID, localize, convert, isCodexPage } from "./codex.mjs";
import { CodexMarkdownSheet } from "./sheet.mjs";
import { registerEnrichers } from "./enricher.mjs";
import { linkIndex } from "./link-index.mjs";
import { registerSocket, showToPlayers, postToChat, whisperTo, shareWith } from "./actions.mjs";
import { CodexImporter, importVault } from "./importer.mjs";
import { CodexExporter, collectNotes } from "./exporter.mjs";
import { createCodexNote, ensureRootFolder } from "./notes.mjs";
import { editInPlace, editHereFromKeyboard } from "./inline-edit.mjs";
import * as markdown from "./markdown.mjs";
import * as vault from "./vault.mjs";

Hooks.once("init", () => {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  register("rootFolderName", {
    name: "PLANARCODEX.Settings.RootFolderName", hint: "PLANARCODEX.Settings.RootFolderNameHint",
    scope: "world", config: true, type: String, default: "Codex"
  });
  register("showBacklinks", {
    name: "PLANARCODEX.Settings.ShowBacklinks", hint: "PLANARCODEX.Settings.ShowBacklinksHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  register("autocomplete", {
    name: "PLANARCODEX.Settings.Autocomplete", hint: "PLANARCODEX.Settings.AutocompleteHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  register("fontSize", {
    name: "PLANARCODEX.Settings.FontSize", hint: "PLANARCODEX.Settings.FontSizeHint",
    scope: "client", config: true, type: Number, default: 15,
    choices: { 13: "13 px", 14: "14 px", 15: "15 px", 16: "16 px", 17: "17 px", 18: "18 px" },
    onChange: v => applyFontSize(v)
  });
  register("inlineEdit", {
    name: "PLANARCODEX.Settings.InlineEdit", hint: "PLANARCODEX.Settings.InlineEditHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  register("dblclickEdit", {
    name: "PLANARCODEX.Settings.DblclickEdit", hint: "PLANARCODEX.Settings.DblclickEditHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  register("citationPrefixes", {
    name: "PLANARCODEX.Settings.CitationPrefixes", hint: "PLANARCODEX.Settings.CitationPrefixesHint",
    scope: "world", config: true, type: String, default: markdown.DEFAULT_CITATION_PREFIXES.join(", "),
    onChange: v => markdown.setCitationPrefixes(v)
  });
  register("editorSource", { scope: "client", config: false, type: Boolean, default: false });
  register("contentVersion", { scope: "world", config: false, type: Number, default: 1 });
  register("rootFolder", { scope: "world", config: false, type: String, default: "" });
  register("assetMap", { scope: "world", config: false, type: Object, default: {} });
  register("lastExcludes", { scope: "client", config: false, type: Array, default: vault.DEFAULT_EXCLUDES });
  register("lastConflict", { scope: "client", config: false, type: String, default: "keep" });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CodexMarkdownSheet, {
    types: ["text"],
    makeDefault: false,
    label: "PLANARCODEX.SheetLabel"
  });

  registerEnrichers();

  game.keybindings.register(MODULE_ID, "editHere", {
    name: "PLANARCODEX.Keybindings.EditHere",
    hint: "PLANARCODEX.Keybindings.EditHereHint",
    editable: [{ key: "KeyE", modifiers: ["Control"] }],
    onDown: () => editHereFromKeyboard(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.modules.get(MODULE_ID).api = {
    linkIndex, convert, markdown, vault,
    importVault, collectNotes, createCodexNote, ensureRootFolder,
    showToPlayers, postToChat, whisperTo, shareWith, editInPlace,
    openImporter: () => new CodexImporter().render({ force: true }),
    openExporter: () => new CodexExporter().render({ force: true })
  };
});

Hooks.once("setup", () => {
  markdown.setCitationPrefixes(game.settings.get(MODULE_ID, "citationPrefixes"));
});

Hooks.once("ready", async () => {
  registerSocket();
  applyFontSize(game.settings.get(MODULE_ID, "fontSize"));
  if ( game.user === game.users.activeGM ) await refreshStoredContent();
});

function applyFontSize(px) {
  document.documentElement.style.setProperty("--codex-font-size", `${Number(px) || 15}px`);
}

/**
 * When a new module version renders notes differently, re-render the stored (player) HTML of every Codex note once.
 * Bump CONTENT_VERSION whenever convertMarkdown's output changes.
 */
const CONTENT_VERSION = 2;
async function refreshStoredContent() {
  if ( game.settings.get(MODULE_ID, "contentVersion") >= CONTENT_VERSION ) return;
  let count = 0;
  for ( const entry of game.journal ) {
    for ( const page of entry.pages ) {
      if ( !isCodexPage(page) ) continue;
      const { html } = convert(page.text?.markdown ?? "", { gm: false, page });
      if ( html !== page.text?.content ) {
        await page.update({ "text.content": html }, { diff: false });
        count++;
      }
    }
  }
  await game.settings.set(MODULE_ID, "contentVersion", CONTENT_VERSION);
  if ( count ) ui.notifications.info(localize("Rebuilt", { count }));
}

/* -------------------------------------------- */
/*  Keep the link index fresh                   */
/* -------------------------------------------- */

for ( const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry",
  "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage", "updateFolder"] ) {
  Hooks.on(hook, () => linkIndex.invalidate());
}

/* -------------------------------------------- */
/*  Journal directory buttons                   */
/* -------------------------------------------- */

Hooks.on("renderJournalDirectory", (app, html) => {
  if ( !game.user.isGM ) return;
  const element = html instanceof HTMLElement ? html : html?.[0];
  if ( !element || element.querySelector(".planar-codex-actions") ) return;
  const bar = document.createElement("div");
  bar.className = "planar-codex-actions";
  const button = (icon, label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = `<i class="${icon}"></i> ${label}`;
    b.addEventListener("click", ev => { ev.preventDefault(); fn(); });
    bar.append(b);
  };
  button("fa-solid fa-file-import", localize("Directory.Import"), () => new CodexImporter().render({ force: true }));
  button("fa-solid fa-file-export", localize("Directory.Export"), () => new CodexExporter().render({ force: true }));
  button("fa-solid fa-feather", localize("Directory.NewNote"), () => promptNewNote());
  const header = element.querySelector(".directory-header") ?? element.querySelector("header") ?? element;
  header.append(bar);
});

async function promptNewNote() {
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title: localize("Note.NewTitle") },
    content: `<div class="form-group"><label>${localize("Note.Name")}</label><input type="text" name="name" autofocus></div>`,
    ok: { label: localize("Note.Create"), callback: (event, button) => button.form.elements.name.value.trim() }
  });
  if ( !name ) return;
  const page = await createCodexNote({ name });
  page?.parent?.sheet.render(true, { pageId: page.id });
}

export { isCodexPage };
