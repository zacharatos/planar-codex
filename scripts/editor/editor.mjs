/**
 * Planar Codex editor — a CodeMirror 6 Markdown editor that feels like Obsidian's:
 * proportional text, Live Preview (or plain source), Markdown-aware Enter/Backspace, and the usual shortcuts.
 *
 *   Ctrl+B bold · Ctrl+I italic · Ctrl+Shift+H highlight · Ctrl+K link · Ctrl+S save · Esc / Ctrl+E done
 *   Ctrl+F find · Ctrl+Z / Ctrl+Shift+Z undo / redo · Ctrl+/ toggle Live Preview / Source
 */
import {
  EditorState, EditorView, Compartment, Prec, EditorSelection, keymap, drawSelection, highlightActiveLine,
  dropCursor, highlightSpecialChars, history, defaultKeymap, historyKeymap, indentWithTab,
  LanguageSupport, syntaxHighlighting, HighlightStyle, indentUnit, tags,
  markdownKeymap, search, searchKeymap, highlightSelectionMatches, placeholder as placeholderExt
} from "../../lib/codemirror.esm.js";
import { codexMarkdown } from "./syntax.mjs";
import { livePreview } from "./live-preview.mjs";

/** Syntax colours; sizes and layout live in codex.css. */
const codexHighlight = HighlightStyle.define([
  { tag: tags.heading, class: "cm-codex-heading" },
  { tag: tags.strong, class: "cm-codex-strong" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.url, class: "cm-codex-url" },
  { tag: tags.processingInstruction, class: "cm-codex-marker" },
  { tag: tags.quote, class: "cm-codex-quote-text" },
  { tag: tags.meta, class: "cm-codex-meta" },
  { tag: tags.comment, class: "cm-codex-comment" },
  { tag: tags.contentSeparator, class: "cm-codex-marker" }
]);

/* -------------------------------------------- */
/*  Formatting commands                         */
/* -------------------------------------------- */

/** Wrap each selection in markers, or unwrap it if it is already wrapped. */
export function toggleWrap(before, after = before) {
  return view => {
    const { state } = view;
    const tr = state.changeByRange(range => {
      const text = state.sliceDoc(range.from, range.to);
      const outside = state.sliceDoc(range.from - before.length, range.from) === before
        && state.sliceDoc(range.to, range.to + after.length) === after;
      if ( outside ) {
        return {
          changes: [{ from: range.from - before.length, to: range.from }, { from: range.to, to: range.to + after.length }],
          range: EditorSelection.range(range.from - before.length, range.to - before.length)
        };
      }
      if ( text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length ) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(before.length, text.length - after.length) },
          range: EditorSelection.range(range.from, range.to - before.length - after.length)
        };
      }
      return {
        changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
        range: EditorSelection.range(range.from + before.length, range.to + before.length)
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
    return true;
  };
}

/**
 * Typing the second `[` of `[[` adds the closing `]]` (unless it is already there),
 * and typing `]` in front of a `]` steps over it instead of doubling it.
 */
