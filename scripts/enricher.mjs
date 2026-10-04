/**
 * Planar Codex — text enrichers.
 *   @Codex[Note#Heading]{label}   a note link (resolved by title, alias or path at render time)
 *   @Codex[actor:Brannoc]{Brannoc}    a typed link to a world or compendium document
 *   @CodexEmbed[Note#Heading]     a note (or one section of it) shown inline
 */
import { MODULE_ID, codexPageOf, convert, getMarkdown, isCodexPage, localize } from "./codex.mjs";
import { linkIndex } from "./link-index.mjs";
import { escapeHTML, splitFrontmatter } from "./markdown.mjs";

const TextEditorImpl = () => foundry.applications.ux.TextEditor.implementation;

export function registerEnrichers() {
  CONFIG.TextEditor.enrichers.push(
    {
      id: `${MODULE_ID}-link`,
      pattern: /@Codex\[([^\]\n]+)\](?:\{([^}\n]*)\})?/g,
      enricher: enrichLink,
      onRender: onRenderLink
    },
    {
      id: `${MODULE_ID}-embed`,
      pattern: /@CodexEmbed\[([^\]\n]+)\]/g,
      enricher: enrichEmbed,
      replaceParent: true
    }
  );
}

function splitTarget(raw) {
  const hash = raw.indexOf("#");
  if ( hash < 0 ) return { target: raw.trim(), heading: null };
  return { target: raw.slice(0, hash).trim(), heading: raw.slice(hash + 1).replace(/^\^/, "").trim() || null };
}

async function enrichLink(match, options = {}) {
  const raw = match[1];
  const label = match[2] || null;
  const typed = raw.match(/^([A-Za-z]+):(.+)$/);
  if ( typed ) {
    const prefix = typed[1].toLowerCase();
    const name = typed[2].trim();
    const uuid = await linkIndex.resolveTyped(prefix, name);
    if ( uuid ) return coreLink(uuid, null, label ?? name, options);
    return unresolved(label ?? name, raw, "typed");
  }
  const { target, heading } = splitTarget(raw);
  const from = options.relativeTo?.documentName === "JournalEntryPage" ? options.relativeTo : null;
  const page = target ? linkIndex.resolvePage(target, from) : from;
  if ( !page ) {
    const a = unresolved(label ?? target, raw, "note");
    if ( from ) a.dataset.codexFrom = from.uuid;
    return a;
  }
  const slug = heading ? linkIndex.headingSlug(page, heading) : null;
  return coreLink(page.uuid, slug, label ?? (heading ?? page.parent.name), options);
}

/** Let Foundry build the content link itself, so clicks, drags, tooltips and anchors behave like core links. */
async function coreLink(uuid, slug, label, options) {
  const text = `@UUID[${uuid}${slug ? `#${slug}` : ""}]{${String(label).replace(/[{}]/g, "")}}`;
  const html = await TextEditorImpl().enrichHTML(text, { relativeTo: options.relativeTo, custom: false, rolls: false, embeds: false });
  const span = document.createElement("span");
  span.innerHTML = html;
  const a = span.querySelector("a");
  if ( !a ) return span.firstElementChild ?? null;
  a.classList.add("codex-link");
  return a;
}

function unresolved(label, raw, kind) {
  const a = document.createElement("a");
  a.className = `codex-link codex-unresolved codex-unresolved-${kind}`;
  a.dataset.codexTarget = raw;
  a.dataset.codexKind = kind;
  a.dataset.tooltip = kind === "note" ? localize("Link.CreateTooltip") : localize("Link.TypedMissing");
  a.innerHTML = `<i class="fa-solid fa-link-slash"></i> ${escapeHTML(label)}`;
  return a;
}

/** Clicking an unresolved note link offers to create the note next to the page that links to it. */
function onRenderLink(element) {
  const a = element.matches?.("a.codex-unresolved-note") ? element : element.querySelector?.("a.codex-unresolved-note");
  if ( !a ) return;
  a.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if ( !game.user.isGM ) return;
    const { target } = splitTarget(a.dataset.codexTarget);
    const name = target.split("/").pop();
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("Link.CreateTitle") },
      content: `<p>${localize("Link.CreatePrompt", { name: escapeHTML(name) })}</p>`
    });
    if ( !ok ) return;
    const hostPage = a.dataset.codexFrom ? fromUuidSync(a.dataset.codexFrom) : null;
    const folder = hostPage?.parent?.folder ?? null;
    const { createCodexNote } = await import("./notes.mjs");
    const page = await createCodexNote({ name, folder: folder?.id ?? null });
    page?.parent?.sheet.render(true, { pageId: page.id });
  });
}

/* -------------------------------------------- */
/*  Embeds                                      */
/* -------------------------------------------- */

async function enrichEmbed(match, options = {}) {
  const { target, heading } = splitTarget(match[1]);
  const depth = options._codexEmbedDepth ?? 0;
  const from = options.relativeTo?.documentName === "JournalEntryPage" ? options.relativeTo : null;
  const page = target ? linkIndex.resolvePage(target, from) : from;
  const box = document.createElement("div");
  box.className = "codex-embed";
  if ( !page ) {
    box.classList.add("codex-embed-missing");
    box.innerHTML = `<i class="fa-solid fa-link-slash"></i> ${escapeHTML(match[1])}`;
    return box;
  }
  if ( depth >= 2 || !page.testUserPermission(game.user, "OBSERVER") ) {
    return coreLink(page.uuid, heading ? linkIndex.headingSlug(page, heading) : null, heading ?? page.parent.name, options);
  }
  let html;
  if ( isCodexPage(page) ) {
    const gm = game.user.isGM;
    let md = getMarkdown(page);
    if ( heading ) md = sliceSection(md, heading) ?? md;
    html = convert(md, { gm, page }).html;
    if ( gm ) html = html.replace(/^<details class="codex-properties">[\s\S]*?<\/details>/, "");
  } else html = page.text?.content ?? "";
  const enriched = await TextEditorImpl().enrichHTML(html, {
    ...options, relativeTo: page, secrets: page.isOwner, _codexEmbedDepth: depth + 1
  });
  const title = document.createElement("header");
  title.className = "codex-embed-title";
  const link = await coreLink(page.uuid, null, heading ? `${page.parent.name} › ${heading}` : page.parent.name, options);
  if ( link ) title.append(link);
  const body = document.createElement("div");
  body.className = "codex-embed-content";
  body.innerHTML = enriched;
  box.append(title, body);
  return box;
}

/** The Markdown of one heading's section (heading included), or null. */
export function sliceSection(markdown, heading) {
  const { body } = splitFrontmatter(markdown);
  const lines = body.split("\n");
  const norm = s => s.replace(/[*_`]/g, "").trim().toLowerCase();
  const want = norm(heading);
  let start = -1, level = 0;
  for ( let i = 0; i < lines.length; i++ ) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if ( !m ) continue;
    if ( start < 0 && (norm(m[2]) === want || norm(m[2]).startsWith(want)) ) { start = i; level = m[1].length; continue; }
    if ( start >= 0 && m[1].length <= level ) return lines.slice(start, i).join("\n");
  }
  return start >= 0 ? lines.slice(start).join("\n") : null;
}

export { codexPageOf };
