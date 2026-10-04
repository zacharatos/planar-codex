# Development

## Layout

```
module.json              manifest (id = planar-codex; the id is permanent once published)
scripts/
  main.mjs               init/setup/ready hooks, settings, keybinding, journal-directory buttons, public API
  codex.mjs              Foundry-side helpers: convert a page, store Markdown + player HTML, flags
  markdown.mjs           pure Markdown → HTML converter (Obsidian syntax, callouts, secrets, citations), unit-tested
  sheet.mjs              CodexMarkdownSheet (subclass of Foundry's Markdown page sheet): GM view, buttons, tasks
  inline-edit.mjs        edit in place: sessions, scroll alignment, saving, double-click / pencil / Ctrl+E entry points
  editor/
    editor.mjs           CodeMirror 6 editor: extensions, keymap, formatting commands
    syntax.mjs           Markdown grammar + frontmatter, [[wikilinks]], ==highlight==, %%comments%%, @UUID links
    live-preview.mjs     Live Preview decorations (pure computeDecorations + view plugin), Ctrl+click links
  autocomplete.mjs       [[ suggestions and the roll-helper dialog; works with any editor through an adapter
  enricher.mjs           @Codex[…] and @CodexEmbed[…] text enrichers
  link-index.mjs         index of Codex notes: link resolution, typed links, backlinks
  resolver.mjs           pure note-name resolution (paths, aliases, nearest folder)
  importer.mjs           Import vault window and logic
  exporter.mjs           Export vault window and logic
  vault.mjs              pure import planning, diffing, export rewriting
  actions.mjs            Show to players, Post to chat, whisper, share; module socket
  notes.mjs              create notes, the Codex root folder
  zip.mjs                tiny ZIP writer used by the exporter
styles/codex.css         reading view, editor and window styles
lang/en.json             interface strings (keys under PLANARCODEX.*)
lib/                     vendored browser builds: codemirror.esm.js, marked.esm.js (+ licences)
lib-src/codemirror.mjs   the CodeMirror entry point lib/codemirror.esm.js is built from
test/                    node:test unit tests, helpers, and the browser harness (test/harness/)
tools/                   package, stamp-manifest, release-api, build-lib, serve, vault-check, heading-check
.github/workflows/       ci.yml, release.yml
```

Foundry loads `scripts/main.mjs` directly; there is no build step for the module code. The only generated files are the two vendored libraries in `lib/`, which are committed.

## Set up

```
npm ci
```

Node 20 or newer.

## Run the checks

```
npm test
```

Runs ESLint, then the tests: the Markdown converter, the resolver, import/export planning, the editor grammar and Live Preview decorations (CodeMirror runs headless in Node), manifest and language checks (every string the code asks for exists in `lang/en.json`; versions in `module.json`, `package.json` and `CHANGELOG.md` agree), and the release tools.

These tests do not start Foundry. Anything that touches sheets, journals or sockets has to be tried by hand (see below).

### Browser harness

`test/harness/index.html` is a stand-in journal page with stubbed Foundry globals and a sample note (`test/harness/note.md`). It loads the real module code, so you can try the reading view, double-click editing, Live Preview, autocomplete and saving without Foundry:

```
npm run harness
```

then open <http://localhost:8765/test/harness/>. Add `?flat=1` to the URL to test notes whose blocks sit directly in the page element.

### Check a vault

```
npm run check:vault -- "/path/to/your/vault"
node tools/heading-check.mjs "/path/to/your/vault"
```

Converts every note in both views and reports leftover tokens, dangling links and heading links that don't resolve.

## Vendored libraries

`lib/codemirror.esm.js` is an esbuild bundle of only the CodeMirror pieces listed in `lib-src/codemirror.mjs`; `lib/marked.esm.js` is marked's own ESM build. After changing `lib-src/codemirror.mjs` or upgrading either package:

```
npm run build:lib
```

and commit `lib/`. CI rebuilds both from `package-lock.json` and fails if the committed files differ.

## Try it in Foundry

Link (or copy) the repo into your user data as `Data/modules/planar-codex/` and restart Foundry:

```
# macOS / Linux
ln -s /path/to/repo /path/to/FoundryData/Data/modules/planar-codex
# Windows (PowerShell, as administrator)
New-Item -ItemType SymbolicLink -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\planar-codex" -Target C:\path\to\repo
```

Reload the browser tab (F5) after each change; there is no hot reload. To test a release build instead, run `npm run package` and unzip `dist/module.zip` into `Data/modules/planar-codex/`.

### Manual test checklist

Import and export
- Import a vault with nested folders, images and a few notes changed on both sides: folders mirror the vault, embedded images show, the report lists dangling links, the conflict choice is honoured.
- Export: the zip holds only changed notes with the vault's paths; `@UUID` links to world documents become typed `[[actor:…]]` links.

Reading view (as GM, then as a player)
- Wikilinks, heading links, typed links and embeds open the right document/section; an unresolved link offers to create the note.
- Read-aloud: Show to players opens the pop-up for every player; Post to chat posts it. Private line: Whisper reaches only the owner of the named character. Handout `player:` shows the Share button.
- Secrets reveal and stay revealed after the note is edited.
- Tasks tick and the tick survives a reload.
- As a player: no DM boxes, private lines, comments, properties, pencils or Edit button.

Editing
- Double-click a paragraph, a list item, a line inside a callout and a table row: the editor opens at that line, at the same height on screen.
- Heading pencil, Edit button, Ctrl+E and Foundry's own edit control all open in place; with *Edit notes in place* off, Foundry's control opens its window.
- Live Preview: markers hide away from the cursor and show under it; links, rolls, tasks, callouts, images and the Properties bar render; Ctrl+/ switches to Source.
- Autocomplete: `[[`, `[[spell:`, `[[Note#`, `[[/` (roll form inserts an enricher).
- Ctrl+S keeps editing; Esc and Done save and return to the same place; Discard asks first.
- Close the journal, or turn the page, with unsaved edits: they are saved and a notification says so.
- Edit the same note in two browsers: the second save asks before overwriting.
- Drop an actor, an item and a Codex note into the editor.
- Pop the journal out (V14 pop-out): editing and autocomplete work in the pop-out window.

## Changing things

- **New user-facing text**: add the key to `lang/en.json`. The manifest test fails if the code asks for a key that does not exist.
- **New pure logic**: put it in `markdown.mjs`, `resolver.mjs` or `vault.mjs` with a test; keep Foundry globals out of those files.
- **Converter output changes** (what players see): bump `CONTENT_VERSION` in `main.mjs` so stored player HTML is rebuilt once on the GM's next login.
- **Data**: imported notes keep their vault path in `flags.planar-codex.path` and import hash in `flags.planar-codex.importHash`; frontmatter-derived flags live in `flags.planar-codex.meta`. Changing these needs a migration.
- **Editor**: Live Preview decisions live in `computeDecorations` (pure, tested in `test/editor.test.mjs`). Block-level decorations that span lines (the Properties bar) must come from a StateField, not the view plugin.

## Versions

Follow [SemVer](https://semver.org/). Update `CHANGELOG.md` first, set the same version in `module.json` and `package.json`, then tag. Compatibility lives in `module.json` (`minimum`, `verified`, `maximum`); raise `verified` only after testing on that Foundry build.
