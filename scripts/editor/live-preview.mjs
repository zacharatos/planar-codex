/**
 * Planar Codex editor — Live Preview.
 *
 * Like Obsidian: Markdown markers stay hidden and links, rolls, tasks and callouts look like they do when reading,
 * until the cursor reaches them. Block markers (#, >, -) show on the cursor's line; inline syntax ([[…]], **…**,
 * `…`, ==…==) shows while the cursor touches it.
 */
import {
  ViewPlugin, Decoration, WidgetType, StateField, EditorView, syntaxTree
} from "../../lib/codemirror.esm.js";
import {
  parseWikilink, wikilinkLabel, describeRoll, isRollContent, isAssetTarget, basename,
  splitFrontmatter, CALLOUT_ALIASES, CITATION_RE, escapeHTML
} from "../markdown.mjs";
import { WIKILINK_RE, FOUNDRY_RE } from "./syntax.mjs";

/**
 * @typedef {object} PreviewConfig
 * @property {(link: object) => boolean} [isResolved]   Does a wikilink point at something that exists?
 * @property {(name: string) => string|null} [assetURL] URL for an embedded image.
 * @property {(target: {kind: string, raw: string, link?: object}) => void} [openLink]  Ctrl/Cmd-click on a link.
 */

const CALLOUT_RE = /^(\s*(?:>\s?)+)\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]?/;

const CALLOUT_LABELS = { readaloud: "Read-aloud", dm: "DM only", whisper: "Private line", secret: "Secret" };
const CALLOUT_ICONS = {
  readaloud: "fa-solid fa-book-open-reader", dm: "fa-solid fa-lock", whisper: "fa-solid fa-user-secret",
  secret: "fa-solid fa-eye-slash", note: "fa-solid fa-pen", info: "fa-solid fa-circle-info", tip: "fa-solid fa-lightbulb",
  warning: "fa-solid fa-triangle-exclamation", danger: "fa-solid fa-skull", quote: "fa-solid fa-quote-left",
  question: "fa-solid fa-circle-question", todo: "fa-solid fa-square-check", example: "fa-solid fa-list"
};
const TYPE_ICONS = {
  actor: "fa-solid fa-user", npc: "fa-solid fa-user", pc: "fa-solid fa-user", monster: "fa-solid fa-dragon",
  creature: "fa-solid fa-dragon", item: "fa-solid fa-suitcase", equipment: "fa-solid fa-shield-halved",
  weapon: "fa-solid fa-khanda", armor: "fa-solid fa-shield-halved", spell: "fa-solid fa-wand-sparkles",
  feat: "fa-solid fa-star", feature: "fa-solid fa-star", scene: "fa-solid fa-map", table: "fa-solid fa-table-list",
  rolltable: "fa-solid fa-table-list", journal: "fa-solid fa-book", playlist: "fa-solid fa-music", macro: "fa-solid fa-code"
};

export function calloutKind(type) {
  const t = String(type).toLowerCase();
  return CALLOUT_ALIASES[t] ?? t;
}

/* -------------------------------------------- */
/*  Widgets                                     */
/* -------------------------------------------- */

