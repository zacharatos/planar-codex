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
  prompter/
    core.mjs             pure: parse beats and close-out questions, match triggers, card kinds (inferKind, setBeatKind), notes, the live log Markdown (unit-tested)
    state.mjs            the `prompter` world setting (current run sheet, one run per sheet), coalesced writes, who is present, spotlight
    context.mjs          hooks: Theater, Atlas, Whispers, Glitch, scenes, rests, combat, inspiration → hot beats and events
    panel.mjs            the GM panel (ApplicationV2), Start / Close, writing the live log, jump to a beat in the sheet
    kinds.mjs            card kinds in Foundry: the guess with who is a person (lens/data.mjs), the GM's filter chip, writing kind= back to the sheet
    toasts.mjs           rule toasts: a rule card's box at the top of the screen when its moment comes (GM only)
    beats-in-note.mjs    state and buttons on beat callouts in the reading view
    index.mjs            settings, keybindings, toolbar button, the `api.prompter` object
  lens/
    core.mjs             pure: sections, tables, people / ledger / glossary parsing, name variants and the NameBook, mentions (unit-tested)
    data.mjs             gathers what notes (by frontmatter type) and the other Planar modules know about a name; parses once per Markdown version
    index.mjs            the Lens target, following the table (Prompter contexts, selected NPC tokens), settings
    view.mjs             the Lens tab's HTML and clicks (rendered inside the Prompter panel, prompter/panel.mjs), the place and NPC cards (0.8)
  library/
    core.mjs             pure: book index, citations, finding a section, section Markdown, search, batching (unit-tested)
    store.mjs            the GM-only world compendium: reading a books folder, importing, loading books (cached)
    index.mjs            openLibrary, resolveCitation, wireCitations (citation chips → Library), the keybinding, `api.library`
    window.mjs           the reader window (books, contents, a section, search)
    importer.mjs         the Import books window
