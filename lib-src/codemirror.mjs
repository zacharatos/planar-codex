// Entry for the bundled CodeMirror 6 used by the Codex editor (built into lib/codemirror.esm.js by build-lib.sh).
export { EditorState, StateField, StateEffect, RangeSetBuilder, Compartment, Prec, EditorSelection, Transaction } from "@codemirror/state";
export { EditorView, ViewPlugin, Decoration, WidgetType, keymap, drawSelection, highlightActiveLine,
  placeholder, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, scrollPastEnd } from "@codemirror/view";
export { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
export { syntaxTree, syntaxHighlighting, HighlightStyle, LanguageSupport, indentUnit, foldGutter, foldKeymap, ensureSyntaxTree } from "@codemirror/language";
export { markdownLanguage, markdownKeymap, insertNewlineContinueMarkup, deleteMarkupBackward } from "@codemirror/lang-markdown";
export { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
export { autocompletion, completionKeymap, startCompletion, closeCompletion, acceptCompletion, completionStatus, pickedCompletion } from "@codemirror/autocomplete";
export { tags, styleTags, Tag } from "@lezer/highlight";
export { Strikethrough, Table, TaskList, Autolink } from "@lezer/markdown";
export { Language, defineLanguageFacet } from "@codemirror/language";
