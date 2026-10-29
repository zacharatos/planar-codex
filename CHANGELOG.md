# Changelog

All notable changes to this module. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
The release workflow uses the section matching the tag as the GitHub release notes, so keep the `## [x.y.z]` headings exact.

## [0.5.0]

### Added
- **Prompter** (Υποβολέας): a GM panel that runs the session from a deck of beats written in a run-sheet note as `> [!beat|priority|at=…|pc=…|ledger=…|missed=…] Title` callouts.
  - Sections: *Never forget* (`must` beats until played), *Now* (beats something at the table just called for), *The deck*, *Listen for*, beats asleep because their heroes are absent, and what was done tonight.
  - Beats are matched by name against Planar Theater places, NPC cards and title cards (on the stage or over the map), Planar Atlas stops and parts of the day, the active scene; and by moment against session start, Short and Long Rests (dnd5e), combat ending and deaths (Planar Glitch). A notification (and an optional chime) for the GM.
  - Cards show the beat's body with rolls, links, read-aloud and private-line buttons. When every private line on a card has been sent from it, the beat is marked played (setting).
  - Spotlight per hero (beats played, private lines sent, notes), elapsed time and the Planar Atlas clock.
  - Quick notes with tags (Alt+N). A feed of what the other modules saw: private lines sent and read, purse changes, road stops, Heroic Inspiration, deaths and returns, rests, combats.
  - Start and Close the session. Closing asks the run sheet's close-out questions and writes a **Session NN - live log** note with the deck (played, skipped, missed with the next count), the spotlight, the notes, the events and the answers.
  - Starting tells Planar Atlas and Planar Whispers the session number.
  - API: `game.modules.get("planar-codex").api.prompter`.
- Beat callouts in the reading view show their state with ✓ / ✗ / undo buttons and open the Prompter.

### Changed
- `[!beat]` callouts are GM-only, like `[!dm]` and `[!whisper]`: they are left out of the stored player HTML. Stored notes are re-rendered once on the GM's next login.
- The read-aloud and private-line buttons are shared by the note sheet and the Prompter's cards (`decorateCallouts` in `actions.mjs`).

## [0.4.1]

0.4.0 was tagged but never published: its release workflow stopped before building. This release ships everything listed under 0.4.0.

### Fixed
- **Release workflow.** The step that required `module.json`'s version to match the tag is gone; the workflow stamps the version from the tag, as in the other Planar modules.

### Changed
- **Fewer database writes on import and after an update.** Re-importing the vault and the one-time refresh of stored notes after an update now save pages in batches (up to 40 per journal entry per call) instead of one call per page. Each call is a server round trip and a broadcast to every connected player, so a large re-import no longer floods the server.
- CI and release workflows use `actions/checkout@v5` and `actions/setup-node@v5`; CI runs with read-only repository permissions.

### Added
- **Greek interface** (`lang/el.json`).

## [0.4.0]

### Added
- **Planar Whispers.** With that module active, a private line (`> [!whisper] Name`) gets **Whisper**, which opens it full screen on the player's screen until they click it away, and **Queue**, which puts it in the Planar Whispers queue. A `player:` handout gets **Reveal to …**. Without Planar Whispers nothing changes: private lines are whispered in chat.
- Callout options after a `|` (Obsidian callout metadata): `> [!whisper|voice|burn] Name`. Private lines use them for Planar Whispers (style, `burn`, `shiver`, `together=<name>` to send several lines at the same moment); other callouts keep rendering as before.
- A private line can name several players: `> [!whisper] Ilsa, Brannoc`.

### Changed
- **The editor loads only when it's needed.** CodeMirror (~400 KB) used to be downloaded by every player at login; now it loads in the background when someone who can edit a note opens it, so players who never edit never download it.

### Fixed
- A callout written with options (`> [!note|wide]`) was shown as a plain quote; it now renders as its callout, in the reading view and in the editor.
- **Typed links render much faster** (`[[spell:Fireball]]`, `[[actor:…]]`). Each link used to compare its name against every world document and every compendium entry, on every player's browser, every time a page was shown; a prep page with many links in a large world could freeze the browser for a moment. Names are now looked up in a table built once per collection or compendium and refreshed when names change.
- **The link index is no longer rebuilt after every journal edit.** Pages rewritten by other modules (the Glitch Tracker, the casino ledger, the faction page) and ordinary text edits now only refresh the backlinks; the index is rebuilt when a note is added, removed, renamed or moved.

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