styles/codex.css         reading view, editor and window styles
lang/en.json             interface strings (keys under PLANARCODEX.*)
lib/                     vendored browser builds: codemirror.esm.js, marked.esm.js (+ licences)
lib-src/codemirror.mjs   the CodeMirror entry point lib/codemirror.esm.js is built from
test/                    node:test unit tests, helpers, and the browser harnesses (test/harness/: note view, prompter.html, lens.html with made-up notes in lens/)
tools/                   package, stamp-manifest, release-api, build-lib, serve, vault-check, heading-check, ready-check
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
node tools/ready-check.mjs "/path/to/your/vault"
```

The first two convert every note in both views and report leftover tokens, dangling links and heading links that don't resolve. `ready-check` reports what keeps notes from working with the Prompter and the Lens (types, people without want / fear / tell or a name in both languages, ledger numbers, beat triggers that match nothing at the table); `--note <path>` checks one note, `--json` for scripts.

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
- With Planar Whispers active: a private line shows *Whisper* and *Queue*; *Whisper* opens it full screen on the named player's screen (not in chat). `> [!whisper|voice|burn] A, B` goes to both in the Voice style with burn. Two private lines with `together=x` in one note: either *Whisper* sends both at the same moment. A `player:` handout shows *Reveal to …*. Disable Planar Whispers: the buttons go back to the chat whisper. `[!note|wide]` still renders as a note callout, in the reading view and in the editor.
- Secrets reveal and stay revealed after the note is edited.
- Tasks tick and the tick survives a reload.
- As a player: no DM boxes, private lines, comments, properties, pencils or Edit button.

Prompter (harness first: `npm run harness`, then /test/harness/prompter.html; `window.prompter.hear({kind: "place", text: "The Old Library"})` in the console)
- A note with `[!beat]` callouts: the toolbar scroll button and Alt+D open the Prompter on it; the list button switches sheets.
- A deck longer than the window (expand several cards): the console scrolls with the mouse wheel down to the note box; a re-render (tick a card) keeps the scroll position. Same in the Lens tab with a long stack.
- Start: the `must` beats glow, a notification lists them; Planar Atlas's party window shows the session number; a sent whisper carries it.
- Show a Theater place whose label contains a beat's `at=` name (stage, then over a map): the beat moves to *Now* with a notification. Move the Atlas party to a place: same. Take a Long Rest on a hero: `first Long Rest` beats come up.
- Expand a card: rolls roll, links open, Whisper sends; once every private line on the card is sent, the beat is marked played, Show reads aloud.
- ✓ / ✗ / ⏩ / undo, in the panel and on the beat box in the note: both stay in step.
- **Presence (two players logged in):** Start: the spotlight shows their heroes present, the others as "absent" (dashed); a card with `pc=` of an absent hero sits in *Waiting for absent heroes* and says "Waiting for: <name> (absent)". The person icon beside a hero switches them in or out; their cards wake or sleep at once.
- Log a player out during the session: their hero stays present (the snapshot). Log in a player whose hero was absent: they join, the feed says "<name> joined the table". Close after both players log off: the live log still shows them present and names who each sleeping card waited for.
- ✓ on a card: the bar "Played: <title> · Undo" stays at the bottom for ~6 s; Undo puts the card back as it was (also for ✗ and ⏩). ✓ on a card that wasn't hot: its *where* in the log is empty (not the last thing heard).
- **Long Rest** / **Short Rest** in the header: the cards waiting for that rest wake (or "… logged. No card was waiting for it."), the feed logs "(the GM)". With the Atlas clock at night (*νύχτα*/*αντιζενίθ*) the Long Rest button glows.
- Reload Foundry mid-session, then move the Atlas party: the log gets **one** new stop, not the whole road. Purse lines and private lines sent before the reload aren't logged again either. An Atlas stop away from any place reads "near «X»" (Atlas 0.2.2+), never «?».
- Open a second GM tab: in the one that isn't the active GM, a red banner says nothing is heard or logged there.
- After a Long Rest (or 30 min with nothing at the table, kept running), a banner offers *Close*; *Not yet* hides it until something new happens.
- Close more than 45 min after the last event: the dialog offers "Close as of <time>" (ticked); the log's *Closed* and *Played* use that time; *Last at the table* shows it.
- *Notes and what the modules saw*: click its heading to fold it; the heading shows the latest line; add a note (the panel re-renders): it stays folded; reload: still folded. Click again to open (0.7.1).
- Notes with tags; delete one. The feed shows whispers sent and read, purse changes, stops, Heroic Inspiration, deaths.
- **Kinds (0.7):** each card has a coloured badge (dashed = guessed). The harness sheet: *The forged deed* is a clue (🔍, found / not found), *Night whispers* a whisper, *Rule: Brannoc's bad knee* sits in the folded *Rules* section, *Dust in the stacks* shows «What kind?». Pick *Rule* there: the run sheet's line gets `kind=rule` (open the note) and the card moves to *Rules*.
- Filter chips: each one shows only its kind in every section; click it again (or *All*) to see everything. Reload: the chip is remembered (per GM user).
- **Rule toasts:** Start, then *Short Rest*: a green box at the top of the screen shows Brannoc's rule with its roll button; the roll works; ✕ dismisses it; the scroll button opens the Prompter. A second Short Rest a minute later shows it again (one box, not two). With Brannoc switched out in the spotlight, nothing shows. The feed and the live log say "reminded"; rule cards are never "missed" and don't block Close.
- A person card (all its moments are people from the NPC notes, NPC actors or Theater cards): the 👤 button opens that person in the Lens.
- Close: the dialog asks the close-out questions; a *Session NN - live log* note appears (in *Sessions* if there is one) and opens. Write it again from the header button: the same note is updated.
- As a player: no toolbar button, no beat boxes in any note, Alt+D does nothing.

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
- As a player, reload with the network tab open: `codemirror.esm.js` is **not** downloaded. As the GM, open a Codex note: it downloads once in the background, and the first double-click opens the editor.
- A prep page with many `[[spell:…]]` / `[[actor:…]]` links: links resolve as before (2024 compendium entries first, world documents before compendiums). Rename a world actor that a link points to: after the page re-renders, the link follows the new name only if the text matches it.
- Rename a note: links to it by its new name resolve. Edit a note's text only: backlinks on the target note update (GM view).

## Changing things

- **New user-facing text**: add the key to `lang/en.json`. The manifest test fails if the code asks for a key that does not exist.
- **New pure logic**: put it in `markdown.mjs`, `resolver.mjs` or `vault.mjs` with a test; keep Foundry globals out of those files.
- **Converter output changes** (what players see): bump `CONTENT_VERSION` in `main.mjs` so stored player HTML is rebuilt once on the GM's next login.
- **Data**: imported notes keep their vault path in `flags.planar-codex.path` and import hash in `flags.planar-codex.importHash`; frontmatter-derived flags live in `flags.planar-codex.meta`. Changing these needs a migration.
- **Performance**: link resolution runs on every player's browser at every render. Typed links go through `buildNameLookup` / `pickByName` (`resolver.mjs`), cached per world collection (reset by the create/update/delete hooks in `main.mjs`) and per compendium (rebuilt when its index size changes). The note index is rebuilt only on create/delete/rename/move/flag changes; a text-only page update calls `linkIndex.invalidateBacklinks()`. The editor is imported lazily (`loadEditor` in `inline-edit.mjs`); keep `lib/codemirror.esm.js` out of the static import graph of `main.mjs`.
- **Editor**: Live Preview decisions live in `computeDecorations` (pure, tested in `test/editor.test.mjs`). Block-level decorations that span lines (the Properties bar) must come from a StateField, not the view plugin.

## Versions

Follow [SemVer](https://semver.org/). Update `CHANGELOG.md` first, set the same version in `module.json` and `package.json`, then tag. Compatibility lives in `module.json` (`minimum`, `verified`, `maximum`); raise `verified` only after testing on that Foundry build.

Lens (harness first: `npm run harness`, then /test/harness/lens.html?q=Marina, or ?q=The%20Old%20Library; `window.prompter.hear({kind: "place", text: "Ch03 - 02 - The Old Library"})` moves it)
- Alt+L opens the console on the Lens with the cursor in its box; typing a name and Enter shows it; a first name finds the full name; a Greek name finds what its English pair finds (glossary note).
- An NPC from a `type: npcs` note shows want / fear / tell, the other fields, *Open the note* (opens at the heading), and *NPC card* when a Theater card has that name.
- Show a Theater place (stage and over the map), move the Atlas party, select an NPC token: the Lens follows (a dot on its tab while the Prompter tab is open; or it switches, with the setting). 📌 stops that; unpin and it follows again.
- Place card: *Atlas card*, *Move the party*, *Show* and *Back to the map* work; a shop's button opens the Planar Store console on it. A Factions contact shows its faction and attitude; open debts and favours appear.
- Beats: clicking one opens the Prompter tab with it expanded. Threads, prep and session hits open the note at that line.
- Typing in the Lens box survives the console redrawing (a Theater fade, a note added).
- A person only in a note tagged `people` shows *not met yet* and opens that note; one also in the NPC note shows once, with an *also* button per other note.
- Without Theater, Atlas, Factions or Store active: their parts are simply missing, nothing errors.
- **Place card (0.8)** (harness: ?q=The%20Old%20Library; at the table: the Wayfarer, the Black Hood, the Hall of Records): it comes first, with the Greek name, the English one, its tags; Theater buttons show each image and the 🙈 one takes it down; ♪ plays the scape; *Move the party* moves the Atlas party; the read-aloud has Show / Chat; the people in *Ποιοι είναι εδώ* with a note are chips (hover: want and fear; click: their card); 🎲 d6 lights one row and posts the roll to your chat only; secrets are folded with a 🔒; fold a section, add a note in the Prompter tab, come back: it stays folded. The old *The place* box no longer repeats the Atlas and Theater rows.
- Showing a chapter image on Theater (`Ch02 - 04 - The Ubiquitous Wayfarer + Riaen Blackhome`) brings the Wayfarer's card up, not just the image's name.
- **NPC card (0.8)** (harness: ?q=Marina; at the table: Parisa, Riaen, the Taker): *Ποια είναι*, then the roleplay strip (speaks, moves, tell, the lines as a list), then wants / fears / hides; *Τι ξέρει* has working roll buttons; secrets folded; *NPC card* shows the Theater card, *Sheet* opens the actor when one has that name; the person's `npcs` entry shows inside the card (*As played*) and not again below.
- **Typed links to imported actors (0.8.1)**: with Plutonium's «Cranium Rat Squeaker (MPP)» in the world, Undersigil's card shows `MPP › Cranium Rat Squeakers` as a live link (search the Lens again after importing creatures: open cards don't re-render on their own); «Farrow (Glitch)» and «Farrow (ToFW)» still open their own actors.
- **Narrow Lens (0.8.1)** (harness: a 470 px wide window, ?q=Marina): shrink the console to about 450 px and open Parisa's *Τι ξέρει* and *Μυστικά*: each row stacks, its column names above the cells, nothing runs off the card. On the Great Bazaar (no card) the *Atlas card* / *Move the party* / *Show* buttons sit on the right of their rows. Parisa's *As played* has one «Want / Fear / Tell» line.
- `game.modules.get("planar-codex").api.placeCard("Wayfarer")` returns the parsed card; `api.openPlace("Wayfarer")` opens the Lens on it; `api.lens.cards("Parisa")` lists the cards for a name.

Library
- Journal sidebar → Library → Import books: choose the books folder; the codes come from the index note's table; big books start unticked; import. A compendium "Library (Planar Codex)" appears, GM only (a player can't see or open it). Importing a book again replaces it.
- Click citations in a note (`ToFW, Ch. 2 › Harmonium Officers`, `› M3` after it, `AATM › …`): the Library opens on that section; ◀ ▶, Contents and Whole chapter work; the ↗ button opens the chapter as a journal page.
- A citation of a book not in the Library searches instead and says so. Alt+B opens it; search finds headings first; the scope menu limits it to one book.
- As a player, citations are plain text and nothing opens.

