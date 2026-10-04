# Changelog

All notable changes to this module. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
The release workflow uses the section matching the tag as the GitHub release notes, so keep the `## [x.y.z]` headings exact.

## [0.3.0]

### Added
- **Edit in place.** A note turns into an editor where you are reading it and turns back when you are done, scrolled to where you stopped. Start it by double-clicking a paragraph, list item or callout (the cursor lands on the word you clicked), with the pencil next to any heading, with the **Edit** button at the top of the note, with **Ctrl+E**, or with Foundry's own edit control.
- **Live Preview editor** built on CodeMirror 6: Markdown markers stay hidden until the cursor reaches them; headings at their real size; links, rolls ("History (Int) DC 15"), embeds and images shown as chips; tasks as checkboxes; read-aloud, DM and private-line callouts drawn as their coloured boxes; frontmatter folded into a Properties bar. Ctrl+/ switches to plain Markdown source.
- Editor keys: Ctrl+S save, Esc or Ctrl+E done, Ctrl+B / Ctrl+I / Ctrl+Shift+H, Ctrl+K wraps in `[[ ]]`, Ctrl+F find. Enter continues lists, tasks and callouts. Typing `[[` adds the closing `]]`. Ctrl+click opens a link (same-note heading links jump inside the editor).
- Unsaved edits are saved automatically when the note leaves the screen (window closed, page turned); the browser warns before a reload with unsaved edits; a conflict prompt appears if the note changed elsewhere meanwhile.
- Dropping an actor, item, scene or note into the editor inserts a link.
- Settings: *Edit notes in place*, *Double-click to edit*, *Citation prefixes* (which inline-code prefixes render as book references), plus a configurable *Edit the note here* keybinding.
- The GM view tags each block with its source line, which is how the editor opens at the right place.

### Changed
- Autocomplete now works with any editor through a small adapter (Foundry's editor and the new one).
- Foundry's own Markdown editor window stays available from the editor's ↗ button.

## [0.2.0]

### Added
- Autocomplete in the editor: `[[` for notes (by name or alias, accents ignored), world actors, items, scenes, tables, playlists and macros, and dnd5e 2024 spells, monsters and equipment; typed prefixes (`[[spell:`, `[[monster:` …); `[[Note#` for headings; `[[/` for roll helpers with a small form.
- Codex text size setting (per computer).

### Changed
- Reading view redesigned for legibility: one font with full Greek coverage, larger text, clearer callout boxes, labelled action buttons, quieter book-citation chips, zebra tables.
- Markdown engine switched from showdown to marked (fixes blockquotes inside lists).

## [0.1.0]

First release.

### Added
- Import an Obsidian vault into a **Codex** journal folder that mirrors the vault's folders; re-import updates unedited notes and resolves conflicts by a chosen rule; only embedded images are uploaded; a report lists dangling and ambiguous links.
- Obsidian syntax in journal pages: wikilinks (with headings, labels and aliases), typed links to world and compendium documents, embeds, callouts (read-aloud, private line, DM-only, secret, and the generic Obsidian types, foldable), `%%comments%%`, `==highlights==`, clickable tasks, frontmatter properties.
- dnd5e roll enrichers inside notes.
- GM view with DM-only material and backlinks; players get a stored version without it.
- Read-aloud boxes: Show to players, Post to chat. Private lines: whisper to the player who owns the named character. Handouts: share with the player in `player:`.
- Export changed notes back to a zip with the vault's folder layout.

[0.3.0]: https://github.com/zacharatos/planar-codex/releases/tag/v0.3.0
