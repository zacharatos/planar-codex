/**
 * Planar Codex — table actions: read-aloud to players, private lines, sharing handouts.
 */
import { MODULE_ID, localize } from "./codex.mjs";
import { normalizeKey, escapeHTML } from "./markdown.mjs";

const SOCKET = `module.${MODULE_ID}`;

export function registerSocket() {
  game.socket.on(SOCKET, async data => {
    if ( !data || (data.users && !data.users.includes(game.user.id)) ) return;
    if ( data.action === "show-text" ) ReadAloudPopout.show(data.title, data.html);
    if ( data.action === "open-page" ) {
      const page = await fromUuid(data.uuid);
      page?.parent?.sheet.render(true, { pageId: page.id });
    }
  });
}

/** A small window for players showing read-aloud text. */
export class ReadAloudPopout extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["planar-codex", "codex-readaloud-popout"],
    window: { icon: "fa-solid fa-book-open-reader", resizable: true },
    position: { width: 560, height: "auto" }
  };

  constructor(title, html, options = {}) {
    super(options);
    this.codexTitle = title;
    this.codexHTML = html;
  }

  get title() { return this.codexTitle || localize("ReadAloud.Title"); }

  async _renderHTML() {
    const TextEditor = foundry.applications.ux.TextEditor.implementation;
    const enriched = await TextEditor.enrichHTML(this.codexHTML, { secrets: false });
    return `<div class="codex-readaloud-text">${enriched}</div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static show(title, html) {
    new this(title, html).render({ force: true });
  }
}

/** Show a callout's text in a popout on every player's screen. */
export function showToPlayers(title, html) {
  game.socket.emit(SOCKET, { action: "show-text", title, html });
  ui.notifications.info(localize("ReadAloud.Shown"));
}

/** Post a callout's text to chat as narration. */
export async function postToChat(title, html) {
  return ChatMessage.implementation.create({
    content: `<div class="planar-codex codex-chat-readaloud">${html}</div>`,
    speaker: { alias: title || localize("ReadAloud.Narrator") }
  });
}

/**
 * The non-GM users who play a character, matched by actor name or the start of it ("Ilsa" → "Ilsa Varn").
 * @param {string} who
 * @returns {{users: User[], actor: Actor|null}}
 */
export function playersFor(who) {
  const key = normalizeKey(who);
  if ( !key ) return { users: [], actor: null };
  const actors = game.actors.filter(a => a.hasPlayerOwner);
  const actor = actors.find(a => normalizeKey(a.name) === key)
    ?? actors.find(a => normalizeKey(a.name).startsWith(`${key} `))
    ?? actors.find(a => normalizeKey(a.name).split(" ").includes(key))
    ?? null;
  let users = [];
  if ( actor ) users = game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
  if ( !users.length ) users = game.users.filter(u => !u.isGM && (normalizeKey(u.name) === key || (u.character && normalizeKey(u.character.name).startsWith(key))));
  return { users, actor };
}

/** Whisper a private line to a character's player (and the GMs). */
export async function whisperTo(who, html) {
  const { users, actor } = playersFor(who);
  if ( !users.length ) {
    ui.notifications.warn(localize("Whisper.NoPlayer", { name: who }));
    return null;
  }
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  ui.notifications.info(localize("Whisper.Sent", { name: actor?.name ?? who }));
  return ChatMessage.implementation.create({
    content: `<div class="planar-codex codex-chat-whisper">${html}</div>`,
    whisper: [...new Set([...users.map(u => u.id), ...gms])],
    speaker: { alias: localize("Whisper.Speaker") }
  });
}

/** Give a character's player Observer rights on a note and open it on their screen. */
export async function shareWith(page, who) {
  const { users, actor } = playersFor(who);
  if ( !users.length ) {
    ui.notifications.warn(localize("Whisper.NoPlayer", { name: who }));
    return;
  }
  const entry = page.parent;
  const ownership = { ...entry.ownership };
  const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  for ( const u of users ) ownership[u.id] = Math.max(ownership[u.id] ?? 0, OBSERVER);
  await entry.update({ ownership });
  game.socket.emit(SOCKET, { action: "open-page", uuid: page.uuid, users: users.map(u => u.id) });
  ui.notifications.info(localize("Share.Done", { note: escapeHTML(entry.name), name: actor?.name ?? who }));
}

/* -------------------------------------------- */
/*  Buttons on read-aloud and private-line boxes */
/* -------------------------------------------- */

/** The Planar Whispers API, when that module is active. */
export function whispersApi() {
  const mod = game.modules.get("planar-whispers");
  return mod?.active ? mod.api ?? null : null;
}

/**
 * Add the GM buttons to every read-aloud and private-line callout under `root`:
 * Show / Post for read-aloud; Whisper / Queue (Planar Whispers) or a chat whisper for private lines.
 * Used by the note sheet and by the Prompter's beat cards.
 * @param {HTMLElement} root
 * @param {object} [options]
 * @param {string} [options.source]        The page uuid the lines come from (Planar Whispers keeps it).
 * @param {(kind: string, box: HTMLElement) => void} [options.onUse]  Called after a button sends something ("readaloud" or "whisper"), with its box.
 */
export function decorateCallouts(root, { source = "", onUse = null } = {}) {
  for ( const box of root.querySelectorAll(".codex-callout-readaloud, .codex-callout-whisper") ) {
    if ( box.querySelector(":scope > .codex-callout-title .codex-actions") ) continue;
    const title = box.querySelector(":scope > .codex-callout-title");
    const body = box.querySelector(":scope > .codex-callout-content");
    if ( !title || !body ) continue;
    const kind = box.dataset.callout;
    const label = box.dataset.title ?? "";
    const actions = document.createElement("span");
    actions.className = "codex-actions";
    const used = result => { if ( result !== null && result !== undefined ) onUse?.(kind, box); return result; };
    const btn = (icon, text, tip, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "codex-action";
      b.dataset.tooltip = tip;
      b.setAttribute("aria-label", tip);
      b.innerHTML = `<i class="${icon}"></i><span>${text}</span>`;
      b.addEventListener("click", async ev => {
        ev.preventDefault(); ev.stopPropagation();
        try { used(await fn()); } catch(err) { ui.notifications.warn(err.message); }
      });
      actions.append(b);
    };
    if ( kind === "readaloud" ) {
      btn("fa-solid fa-display", localize("ReadAloud.ShowShort"), localize("ReadAloud.Show"), () => (showToPlayers(label, body.innerHTML), true));
      btn("fa-solid fa-comment", localize("ReadAloud.PostShort"), localize("ReadAloud.Post"), () => postToChat(label, body.innerHTML));
    } else if ( kind === "whisper" ) {
      const pw = whispersApi();
      if ( pw?.fromCallouts ) {
        const send = queue => pw.fromCallouts(whisperGroup(root, box, pw), { source, queue });
        btn("fa-solid fa-paper-plane", localize("Whisper.Short"), localize("Whisper.FullScreen", { name: label || "?" }), () => send(false));
        btn("fa-solid fa-hourglass-start", localize("Whisper.QueueShort"), localize("Whisper.Queue", { name: label || "?" }), () => send(true));
      } else {
        btn("fa-solid fa-paper-plane", localize("Whisper.Short"), localize("Whisper.Button", { name: label || "?" }), () => whisperTo(label, body.innerHTML));
      }
    }
    title.append(actions);
  }
}

/**
 * A private line for Planar Whispers, with every other private line under `root` that shares its
 * `together=<name>` option (they are sent as one group, at the same moment).
 */
function whisperGroup(root, box, pw) {
  const one = b => ({
    targets: b.dataset.title ?? "",
    meta: b.dataset.meta ?? "",
    html: b.querySelector(":scope > .codex-callout-content")?.innerHTML ?? ""
  });
  const together = pw.parseMeta(box.dataset.meta ?? "").together;
  if ( !together ) return [one(box)];
  return Array.from(root.querySelectorAll(".codex-callout-whisper"))
    .filter(b => pw.parseMeta(b.dataset.meta ?? "").together === together)
    .map(one);
}
