/**
 * Planar Codex — pure Markdown helpers.
 *
 * Nothing in this file touches Foundry globals, so it runs both inside Foundry and in Node tests.
 * The page's Markdown is stored exactly as written in Obsidian (wikilinks, callouts, frontmatter);
 * this module turns it into the HTML Foundry stores and displays.
 */

/* -------------------------------------------- */
/*  Constants                                   */
/* -------------------------------------------- */

/**
 * Options for the bundled `marked` parser (CommonMark + GFM, like Obsidian).
 * `breaks: true` matches Obsidian's default ("strict line breaks" off): a single newline is a line break.
 */
export const MARKED_OPTIONS = { gfm: true, breaks: true };

/** Typed link prefixes: [[actor:Brannoc]], [[spell:Fireball]] … → the Foundry document type they resolve to. */
export const TYPE_PREFIXES = {
  actor: "Actor", npc: "Actor", pc: "Actor", monster: "Actor", creature: "Actor",
  item: "Item", spell: "Item", feat: "Item", feature: "Item", weapon: "Item", armor: "Item", equipment: "Item",
  scene: "Scene",
  table: "RollTable", rolltable: "RollTable",
  journal: "JournalEntry",
  playlist: "Playlist",
  macro: "Macro"
};

/** Callout types with special behaviour. Everything else renders as a generic styled callout. */
export const CALLOUT_ALIASES = {
  readaloud: "readaloud", "read-aloud": "readaloud", read: "readaloud", boxed: "readaloud", boxedtext: "readaloud",
  dm: "dm", gm: "dm", "dm-only": "dm", dmonly: "dm", private: "dm",
  secret: "secret", reveal: "secret",
  whisper: "whisper", "private-line": "whisper", note2player: "whisper"
};

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"];

/* -------------------------------------------- */
/*  Small utilities                             */
/* -------------------------------------------- */

