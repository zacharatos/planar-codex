/**
 * Planar Codex — the Markdown page sheet.
 * Built on Foundry's own Markdown sheet (CodeMirror editor, enrichment in view mode), and adds:
 *  - Obsidian syntax (wikilinks, callouts, comments, highlights, tasks) rendered on save and on view
 *  - a GM view with DM-only callouts, private lines, comments, properties and backlinks
 *  - read-aloud / whisper / share buttons, clickable task lists
 *  - drag a Codex note into the editor to insert [[Note]]
 */
import { MODULE_ID, convert, getMarkdown, markdownUpdate, updateMarkdown, isCodexPage, localize, FORMAT_MARKDOWN } from "./codex.mjs";
import { linkIndex } from "./link-index.mjs";
import { toggleTask, escapeHTML, splitFrontmatter, fmList } from "./markdown.mjs";
import { showToPlayers, postToChat, whisperTo, shareWith } from "./actions.mjs";
import { attachAutocomplete } from "./autocomplete.mjs";
import { onViewRendered, interceptEdit, editInPlace, contentContainer } from "./inline-edit.mjs";

const Base = foundry.applications.sheets.journal.JournalEntryPageMarkdownSheet;

export class CodexMarkdownSheet extends Base {
  static DEFAULT_OPTIONS = {
    classes: ["planar-codex"],
    window: { icon: "fa-solid fa-book-skull" }
  };

  /** @override */
  async _prepareContentContext(context, options) {
    await super._prepareContentContext(context, options);
    if ( !this.isView || !game.user.isGM ) return;
    const page = this.document;
    const { html } = convert(getMarkdown(page), { gm: true, page, lines: true });
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    context.text ??= {};
    context.text.enriched = await TextEditor.enrichHTML(html, {
      secrets: page.isOwner,
      relativeTo: page,
      rollData: {}
    }) + this.#backlinksHTML(page);
  }