class ChipWidget extends WidgetType {
  /** @param {{label: string, icon: string, cls: string, title?: string}} spec */
  constructor(spec) { super(); this.spec = spec; }
  eq(other) { return other.spec.label === this.spec.label && other.spec.cls === this.spec.cls && other.spec.icon === this.spec.icon; }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-codex-chip ${this.spec.cls}`;
    if ( this.spec.title ) span.title = this.spec.title;
    span.innerHTML = `${this.spec.icon ? `<i class="${this.spec.icon}"></i>` : ""}<span>${escapeHTML(this.spec.label)}</span>`;
    return span;
  }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(url, alt, width) { super(); this.url = url; this.alt = alt; this.width = width; }
  eq(other) { return other.url === this.url && other.width === this.width; }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-codex-image";
    const img = document.createElement("img");
    img.src = this.url;
    img.alt = this.alt;
    if ( this.width ) img.style.width = `${this.width}px`;
    wrap.append(img);
    return wrap;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-codex-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(other) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-codex-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", ev => {
      ev.preventDefault();
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class CalloutLabelWidget extends WidgetType {
  constructor(kind, hasTitle) { super(); this.kind = kind; this.hasTitle = hasTitle; }
  eq(other) { return other.kind === this.kind && other.hasTitle === this.hasTitle; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-codex-callout-label";
    const label = CALLOUT_LABELS[this.kind] ?? (this.kind.charAt(0).toUpperCase() + this.kind.slice(1));
    const showLabel = !this.hasTitle || this.kind === "whisper";
    span.innerHTML = `<i class="${CALLOUT_ICONS[this.kind] ?? "fa-solid fa-bookmark"}"></i>${showLabel ? `<span>${escapeHTML(label)}${this.hasTitle ? " ·" : ""}</span>` : ""}`;
    return span;
  }
  ignoreEvent() { return false; }
}

class PropertiesWidget extends WidgetType {
  constructor(summary) { super(); this.summary = summary; }
  eq(other) { return other.summary === this.summary; }
  toDOM() {
    const div = document.createElement("div");
    div.className = "cm-codex-properties";
    div.innerHTML = `<i class="fa-solid fa-list"></i><span class="cm-codex-properties-label">Properties</span><span class="cm-codex-properties-summary">${escapeHTML(this.summary)}</span>`;
    return div;
  }
  ignoreEvent() { return false; }
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const hide = Decoration.replace({});
const lineDeco = cls => Decoration.line({ class: cls });
const markDeco = cls => Decoration.mark({ class: cls });

/** Lines the selection covers (when the editor has focus). */
function activeLines(state, focused) {
  const lines = new Set();
  if ( !focused ) return lines;
  for ( const r of state.selection.ranges ) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for ( let n = a; n <= b; n++ ) lines.add(n);
  }
  return lines;
}

function touches(state, focused, from, to) {
  if ( !focused ) return false;
  return state.selection.ranges.some(r => r.from <= to && r.to >= from);
}

/** The chip for a [[wikilink]], ![[embed]] or roll. */
function wikiChip(text, config) {
  const m = WIKILINK_RE.exec(text);
  if ( !m ) return null;
  const [, bang, inner, rollLabel] = m;
  if ( isRollContent(inner) ) {
    const label = rollLabel ? rollLabel.slice(1, -1) : describeRoll(inner);
    const gm = /^\/(gmr|gmroll|br|blindroll|sr|selfroll)\b/i.test(inner.trim());
    return new ChipWidget({ label, icon: "fa-solid fa-dice-d20", cls: `cm-codex-roll${gm ? " cm-codex-roll-gm" : ""}`, title: `[[${inner}]]` });
  }
  const link = parseWikilink(inner);
  if ( bang ) {
    if ( isAssetTarget(link.target) ) {
      const url = config.assetURL?.(basename(link.target)) ?? config.assetURL?.(link.target) ?? null;
      const width = link.label && /^\d+/.test(link.label) ? Number(link.label.match(/^\d+/)[0]) : null;
      if ( url && IMAGE_EXT.test(link.target) ) return new ImageWidget(url, basename(link.target), width);
      return new ChipWidget({ label: basename(link.target), icon: "fa-solid fa-image", cls: url ? "cm-codex-embed" : "cm-codex-embed cm-codex-unresolved" });
    }
    return new ChipWidget({ label: wikilinkLabel(link), icon: "fa-solid fa-file-import", cls: "cm-codex-embed", title: `Embedded: ${link.target}` });
  }
  const resolved = config.isResolved ? config.isResolved(link) : true;
  const icon = link.type ? (TYPE_ICONS[link.type] ?? "fa-solid fa-link") : (link.target ? "" : "fa-solid fa-hashtag");
  return new ChipWidget({ label: wikilinkLabel(link), icon, cls: `cm-codex-link${link.type ? ` cm-codex-link-${link.type}` : ""}${resolved ? "" : " cm-codex-unresolved"}` });
}
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i;

function foundryChip(text) {
  const m = /^([@&])([A-Za-z]+)\[([^\]\n]+)\](?:\{([^}\n]*)\})?/.exec(text);
  if ( !m ) return null;
  const [, sigil, kind, target, label] = m;
  const shown = label || (kind === "Reference" ? target : target.split(".").pop());
  const icon = sigil === "&" ? "fa-solid fa-book" : kind === "UUID" ? uuidIcon(target) : "fa-solid fa-link";
  return new ChipWidget({ label: shown, icon, cls: "cm-codex-link cm-codex-foundry", title: text });
}

function uuidIcon(uuid) {
  const type = String(uuid).split(".").at(-2) ?? "";
  return { Actor: "fa-solid fa-user", Item: "fa-solid fa-suitcase", Scene: "fa-solid fa-map", JournalEntry: "fa-solid fa-book",
    JournalEntryPage: "fa-solid fa-file-lines", RollTable: "fa-solid fa-table-list", Playlist: "fa-solid fa-music",
    Macro: "fa-solid fa-code" }[type] ?? "fa-solid fa-link";
}

/* -------------------------------------------- */
/*  Inline + line decorations (visible range)   */
/* -------------------------------------------- */

/**
 * Build the Live Preview decorations for the visible part of the document.
 * @param {import("@codemirror/view").EditorView} view
 * @param {PreviewConfig} config
 */
export function buildDecorations(view, config) {
  return computeDecorations(view.state, view.visibleRanges, view.hasFocus, config);
}

/** Pure version (testable without a DOM): state + ranges → DecorationSet. */
export function computeDecorations(state, ranges, focused, config = {}) {
  const out = [];
  const doc = state.doc;
  const lines = activeLines(state, focused);
  const onActive = pos => lines.has(doc.lineAt(pos).number);
  const tree = syntaxTree(state);
  const seenLines = new Set();
  const addLine = (pos, cls) => {
    const line = doc.lineAt(pos);
    const key = `${line.from}|${cls}`;
    if ( seenLines.has(key) ) return;
    seenLines.add(key);
    out.push(lineDeco(cls).range(line.from));
  };
  const eachLine = (from, to, fn) => {
    for ( let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      fn(line);
      pos = line.to + 1;
    }
  };

  for ( const { from, to } of ranges ) {
    tree.iterate({
      from, to,
      enter: node => {
        const name = node.name;

        // Headings
        let h = /^ATXHeading(\d)$/.exec(name);
        if ( h ) {
          addLine(node.from, `cm-codex-h cm-codex-h${h[1]}`);
          return;
        }
        if ( name === "HeaderMark" && node.node.parent?.name.startsWith("ATXHeading") ) {
          if ( !onActive(node.from) ) {
            let end = node.to;
            while ( doc.sliceString(end, end + 1) === " " ) end++;
            if ( end > node.from ) out.push(hide.range(node.from, end));
          }
          return;
        }
        h = /^SetextHeading(\d)$/.exec(name);
        if ( h ) { addLine(node.from, `cm-codex-h cm-codex-h${h[1]}`); return; }

        // Block quotes and callouts (style from the outermost quote)
        if ( name === "Blockquote" ) {
          let outer = node.node.parent;
          while ( outer && outer.name !== "Blockquote" ) outer = outer.parent;
          if ( outer ) return;
          const first = doc.lineAt(node.from);
          const cm = CALLOUT_RE.exec(first.text);
          const kind = cm ? calloutKind(cm[2]) : null;
          const base = kind ? `cm-codex-callout codex-callout-${kind}` : "cm-codex-quote";
          const last = doc.lineAt(Math.max(node.from, node.to - 1)).number;
          eachLine(node.from, node.to - 1, line => {
            let cls = base;
            if ( line.number === first.number ) cls += " cm-codex-quote-first";
            if ( line.number === last ) cls += " cm-codex-quote-last";
            if ( kind && line.number === first.number ) cls += " cm-codex-callout-head";
            addLine(line.from, cls);
          });
          if ( cm && !onActive(first.from) ) {
            const start = first.from + cm[1].length;
            const end = first.from + cm[0].length;
            const hasTitle = first.text.slice(cm[0].length).trim().length > 0;
            out.push(Decoration.replace({ widget: new CalloutLabelWidget(kind, hasTitle) }).range(start, end));
          }
          return;
        }
        if ( name === "QuoteMark" ) {
          if ( !onActive(node.from) ) {
            const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            // The callout header's marks are covered by the label widget's range start, so only hide up to it.
            out.push(hide.range(node.from, end));
          }
          return;
        }

        // Lists and tasks
        if ( name === "ListMark" ) {
          const parent = node.node.parent;
          const list = parent?.parent;
          const task = parent?.getChild("Task");
          const marker = task?.getChild("TaskMarker");
          if ( marker ) {
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            if ( !touches(state, focused, node.from, marker.to) ) {
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked, marker.from + 1) }).range(node.from, marker.to));
            }
            if ( checked ) {
              const line = doc.lineAt(node.from);
              out.push(markDeco("cm-codex-task-done").range(marker.to, line.to));
            }
            return;
          }
          if ( list?.name === "BulletList" && !onActive(node.from) ) {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          return;
        }

        // Rules, code blocks, tables
        if ( name === "HorizontalRule" ) {
          addLine(node.from, "cm-codex-hr");
          if ( !onActive(node.from) ) out.push(hide.range(node.from, node.to));
          return;
        }
        if ( name === "FencedCode" || name === "CodeBlock" ) {
          const lastLine = doc.lineAt(Math.max(node.from, node.to - 1)).number;
          eachLine(node.from, node.to - 1, line => {
            let cls = "cm-codex-codeblock";
            if ( line.from === doc.lineAt(node.from).from ) cls += " cm-codex-codeblock-first";
            if ( line.number === lastLine ) cls += " cm-codex-codeblock-last";
            addLine(line.from, cls);
          });
          return false;
        }
        if ( name === "Table" ) {
          eachLine(node.from, node.to - 1, line => addLine(line.from, "cm-codex-table"));
          return;
        }
        if ( name === "Frontmatter" ) return false;

        // Inline: emphasis, strike, highlight, code
        if ( name === "Emphasis" || name === "StrongEmphasis" || name === "Strikethrough" || name === "Highlight" ) {
          if ( name === "Highlight" ) out.push(markDeco("cm-codex-mark").range(node.from, node.to));
          if ( !touches(state, focused, node.from, node.to) ) {
            for ( let child = node.node.firstChild; child; child = child.nextSibling ) {
              if ( /Mark$/.test(child.name) && child.name !== "QuoteMark" ) out.push(hide.range(child.from, child.to));
            }
          }
          return;
        }
        if ( name === "InlineCode" ) {
          const marks = node.node.getChildren("CodeMark");
          if ( marks.length < 2 ) return false;
          const inner = doc.sliceString(marks[0].to, marks[marks.length - 1].from);
          const cite = CITATION_RE.test(inner.trim());
          if ( marks[0].to < marks[marks.length - 1].from ) {
            out.push(markDeco(cite ? "cm-codex-cite" : "cm-codex-code").range(marks[0].to, marks[marks.length - 1].from));
          }
          if ( !touches(state, focused, node.from, node.to) ) {
            out.push(hide.range(marks[0].from, marks[0].to));
            out.push(hide.range(marks[marks.length - 1].from, marks[marks.length - 1].to));
          }
          return false;
        }

        // Links
        if ( name === "Link" ) {
          const url = node.node.getChild("URL");
          if ( !url ) return false;                       // [!callout] and reference links stay as typed
          const marks = node.node.getChildren("LinkMark");
          if ( marks.length >= 2 ) out.push(markDeco("cm-codex-extlink").range(marks[0].to, marks[1].from));
          if ( !touches(state, focused, node.from, node.to) && marks.length >= 2 ) {
            out.push(hide.range(marks[0].from, marks[0].to));
            out.push(hide.range(marks[1].from, node.to));
          }
          return false;
        }
        if ( name === "WikiLink" || name === "Embed" ) {
          const text = doc.sliceString(node.from, node.to);
          if ( touches(state, focused, node.from, node.to) ) {
            out.push(markDeco("cm-codex-wikilink-src").range(node.from, node.to));
            return false;
          }
          const widget = wikiChip(text, config);
          if ( widget ) out.push(Decoration.replace({ widget }).range(node.from, node.to));
          return false;
        }
        if ( name === "FoundryLink" ) {
          if ( touches(state, focused, node.from, node.to) ) return false;
          const widget = foundryChip(doc.sliceString(node.from, node.to));
          if ( widget ) out.push(Decoration.replace({ widget }).range(node.from, node.to));
          return false;
        }
        if ( name === "CodexComment" ) {
          out.push(markDeco("cm-codex-comment").range(node.from, node.to));
          return false;
        }
      }
    });
  }
  return Decoration.set(out, true);
}

/* -------------------------------------------- */
/*  Frontmatter: collapsed into a Properties bar */
/* -------------------------------------------- */

export function frontmatterRange(doc) {
  const head = doc.sliceString(0, Math.min(doc.length, 20000));
  const m = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?=\n|$)/.exec(head);
  return m ? { from: 0, to: m[0].length } : null;
}

function frontmatterDecorations(state) {
  const range = frontmatterRange(state.doc);
  if ( !range ) return Decoration.none;
  const inside = state.selection.ranges.some(r => r.from <= range.to && r.to >= range.from);
  if ( inside ) {
    const decos = [];
    for ( let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      decos.push(lineDeco("cm-codex-frontmatter").range(line.from));
      pos = line.to + 1;
    }
    return Decoration.set(decos);
  }
  const { data } = splitFrontmatter(state.doc.sliceString(range.from, range.to) + "\n");
  const summary = Object.entries(data).slice(0, 6).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("  ·  ");
  return Decoration.set([Decoration.replace({ widget: new PropertiesWidget(summary), block: true }).range(range.from, range.to)]);
}

const frontmatterField = StateField.define({
  create: state => frontmatterDecorations(state),
  update(value, tr) {
    if ( !tr.docChanged && !tr.selection ) return value;
    return frontmatterDecorations(tr.state);
  },
  provide: f => EditorView.decorations.from(f)
});

/* -------------------------------------------- */
/*  Ctrl/Cmd-click opens links                  */
/* -------------------------------------------- */

/** The link-ish syntax node at a document position, if any. */
export function linkAt(state, pos) {
  const tree = syntaxTree(state);
  for ( const side of [1, -1] ) {
    for ( let node = tree.resolveInner(pos, side); node; node = node.parent ) {
      if ( ["WikiLink", "Embed", "FoundryLink", "Link", "URL", "Autolink"].includes(node.name) ) {
        const raw = state.doc.sliceString(node.from, node.to);
        if ( node.name === "WikiLink" || node.name === "Embed" ) {
          const m = WIKILINK_RE.exec(raw);
          if ( !m ) return null;
          return { kind: isRollContent(m[2]) ? "roll" : (node.name === "Embed" ? "embed" : "wikilink"), raw, link: parseWikilink(m[2]), from: node.from, to: node.to };
        }
        if ( node.name === "FoundryLink" ) {
          const m = FOUNDRY_RE.exec(raw);
          return m ? { kind: "foundry", raw, from: node.from, to: node.to } : null;
        }
        const url = node.name === "Link" ? node.getChild("URL") : node;
        if ( url ) return { kind: "url", raw: state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, ""), from: node.from, to: node.to };
      }
    }
  }
  return null;
}

/* -------------------------------------------- */
/*  Extension                                   */
/* -------------------------------------------- */

/**
 * Live Preview as one extension.
 * @param {PreviewConfig} config
 */
export function livePreview(config = {}) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = buildDecorations(view, config); }
    update(u) {
      if ( u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged
        || syntaxTree(u.startState) !== syntaxTree(u.state) ) this.decorations = buildDecorations(u.view, config);
    }
  }, { decorations: v => v.decorations });

  const clicks = EditorView.domEventHandlers({
    mousedown(event, view) {
      if ( !(event.ctrlKey || event.metaKey) || event.button !== 0 ) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if ( pos == null ) return false;
      const target = linkAt(view.state, pos);
      if ( !target || !config.openLink ) return false;
      event.preventDefault();
      config.openLink(target);
      return true;
    }
  });

  return [plugin, frontmatterField, clicks];
}