const closeWikilink = EditorView.inputHandler.of((view, from, to, text) => {
  if ( from !== to ) return false;
  const { state } = view;
  if ( text === "]" && state.sliceDoc(from, from + 1) === "]" ) {
    const before = state.doc.lineAt(from);
    const head = state.sliceDoc(before.from, from);
    if ( head.lastIndexOf("[[") > head.lastIndexOf("]]") || head.endsWith("]") ) {
      view.dispatch({ selection: { anchor: from + 1 }, userEvent: "input.type" });
      return true;
    }
  }
  if ( text !== "[" ) return false;
  if ( state.sliceDoc(from - 1, from) !== "[" ) return false;
  if ( state.sliceDoc(from, from + 2) === "]]" ) return false;
  view.dispatch({ changes: { from, insert: "[]]" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
  return true;
});

/* -------------------------------------------- */
/*  Create                                      */
/* -------------------------------------------- */

/**
 * @typedef {object} CodexEditorOptions
 * @property {HTMLElement} parent
 * @property {string} doc                         The note's Markdown.
 * @property {number} [line=0]                    0-based line to put the cursor on.
 * @property {boolean} [source=false]             Start in Source mode instead of Live Preview.
 * @property {import("./live-preview.mjs").PreviewConfig} [preview]
 * @property {(md: string) => void|Promise<void>} [onSave]   Ctrl+S.
 * @property {() => void} [onDone]                Esc / Ctrl+E.
 * @property {(dirty: boolean) => void} [onChange]
 * @property {(view: EditorView) => void} [onReady]
 * @property {(event: DragEvent, view: EditorView) => boolean} [onDrop]
 * @property {string} [placeholder]
 * @property {object[]} [extensions]              Extra CodeMirror extensions.
 */

/**
 * Build a Codex editor.
 * @param {CodexEditorOptions} options
 * @returns {{view: EditorView, getValue: () => string, isDirty: () => boolean, markSaved: (md?: string) => void,
 *   setSource: (on: boolean) => void, isSource: () => boolean, focusLine: (line: number) => void, destroy: () => void}}
 */
export function createCodexEditor(options) {
  const { parent, doc, line = 0, source = false, preview = {}, onSave, onDone, onChange, onDrop } = options;
  let saved = doc;
  const previewSlot = new Compartment();
  const modeExt = on => on ? [] : livePreview(preview);

  const codexKeys = [
    { key: "Mod-s", preventDefault: true, run: view => { onSave?.(view.state.doc.toString()); return true; } },
    { key: "Escape", run: () => { onDone?.(); return true; } },
    { key: "Mod-e", preventDefault: true, run: () => { onDone?.(); return true; } },
    { key: "Mod-b", preventDefault: true, run: toggleWrap("**") },
    { key: "Mod-i", preventDefault: true, run: toggleWrap("*") },
    { key: "Mod-Shift-h", preventDefault: true, run: toggleWrap("==") },
    { key: "Mod-k", preventDefault: true, run: toggleWrap("[[", "]]") },
    { key: "Mod-/", preventDefault: true, run: () => { api.setSource(!api.isSource()); return true; } }
  ];

  let sourceMode = source;
  const state = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [
      new LanguageSupport(codexMarkdown),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      history(),
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "off", autocapitalize: "sentences" }),
      syntaxHighlighting(codexHighlight),
      closeWikilink,
      previewSlot.of(modeExt(source)),
      Prec.highest(keymap.of(codexKeys)),
      keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      options.placeholder ? placeholderExt(options.placeholder) : [],
      EditorView.updateListener.of(u => { if ( u.docChanged ) onChange?.(u.state.doc.toString() !== saved); }),
      EditorView.domEventHandlers({
        drop: (event, view) => onDrop ? onDrop(event, view) : false,
        // Keep Foundry's global shortcuts (Esc closes windows, number keys, etc.) out of the editor.
        keydown: event => { event.stopPropagation(); return false; }
      }),
      options.extensions ?? []
    ]
  });

  const view = new EditorView({ state, parent });

  const api = {
    view,
    getValue: () => view.state.doc.toString(),
    isDirty: () => view.state.doc.toString() !== saved,
    markSaved: md => { saved = md ?? view.state.doc.toString(); onChange?.(api.isDirty()); },
    isSource: () => sourceMode,
    setSource: on => {
      sourceMode = !!on;
      view.dispatch({ effects: previewSlot.reconfigure(modeExt(sourceMode)) });
      parent.classList.toggle("cm-codex-source", sourceMode);
      options.onModeChange?.(sourceMode);
    },
    /** Put the cursor at the start of a 0-based line. */
    focusLine: (n, { scroll = true } = {}) => {
      const total = view.state.doc.lines;
      const ln = view.state.doc.line(Math.min(Math.max(1, n + 1), total));
      view.dispatch({ selection: { anchor: ln.from }, scrollIntoView: scroll });
      view.focus();
    },
    destroy: () => view.destroy()
  };
  parent.classList.toggle("cm-codex-source", sourceMode);

  // Initial cursor (no scrolling: the caller lines the editor up with what was on screen).
  const total = view.state.doc.lines;
  const ln = view.state.doc.line(Math.min(Math.max(1, line + 1), total));
  view.dispatch({ selection: { anchor: ln.from } });
  options.onReady?.(view);
  return api;
}