  #backlinksHTML(page) {
    if ( !game.settings.get(MODULE_ID, "showBacklinks") ) return "";
    const pages = linkIndex.backlinksOf(page);
    if ( !pages.length ) return "";
    const items = pages.map(p => `<li>${p.toAnchor({ name: p.parent.name }).outerHTML}</li>`).join("");
    return `<footer class="codex-backlinks"><h4><i class="fa-solid fa-arrow-turn-up fa-flip-horizontal"></i> ${localize("Backlinks.Title")} (${pages.length})</h4><ul>${items}</ul></footer>`;
  }

  /**
   * Foundry's edit control opens the note in place (at the reading position) when it is on screen,
   * instead of a separate editor window. The window still opens when the note isn't on screen,
   * when the setting is off, or from the editor's "Foundry editor" button.
   * @override
   */
  _canRender(options) {
    const result = super._canRender(options);
    if ( result === false ) return false;
    if ( !this.isView && !this.rendered && !options?.codexForce && interceptEdit(this.document) ) return false;
    return result;
  }

  /**
   * Store Markdown, the player HTML and frontmatter flags whenever the editor saves.
   * @override
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    const getProp = foundry.utils.getProperty;
    const markdown = data?.["text.markdown"] ?? getProp(data ?? {}, "text.markdown");
    if ( typeof markdown !== "string" ) return data;
    const update = markdownUpdate(this.document, markdown);
    const flat = Object.keys(data).some(k => k.startsWith("text."));
    if ( flat ) Object.assign(data, update);
    else for ( const [k, v] of Object.entries(update) ) foundry.utils.setProperty(data, k, v);
    return data;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if ( !this.isView ) {
      attachAutocomplete(root);
      return;
    }
    root.classList.add("planar-codex", "codex-page");
    if ( game.user.isGM ) {
      this.#decorateCallouts(root);
      this.#insertToolbar(root);
    }
    this.#activateTasks(root);
    onViewRendered(this, root);
  }

  /** Buttons on read-aloud and private-line callouts. */
  #decorateCallouts(root) {
    for ( const box of root.querySelectorAll(".codex-callout-readaloud, .codex-callout-whisper") ) {
      if ( box.querySelector(":scope > .codex-callout-title .codex-actions") ) continue;
      const title = box.querySelector(":scope > .codex-callout-title");
      const body = box.querySelector(":scope > .codex-callout-content");
      if ( !title || !body ) continue;
      const kind = box.dataset.callout;
      const label = box.dataset.title ?? "";
      const actions = document.createElement("span");
      actions.className = "codex-actions";
      const btn = (icon, text, tip, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "codex-action";
        b.dataset.tooltip = tip;
        b.setAttribute("aria-label", tip);
        b.innerHTML = `<i class="${icon}"></i><span>${text}</span>`;
        b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); fn(); });
        actions.append(b);
      };
      if ( kind === "readaloud" ) {
        btn("fa-solid fa-display", localize("ReadAloud.ShowShort"), localize("ReadAloud.Show"), () => showToPlayers(label, body.innerHTML));
        btn("fa-solid fa-comment", localize("ReadAloud.PostShort"), localize("ReadAloud.Post"), () => postToChat(label, body.innerHTML));
      } else if ( kind === "whisper" ) {
        btn("fa-solid fa-paper-plane", localize("Whisper.Short"), localize("Whisper.Button", { name: label || "?" }), () => whisperTo(label, body.innerHTML));
      }
      title.append(actions);
    }
  }

  /** GM toolbar: edit in place, and share a handout with the player(s) named in `player:` frontmatter. */
  #insertToolbar(root) {
    const page = this.document;
    const players = fmList(splitFrontmatter(getMarkdown(page)).data, "player");
    if ( root.querySelector(".codex-toolbar") ) return;
    const bar = document.createElement("div");
    bar.className = "codex-toolbar";
    if ( page.isOwner ) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "codex-toolbar-edit";
      edit.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> ${localize("Editor.EditHere")}`;
      edit.dataset.tooltip = localize("Editor.EditHereTooltip");
      edit.addEventListener("click", ev => { ev.preventDefault(); editInPlace(page); });
      bar.append(edit);
    }
    for ( const who of players ) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i class="fa-solid fa-share-from-square"></i> ${localize("Share.Button", { name: escapeHTML(who) })}`;
      b.addEventListener("click", () => shareWith(page, who));
      bar.append(b);
    }
    const target = contentContainer(root);
    if ( target === root ) root.querySelector("[data-codex-line]")?.before(bar) ?? root.prepend(bar);
    else target.prepend(bar);
  }

  /** Task checkboxes tick for anyone who can edit the page, and save back to the Markdown. */
  #activateTasks(root) {
    const page = this.document;
    const canEdit = page.isOwner;
    for ( const input of root.querySelectorAll("input[data-codex-task]") ) {
      if ( !canEdit ) continue;
      input.disabled = false;
      input.addEventListener("change", async ev => {
        ev.stopPropagation();
        const index = Number(input.dataset.codexTask);
        await updateMarkdown(page, toggleTask(getMarkdown(page), index));
      });
    }
  }

  /**
   * Dropping a Codex note into the editor inserts a wikilink instead of a raw @UUID link.
   * @override
   */
  async _onDropContentLink(event, eventData) {
    try {
      if ( eventData?.uuid && ["JournalEntry", "JournalEntryPage"].includes(eventData.type) ) {
        const doc = await fromUuid(eventData.uuid);
        const page = doc?.documentName === "JournalEntry" ? doc.pages.find(p => isCodexPage(p)) : doc;
        if ( page && isCodexPage(page) ) {
          const editor = event.target.closest?.("code-mirror") ?? this.element.querySelector("code-mirror");
          if ( editor ) {
            const anchor = eventData.anchor?.name ? `#${eventData.anchor.name}` : "";
            insertAtCursor(editor, `[[${page.parent.name}${anchor}]]`);
            return;
          }
        }
      }
    } catch(err) {
      console.warn(`${MODULE_ID} | drop handling failed, falling back to core`, err);
    }
    return super._onDropContentLink(event, eventData);
  }
}

function insertAtCursor(editor, text) {
  const value = editor.value ?? "";
  const pos = Number.isInteger(editor.cursor) ? editor.cursor : value.length;
  editor.value = value.slice(0, pos) + text + value.slice(pos);
  editor.dispatchEvent(new Event("change", { bubbles: true }));
}

export { FORMAT_MARKDOWN };