export function escapeHTML(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Normalise a note name or path for lookups: NFC, lower case, no `.md`, forward slashes, single spaces. */
export function normalizeKey(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\\/g, "/")
    .replace(/\.md$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Normalise heading text for comparison (ignores markdown emphasis, punctuation spacing, case). */
export function normalizeHeading(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The note's basename without extension. */
export function basename(path) {
  const parts = String(path).replace(/\\/g, "/").split("/");
  return parts[parts.length - 1].replace(/\.md$/i, "");
}

export function dirname(path) {
  const parts = String(path).replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
}

/** Deterministic 32-bit FNV-1a hash, returned as 8 hex characters. */
export function hashString(text) {
  let h = 0x811c9dc5;
  const s = String(text ?? "");
  for ( let i = 0; i < s.length; i++ ) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** A longer content hash (two FNV passes with different seeds) used to detect edits. */
export function contentHash(text) {
  const s = String(text ?? "").replace(/\r\n?/g, "\n");
  return hashString(s) + hashString(`${s.length}:${s}`);
}

/* -------------------------------------------- */
/*  Frontmatter                                 */
/* -------------------------------------------- */

function parseScalar(raw) {
  let v = raw.trim();
  if ( v === "" ) return "";
  if ( (v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")) ) {
    return v.slice(1, -1).replace(/\\"/g, "\"");
  }
  if ( v.startsWith("[") && v.endsWith("]") ) {
    const inner = v.slice(1, -1).trim();
    if ( !inner ) return [];
    return splitInlineList(inner).map(parseScalar);
  }
  if ( /^(true|false)$/i.test(v) ) return v.toLowerCase() === "true";
  if ( /^-?\d+(\.\d+)?$/.test(v) ) return Number(v);
  if ( v === "null" || v === "~" ) return null;
  return v;
}

function splitInlineList(inner) {
  const out = [];
  let cur = "";
  let quote = null;
  for ( const ch of inner ) {
    if ( quote ) {
      cur += ch;
      if ( ch === quote ) quote = null;
    } else if ( ch === "\"" || ch === "'" ) {
      quote = ch; cur += ch;
    } else if ( ch === "," ) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  if ( cur.trim() ) out.push(cur);
  return out;
}

/**
 * Split YAML frontmatter from a note. Supports the subset Obsidian properties use:
 * scalars, inline lists, block lists. Unknown structures are kept as raw strings.
 * @param {string} markdown
 * @returns {{data: object, body: string, raw: string|null}}
 */
export function splitFrontmatter(markdown) {
  const text = String(markdown ?? "").replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const match = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if ( !match ) return { data: {}, body: text, raw: null };
  const raw = match[1];
  const data = {};
  let currentKey = null;
  for ( const line of raw.split("\n") ) {
    if ( !line.trim() || line.trim().startsWith("#") ) continue;
    const listItem = line.match(/^\s+-\s+(.*)$/) || line.match(/^-\s+(.*)$/);
    if ( listItem && currentKey ) {
      if ( !Array.isArray(data[currentKey]) ) data[currentKey] = data[currentKey] ? [data[currentKey]] : [];
      data[currentKey].push(parseScalar(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\-. ]+):\s*(.*)$/);
    if ( kv ) {
      currentKey = kv[1].trim();
      data[currentKey] = kv[2].trim() === "" ? "" : parseScalar(kv[2]);
    }
  }
  for ( const [k, v] of Object.entries(data) ) if ( v === "" ) data[k] = [];
  return { data, body: text.slice(match[0].length), raw };
}

function yamlValue(v) {
  if ( v === null || v === undefined ) return "";
  if ( typeof v === "number" || typeof v === "boolean" ) return String(v);
  const s = String(v);
  if ( s === "" || /^[\s>|&*!%@`{[\]},#?-]|:\s|\s#|^(true|false|null|~|\d+(\.\d+)?)$/i.test(s) || s !== s.trim() ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  }
  return s;
}

/** Serialise a flat properties object to YAML frontmatter (block lists for arrays). */
export function serializeFrontmatter(data) {
  const lines = [];
  for ( const [k, v] of Object.entries(data) ) {
    if ( Array.isArray(v) ) {
      if ( !v.length ) { lines.push(`${k}: []`); continue; }
      lines.push(`${k}:`);
      for ( const item of v ) lines.push(`  - ${yamlValue(item)}`);
    } else lines.push(`${k}: ${yamlValue(v)}`);
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Replace (or add) the frontmatter of a note, keeping the body as is. */
export function setFrontmatter(markdown, data) {
  const { body } = splitFrontmatter(markdown);
  const fm = Object.keys(data).length ? serializeFrontmatter(data) : "";
  return fm + (fm && !body.startsWith("\n") ? "\n" : "") + body.replace(/^\n+/, fm ? "" : "");
}

/** Read a frontmatter key as an array of strings. */
export function fmList(data, key) {
  const v = data?.[key];
  if ( v === undefined || v === null || v === "" ) return [];
  return (Array.isArray(v) ? v : [v]).map(x => String(x)).filter(Boolean);
}

/* -------------------------------------------- */
/*  Code protection                             */
/* -------------------------------------------- */

/**
 * Replace fenced code blocks and inline code with placeholders, so nothing else touches them.
 * @returns {{text: string, restore: (s: string) => string}}
 */
function protectCode(text) {
  const store = [];
  const put = s => `\u0001C${store.push(s) - 1}\u0001`;
  let out = text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\2[ \t]*$/gm, m => put(m));
  out = out.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, m => put(m));
  const restore = s => s.replace(/\u0001C(\d+)\u0001/g, (_, i) => store[Number(i)]);
  return { text: out, restore };
}

/* -------------------------------------------- */
/*  Wikilinks                                   */
/* -------------------------------------------- */

/** Is the inside of `[[…]]` a Foundry / dnd5e roll rather than a note link? */
export function isRollContent(inner) {
  const s = String(inner).trim();
  if ( s.startsWith("/") ) return true;                          // [[/r 1d20]], [[/check …]], [[/damage …]]
  if ( /^(lookup|language)\s/i.test(s) ) return true;           // dnd5e lookups
  if ( /^[\d(@]/.test(s) && /\d*d\d/i.test(s) && /^[\w\s+\-*/().,@<>=!{}]+$/.test(s) ) return true; // [[1d20+5]]
  if ( /^\d+(\s*[+\-*/]\s*\d+)*$/.test(s) ) return true;        // [[2+3]]
  return false;
}

/**
 * Parse the inside of a wikilink.
 * @param {string} inner   Text between [[ and ]] (Obsidian may escape the pipe in tables as \|).
 * @returns {{target: string, heading: string|null, block: string|null, label: string|null, type: string|null, name: string}}
 */
export function parseWikilink(inner) {
  const raw = String(inner).replace(/\\\|/g, "|");
  const pipe = raw.indexOf("|");
  let target = pipe >= 0 ? raw.slice(0, pipe) : raw;
  const label = pipe >= 0 ? raw.slice(pipe + 1).trim() : null;
  let heading = null;
  let block = null;
  const hash = target.indexOf("#");
  if ( hash >= 0 ) {
    const frag = target.slice(hash + 1).trim();
    target = target.slice(0, hash);
    if ( frag.startsWith("^") ) block = frag.slice(1);
    else heading = frag.split("#").pop().trim() || null;
  }
  target = target.trim();
  let type = null;
  let name = target;
  const typed = target.match(/^([A-Za-z]+):(.+)$/);
  if ( typed && TYPE_PREFIXES[typed[1].toLowerCase()] ) {
    type = typed[1].toLowerCase();
    name = typed[2].trim();
  }
  return { target, heading, block, label: label || null, type, name };
}

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+?)\]\](?!\])/g;

/**
 * List every wikilink and embed in a note (outside code).
 * @param {string} markdown
 * @returns {Array<{raw: string, embed: boolean, line: number} & ReturnType<typeof parseWikilink>>}
 */
export function extractLinks(markdown) {
  const { body } = splitFrontmatter(markdown);
  const { text } = protectCode(body);
  const links = [];
  const lineStarts = [0];
  for ( let i = 0; i < text.length; i++ ) if ( text[i] === "\n" ) lineStarts.push(i + 1);
  const lineOf = idx => {
    let lo = 0, hi = lineStarts.length - 1;
    while ( lo < hi ) { const mid = (lo + hi + 1) >> 1; if ( lineStarts[mid] <= idx ) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  for ( const m of text.matchAll(WIKILINK_RE) ) {
    if ( isRollContent(m[2]) ) continue;
    links.push({ raw: m[0], embed: m[1] === "!", line: lineOf(m.index), ...parseWikilink(m[2]) });
  }
  return links;
}

/** Is a link target an image/asset file rather than a note? */
export function isAssetTarget(target) {
  const ext = String(target).split(".").pop().toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) || ["pdf", "mp3", "ogg", "webm", "mp4", "m4a", "wav"].includes(ext);
}

/* -------------------------------------------- */
/*  Markdown → HTML                             */
/* -------------------------------------------- */

/**
 * @typedef {object} ConvertOptions
 * @property {(md: string) => string} render     Markdown → HTML (a `marked` instance's parse function).
 * @property {(html: string) => HTMLElement} parseFragment  Returns a container element holding the parsed HTML.
 * @property {boolean} [gm=false]               Render the GM view (DM callouts, comments, whispers, properties).
 * @property {(name: string) => string|null} [resolveAsset]  Map an embedded file name to a URL.
 * @property {Set<string>} [revealed]           Secret ids currently revealed (kept across re-renders).
 * @property {string} [notePath]                The note's vault path, used to make secret ids stable.
 * @property {(md: string) => object[]} [lexer]  With `parser`: render block by block and tag each top-level
 * @property {(tokens: object[]) => string} [parser]  element with `data-codex-line` (its 0-based source line), so the
 *                                              in-place editor can open where the reader is.
 */

/**
 * Convert a note's Markdown into Foundry HTML.
 * Player HTML (gm=false) is what gets stored in `text.content`: no DM callouts, comments, whispers or frontmatter.
 * @param {string} markdown
 * @param {ConvertOptions} options
 * @returns {{html: string, frontmatter: object, tasks: number}}
 */
export function convertMarkdown(markdown, options) {
  const { render, parseFragment, gm = false, resolveAsset = () => null, revealed = new Set(), notePath = "", lexer, parser } = options;
  const { data: frontmatter, body } = splitFrontmatter(markdown);
  const normalized = String(markdown ?? "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const bodyLine = countNewlines(normalized.slice(0, normalized.length - body.length));

  // Obsidian Dice Roller inline code → Foundry inline roll.
  let text = body.replace(/`dice:\s*([^`\n]+)`/g, (_, f) => `[[/r ${f.trim()}]]`);

  const { text: guarded, restore } = protectCode(text);
  text = guarded;

  const tokens = [];
  const tokenLines = [];   // newlines swallowed by each token (only multi-line comments have any)
  const token = (html, lines = 0) => { tokenLines.push(lines); return `CODEXTOKEN${tokens.push(html) - 1}X`; };

  // Comments: %%…%% (may span lines).
  text = text.replace(/%%([\s\S]*?)%%/g, (full, inner) => {
    const lines = countNewlines(full);
    if ( !gm ) return lines && lexer && parser ? token("", lines) : "";
    const multi = inner.includes("\n");
    const safe = escapeHTML(inner.trim()).replace(/\n/g, "<br>");
    return token(multi ? `<div class="codex-comment">${safe}</div>` : `<span class="codex-comment">${safe}</span>`, lines);
  });

  // Embeds and wikilinks; rolls and Foundry links are tokenised verbatim so the parser can't mangle them.
  text = text.replace(WIKILINK_RE, (full, bang, inner) => {
    if ( isRollContent(inner) ) {
      const label = "";
      return token(escapeHTML(full) + label);
    }
    const link = parseWikilink(inner);
    if ( bang ) return token(renderEmbed(link, resolveAsset));
    return token(renderLink(link));
  });
  // Roll labels: [[/check …]]{Label} — the label follows the token.
  text = text.replace(/(CODEXTOKEN\d+X)(\{[^}\n]*\})/g, (_, t, lbl) => token(tokens[Number(t.slice(10, -1))] + escapeHTML(lbl)));
  // Foundry document links and embeds written directly: @UUID[…]{…}, @Embed[…], &Reference[…]{…}
  text = text.replace(/[@&][A-Za-z]+\[[^\]\n]+\](?:\{[^}\n]*\})?/g, m => token(escapeHTML(m)));

  // Highlights.
  text = text.replace(/==([^=\n]+?)==/g, (_, inner) => `<mark>${inner}</mark>`);

  text = restore(text);

  let html;
  if ( lexer && parser ) {
    // Block by block, each top-level block preceded by a marker carrying its source line.
    const blocks = lexer(text);
    let line = bodyLine;
    const pieces = [];
    for ( const block of blocks ) {
      const out = parser(Object.assign([block], { links: blocks.links ?? {} }));
      if ( block.type !== "space" && out.trim() ) pieces.push(`<!--codex-line:${line}-->`);
      pieces.push(out);
      line += countNewlines(block.raw) + Array.from(block.raw.matchAll(/CODEXTOKEN(\d+)X/g)).reduce((n, m) => n + tokenLines[Number(m[1])], 0);
    }
    html = pieces.join("");
  }
  else html = render(text);
  html = html.replace(/CODEXTOKEN(\d+)X/g, (_, i) => restore(tokens[Number(i)]));

  const root = parseFragment(html);
  tagSourceLines(root);
  const taskCount = postProcess(root, { gm, revealed, notePath, frontmatter });
  if ( gm && Object.keys(frontmatter).length ) root.insertAdjacentHTML("afterbegin", renderProperties(frontmatter));
  return { html: root.innerHTML.trim(), frontmatter, tasks: taskCount };
}

function countNewlines(s) {
  let n = 0;
  for ( let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1) ) n++;
  return n;
}

/** Turn `<!--codex-line:N-->` markers into `data-codex-line` on the element that follows. */
function tagSourceLines(root) {
  for ( const node of Array.from(root.childNodes) ) {
    if ( node.nodeType !== 8 ) continue;
    const m = /^codex-line:(\d+)$/.exec(node.data ?? node.textContent ?? "");
    if ( !m ) continue;
    let next = node.nextSibling;
    while ( next && next.nodeType === 3 && !next.textContent.trim() ) next = next.nextSibling;
    if ( next?.nodeType === 1 ) next.setAttribute("data-codex-line", m[1]);
    node.remove();
  }
}

/** The text a wikilink shows: its label, else the note (› heading), else the heading. */
export function wikilinkLabel(link) {
  return link.label ?? (link.heading && !link.name ? link.heading : (link.type ? link.name : (link.heading ? `${link.name} › ${link.heading}` : link.name)));
}

const ROLL_ABILITIES = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const ROLL_SKILLS = {
  acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana", ath: "Athletics", dec: "Deception", his: "History",
  ins: "Insight", itm: "Intimidation", inv: "Investigation", med: "Medicine", nat: "Nature", prc: "Perception",
  prf: "Performance", per: "Persuasion", rel: "Religion", slt: "Sleight of Hand", ste: "Stealth", sur: "Survival"
};

/**
 * A short readable label for a roll enricher: "/check skill=his dc=15" → "History DC 15".
 * @param {string} inner  Text between [[ and ]].
 * @returns {string}
 */
export function describeRoll(inner) {
  const s = String(inner).trim();
  const m = s.match(/^\/(\w+)\s*(.*)$/);
  if ( !m ) return s;
  const [, cmd, rest] = m;
  const args = {};
  const loose = [];
  for ( const part of rest.split(/\s+/).filter(Boolean) ) {
    const kv = part.match(/^(\w+)=(.+)$/);
    if ( kv ) args[kv[1].toLowerCase()] = kv[2];
    else loose.push(part);
  }
  const names = (v, table) => String(v ?? "").split("/").filter(Boolean).map(x => table[x.toLowerCase()] ?? x).join(" / ");
  const dc = args.dc ? ` DC ${args.dc}` : "";
  switch ( cmd.toLowerCase() ) {
    case "check": case "skill": case "tool": {
      const what = args.skill ? names(args.skill, ROLL_SKILLS) : args.tool ? args.tool : names(args.ability ?? loose[0], { ...ROLL_ABILITIES, ...ROLL_SKILLS });
      const abil = args.skill && args.ability ? ` (${names(args.ability, ROLL_ABILITIES)})` : "";
      return `${what || "Check"}${abil}${dc}`;
    }
    case "save": return `${names(args.ability ?? loose[0], ROLL_ABILITIES)} save${dc}`;
    case "damage": return loose.filter(x => x !== "average").join(" ") || (args.formula ?? "Damage");
    case "heal": return `Heal ${loose.join(" ")}`.trim();
    case "attack": return `Attack ${loose.join(" ") || args.formula || ""}`.trim();
    case "gmr": case "gmroll": return `GM ${loose.join(" ")}`.trim();
    case "br": case "blindroll": return `Blind ${loose.join(" ")}`.trim();
    case "r": case "roll": case "pr": case "publicroll": case "sr": case "selfroll": return loose.join(" ") || s;
    default: return s.slice(1);
  }
}

function renderLink(link) {
  const tgt = link.target + (link.heading ? `#${link.heading}` : link.block ? `#^${link.block}` : "");
  const label = wikilinkLabel(link);
  if ( !link.target && link.heading ) return `@Codex[#${escapeHTML(link.heading)}]{${escapeHTML(label).replace(/[{}]/g, "")}}`;
  return `@Codex[${escapeHTML(tgt)}]{${escapeHTML(label).replace(/[{}]/g, "")}}`;
}

function renderEmbed(link, resolveAsset) {
  if ( isAssetTarget(link.target) ) {
    const url = resolveAsset(basename(link.target)) ?? resolveAsset(link.target);
    const name = basename(link.target);
    if ( !url ) return `<span class="codex-missing-asset" data-asset="${escapeHTML(link.target)}"><i class="fa-solid fa-image"></i> ${escapeHTML(name)}</span>`;
    const size = link.label && /^\d+(x\d+)?$/.test(link.label) ? link.label.split("x") : null;
    const dims = size ? ` width="${size[0]}"${size[1] ? ` height="${size[1]}"` : ""}` : "";
    const alt = size ? name : (link.label ?? name);
    return `<img class="codex-image" src="${escapeHTML(url)}" alt="${escapeHTML(alt)}"${dims}>`;
  }
  const tgt = link.target + (link.heading ? `#${link.heading}` : "");
  return `@CodexEmbed[${escapeHTML(tgt)}]`;
}

function renderProperties(data) {
  const rows = Object.entries(data).map(([k, v]) => {
    const val = Array.isArray(v) ? v.map(x => escapeHTML(String(x))).join(", ") : escapeHTML(String(v));
    return `<tr><th>${escapeHTML(k)}</th><td>${val}</td></tr>`;
  }).join("");
  return `<details class="codex-properties"><summary><i class="fa-solid fa-list"></i> Properties</summary><table>${rows}</table></details>`;
}

/* -------------------------------------------- */
/*  DOM post-processing                         */
/* -------------------------------------------- */

const CALLOUT_RE = /^\s*\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*(.*)$/;

function postProcess(root, { gm, revealed, notePath }) {
  // Callouts, innermost first.
  const quotes = Array.from(root.querySelectorAll("blockquote")).reverse();
  let secretIndex = 0;
  for ( const bq of quotes ) {
    const info = readCalloutHeader(bq);
    if ( !info ) continue;
    const kind = CALLOUT_ALIASES[info.type.toLowerCase()] ?? info.type.toLowerCase();
    const doc = bq.ownerDocument;

    if ( kind === "secret" ) {
      const id = `secret-${hashString(`${notePath}|${secretIndex++}|${info.bodyText}`)}${hashString(info.bodyText)}`.slice(0, 23);
      const section = doc.createElement("section");
      section.className = revealed.has(id) ? "secret revealed" : "secret";
      section.id = id;
      if ( bq.dataset.codexLine ) section.dataset.codexLine = bq.dataset.codexLine;
      if ( info.title ) {
        const h = doc.createElement("p");
        h.className = "codex-secret-title";
        h.innerHTML = `<strong>${info.title}</strong>`;
        section.appendChild(h);
      }
      for ( const n of info.body ) section.appendChild(n);
      bq.replaceWith(section);
      continue;
    }

    if ( (kind === "dm" || kind === "whisper") && !gm ) { bq.remove(); continue; }

    const aside = doc.createElement(info.fold ? "details" : "aside");
    aside.className = `codex-callout codex-callout-${kind}`;
    aside.dataset.callout = kind;
    if ( bq.dataset.codexLine ) aside.dataset.codexLine = bq.dataset.codexLine;
    if ( info.title ) aside.dataset.title = info.titleText;
    if ( info.fold === "+" ) aside.setAttribute("open", "");
    const header = doc.createElement(info.fold ? "summary" : "header");
    header.className = "codex-callout-title";
    const titleHTML = kind === "whisper" && info.title ? `${defaultCalloutTitle(kind)} · ${info.title}` : (info.title || defaultCalloutTitle(kind));
    header.innerHTML = `<i class="${calloutIcon(kind)}"></i> <span>${titleHTML}</span>`;
    aside.appendChild(header);
    const content = doc.createElement("div");
    content.className = "codex-callout-content";
    for ( const n of info.body ) content.appendChild(n);
    aside.appendChild(content);
    bq.replaceWith(aside);
  }

  // Task list items: number them so the GM view can tick them.
  let task = 0;
  for ( const input of root.querySelectorAll("li input[type=checkbox]") ) {
    input.dataset.codexTask = String(task++);
    input.removeAttribute("style");
    input.closest("li")?.classList.add("codex-task");
    if ( input.hasAttribute("checked") ) input.closest("li")?.classList.add("codex-task-done");
  }
  for ( const li of root.querySelectorAll("li.task-list-item") ) li.removeAttribute("style");

  // Book citations written as inline code (`ToFW, Ch. 1 › M3`) become quiet citation chips.
  for ( const code of Array.from(root.querySelectorAll("code")) ) {
    if ( code.closest("pre") ) continue;
    const text = code.textContent.trim();
    const m = text.match(CITATION_RE);
    if ( !m ) continue;
    const cite = code.ownerDocument.createElement("cite");
    cite.className = "codex-cite";
    cite.dataset.book = m[1] === "›" ? "here" : m[1].replace(/[^\w]/g, "");
    cite.textContent = text;
    code.replaceWith(cite);
  }
  return task;
}

/**
 * Inline code that starts with one of these is a book citation and renders as a quiet chip:
 * `PHB, Ch. 7 › Fireball`, `DMG 2024 › Traps`, `› M2` (a place in the current note).
 * Worlds can change the list (module setting "Citation prefixes").
 */
export const DEFAULT_CITATION_PREFIXES = [
  "PHB", "DMG", "MM", "XGE", "TCoE", "VGM", "MToF", "GoS", "FRHoF", "SRD",
  "ToFW", "SatO", "MPP", "AATM", "AU", "RHW", "TGS\\S*", "GH:?PG\\S*",
  "Introduction", "Conclusion", "Appendix", "Part \\d", "Ch\\."
];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build the citation pattern. A prefix is plain text unless it contains a backslash, then it is a regex fragment. */
export function citationRegex(prefixes = DEFAULT_CITATION_PREFIXES) {
  const alts = prefixes.map(p => String(p).trim()).filter(Boolean)
    .map(p => /\\/.test(p) ? p : escapeRe(p));
  return new RegExp(`^(${[...alts, "›"].join("|")})(?=[\\s,›.:']|$)`);
}

export let CITATION_RE = citationRegex();

/** Replace the citation prefixes (comma or newline separated text, or an array). */
export function setCitationPrefixes(list) {
  const items = Array.isArray(list) ? list : String(list ?? "").split(/[,\n]/);
  const clean = items.map(x => x.trim()).filter(Boolean);
  CITATION_RE = citationRegex(clean.length ? clean : DEFAULT_CITATION_PREFIXES);
}

/**
 * Read `[!type]± title` from the first paragraph of a blockquote and detach the remaining body nodes.
 * @returns {null|{type: string, fold: string, title: string, titleText: string, body: Node[], bodyText: string}}
 */
function readCalloutHeader(bq) {
  const first = Array.from(bq.children)[0];
  if ( !first || first.tagName !== "P" ) return null;
  const firstText = first.textContent ?? "";
  if ( !/^\s*\[![A-Za-z]/.test(firstText) ) return null;

  // Split the first paragraph at its first line break (<br> or newline).
  const doc = bq.ownerDocument;
  const headNodes = [];
  const restNodes = [];
  let broke = false;
  for ( const node of Array.from(first.childNodes) ) {
    if ( broke ) { restNodes.push(node); continue; }
    if ( node.nodeType === 1 && node.tagName === "BR" ) { broke = true; continue; }
    if ( node.nodeType === 3 && node.textContent.includes("\n") ) {
      const idx = node.textContent.indexOf("\n");
      headNodes.push(doc.createTextNode(node.textContent.slice(0, idx)));
      const rest = node.textContent.slice(idx + 1);
      if ( rest ) restNodes.push(doc.createTextNode(rest));
      broke = true;
      continue;
    }
    headNodes.push(node);
  }
  const holder = doc.createElement("span");
  for ( const n of headNodes ) holder.appendChild(n);
  const headHTML = holder.innerHTML;
  const headText = holder.textContent;
  const m = headText.match(CALLOUT_RE);
  if ( !m ) return null;
  const marker = headHTML.match(/\[![A-Za-z][\w-]*\][+-]?[ \t]*/);
  const titleHTML = marker ? headHTML.slice(headHTML.indexOf(marker[0]) + marker[0].length).trim() : "";

  const body = [];
  if ( restNodes.length ) {
    const p = doc.createElement("p");
    for ( const n of restNodes ) p.appendChild(n);
    if ( p.textContent.trim() || p.querySelector("*") ) body.push(p);
  }
  first.remove();
  for ( const n of Array.from(bq.childNodes) ) {
    if ( n.nodeType === 3 && !n.textContent.trim() ) continue;
    body.push(n);
  }
  const bodyText = body.map(n => n.textContent).join("\n");
  return { type: m[1], fold: m[2], title: titleHTML, titleText: m[3].trim(), body, bodyText };
}

function calloutIcon(kind) {
  return {
    readaloud: "fa-solid fa-book-open-reader",
    dm: "fa-solid fa-lock",
    whisper: "fa-solid fa-user-secret",
    secret: "fa-solid fa-eye-slash",
    note: "fa-solid fa-pen",
    info: "fa-solid fa-circle-info",
    tip: "fa-solid fa-lightbulb",
    hint: "fa-solid fa-lightbulb",
    important: "fa-solid fa-circle-exclamation",
    warning: "fa-solid fa-triangle-exclamation",
    caution: "fa-solid fa-triangle-exclamation",
    danger: "fa-solid fa-skull",
    quote: "fa-solid fa-quote-left",
    example: "fa-solid fa-list",
    question: "fa-solid fa-circle-question",
    success: "fa-solid fa-check",
    todo: "fa-solid fa-square-check",
    abstract: "fa-solid fa-clipboard-list",
    summary: "fa-solid fa-clipboard-list"
  }[kind] ?? "fa-solid fa-bookmark";
}

function defaultCalloutTitle(kind) {
  return {
    readaloud: "Read-aloud",
    dm: "DM only",
    whisper: "Private line"
  }[kind] ?? (kind.charAt(0).toUpperCase() + kind.slice(1));
}

/* -------------------------------------------- */
/*  Markdown edits used by the sheet            */
/* -------------------------------------------- */

/**
 * Toggle the n-th task checkbox (`- [ ]` / `- [x]`) in a note, counting outside code and frontmatter.
 * @returns {string} The updated Markdown.
 */
export function toggleTask(markdown, index) {
  const fm = String(markdown).match(/^---\n[\s\S]*?\n---[ \t]*\n/);
  const head = fm ? fm[0] : "";
  const body = String(markdown).slice(head.length);
  const { text, restore } = protectCode(body);
  let n = -1;
  const out = text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm, (m, a, state, b) => {
    n++;
    if ( n !== index ) return m;
    return a + (state === " " ? "x" : " ") + b;
  });
  return head + restore(out);
}

/** Extract headings (level + text) from a note, outside code. */
export function extractHeadings(markdown) {
  const { body } = splitFrontmatter(markdown);
  const { text, restore } = protectCode(body);
  const out = [];
  for ( const m of text.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm) ) out.push({ level: m[1].length, text: restore(m[2]).trim() });
  return out;
}

/**
 * Find a heading by Obsidian heading-link text. Obsidian matches the heading's text exactly
 * (case-insensitive); we also accept a unique prefix match ("3a." → "3a. Cold open …").
 */
export function findHeading(headings, wanted) {
  const w = normalizeHeading(wanted);
  if ( !w ) return null;
  const strip = s => normalizeHeading(s).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
  return headings.find(h => normalizeHeading(h.text) === w)
    ?? headings.find(h => strip(h.text) === strip(wanted))
    ?? (() => { const c = headings.filter(h => strip(h.text).startsWith(strip(wanted))); return c.length === 1 ? c[0] : null; })();
}
