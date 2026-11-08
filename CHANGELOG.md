# Changelog

All notable changes to this module. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).
The release workflow uses the section matching the tag as the GitHub release notes, so keep the `## [x.y.z]` headings exact.

## [0.9.0]

Codex "Cards", part 3: keys. A note can name a place, a person, an image or a soundscape before it exists, and it starts working the moment the thing is made with the expected name.

### Added
- **Keys in buttons.** Every place and person note has a `key:` (`wayfarer`, `riaen`). Module buttons can use it instead of the asset's real name: `@Place[wayfarer]`, `@Place[wayfarer+riaen]` (with a person in the shot), `@Place[prison@antipeak]` (a time of day, a point of view: `@eye`, `@inside`, `@outside`, or any moment word), `@Cast[farrow@glitch]`, `@Scape[wayfarer]`, `@Atlas[wayfarer | move]`, `@Shop[wayfarer-bar]`, and `[[actor:riaen]]`. In the GM view (notes, Prompter cards, rule boxes, the Lens) Codex puts in the real name: the note's own mapping first (`theater: {wayfarer+riaen: "…"}`, `scape:`, `actor:`, `atlas:`), then the note's `theater:` list, then what Theater, the Soundboard, the Atlas and the Store have on the server, by the naming templates. A button without a label gets the Greek names («Ο Πανταχού Οδοιπόρος + Ράιεν»). Buttons written with full names work as before.
- **Planned chips.** When nothing on the server has that name yet, the button is a dashed chip (GM only; players never see module buttons) whose tooltip says exactly what to create, e.g. «Theater: this image isn't on the server yet. Create Ch02 - 19 - The Black Hood + Jet.webp», numbered like the place's other scenes. One click copies the name. Once the image, NPC card, soundscape, cue, Atlas place or shop exists, the chip becomes the working button, with no change to the note.
- **Triggers by key.** `at=wayfarer` wakes a card whatever the table reports for that place: its Theater label, the Atlas's Greek name, any of the note's names. A key that is a person's (`at=riaen`) counts as a person for card kinds. Trigger chips on the cards show the note's name, with the key in the tooltip.
- API: `api.keys.list()`, `api.keys.explain(key)` (what a key resolves to right now, and what's missing), `api.keys.resolveButton(text)`; `api.prompter.core.beatsFor` takes an optional fourth argument, the names a trigger stands for.

### Ready check (`tools/ready-check.mjs`; not part of the installed module)
- Theater buttons written with keys are resolved like Codex does, against `Visuals/WebP`. A key whose image doesn't exist yet is a warning, *planned*, with the file name to create and the folder to put it in; `--assets` lists the planned images and the soundscapes named by key (those live in Foundry, so they're listed, not checked); with `--json`, `planned` and `scapes` are added.
- `@Atlas[key]`: a key that is neither an id in the Atlas pack nor its note's `atlas:` name is a warning.
- Triggers written as keys are checked with their note's names: no more "isn't a name the Atlas reports" or "add the Greek name" for `at=wayfarer`.

### Needs
- Planar Soundboard with `scapes()` / `cues()` to check `@Cue` names (soundscapes are checked through its older `list()` too).

## [0.8.2]

### Fixed
- The Library didn't scroll: a long section or chapter was cut off at the bottom of the window (V14 windows clip their content; the Library now scrolls itself, like the console, and the import window too). An empty Library shows its message once instead of twice.

## [0.8.1]

Lens cards in a narrow window, after the first try at the table.

### Fixed

- Card tables (*Τι ξέρει*, *Μυστικά*) no longer run off the card: long words wrap, and in a narrow Lens each row stacks, with its column heading above each cell.
- Rows with buttons (Atlas card, Move the party, Show, Open the shop) wrap cleanly and keep their buttons to the right, instead of floating at uneven heights.
- Typed links (`[[monster:Cranium Rat Squeakers]]`, `[[actor:…]]`) missed actors imported with a source tag in their name (Plutonium's «Cranium Rat Squeaker (MPP)», «Bandit (MM'25)»): the lookup now tries the exact name, then the name without a tag of two or more capitals (so «Farrow (Glitch)» stays distinct), then singular / plural.
- An NPC card's *As played* showed «Want / Fear / Tell» twice when a prep note had its own line for the same person: a prep note's line now shows only when `npcs.md` has nothing of that kind.

## [0.8.0]

Codex "Cards", part 2: the place card and the person card in the Lens.

### Added
- **Place card.** A `type: place` note (one per place, in the vault) is the first thing the Lens shows for that place: its names and tags; buttons for its Theater images, its soundscape, *Move the party* and the note; *Με μια ματιά* always in sight; then the read-alouds (Show / Chat), senses, the view from here, who is here (a chip per person with a note: want and fear on hover, click for their card), what can happen (a d6 table with a 🎲 that lights the rolled row and posts the roll to the GM's chat only), secrets and clues (folded, 🔒), where it is, prices and services, things to remember, and any other section under its own heading. Showing a chapter image on Theater whose label names the place (e.g. `Ch02 - 04 - The Ubiquitous Wayfarer + Riaen Blackhome`) brings the card up.
- **Person card.** A `type: npc` note: who she is, then the **roleplay strip** (how she speaks, moves, her tell, three lines ready to say), wants · fears · hides, looks, attitude, what she knows (a table with live rolls), secrets (folded, 🔒), where to find her, combat, and how she was played (her entry in the `type: npcs` note, shown inside the card rather than again below). Buttons: her Theater NPC card, her actor's sheet, the note.
- Headings are fixed names, Greek or English (README); each section is optional. Both cards also take *Ψίθυροι* (private lines with their Whisper buttons, e.g. what two heroes notice when they first see someone).
- API: `api.placeCard(name)` (the parsed card, for the Atlas arrival card), `api.openPlace(name)`, `api.lens.cards(name)`.

### Changed
- *In past sessions*: a live log's hit shows the lines that name the thing («00:23 Theater A Market Ward street»), not its whole section run together.
- With a place card, the Lens's *The place* box no longer repeats the Atlas and Theater rows.

### Ready check (`tools/ready-check.mjs`; not part of the installed module)
- Place and NPC notes: no title is an error; no `key:`, a section the card doesn't know (a typo shows at the end of the card), and a voice or wants section without its bold labels are warnings.
- `tools/ready-check.mjs` checks images: every `@Place[…]` and `@Cast[…]` button is looked up the way Theater does (exact name, then "starts with", then "contains", over the place images or the NPC cards in `Visuals/WebP`), and every `![[…]]` embed must have its WebP copy. An image that isn't there is an error; a button that matches several images by part of its name, an embedded original (.png/.jpg) and a `_work/` scratch image are warnings; a plain link to an image file is an error (Codex shows it as broken).
- `--assets` lists every image the notes use with its path on the server (`Visuals/WebP/<path>` is `dnd/<path>` in Foundry's User Data), to check before a session that everything is uploaded. With `--json`, the output becomes `{notes, otherBooks, assets}`; without `--assets` it stays the list of notes as before.

## [0.7.1]

From the first try of 0.7.0 at the table.

### Changed
- *Notes and what the modules saw* folds away: click its heading. Folded, the heading still shows the latest line; open or folded is remembered per GM.
- A whisper card's "sent" button is a ✓ again, not a paper plane: it only marks the card, and the plane looked like it would send the line (the card's own *Whisper* button sends it).

## [0.7.0]

Codex 0.7 "Cards", part 1: card kinds and rule toasts. (The Place and NPC cards, keys and the Now strip follow.)

### Added
- **Card kinds.** A beat can say what it is with `kind=` (`story`, `clue`, `whisper`, `npc`, `event`, `rule`; Greek works too: `kind=Κανόνας`). Without it, the Prompter guesses: a title like «Rule: …» or «Κανόνας: …», a body that is only private lines (whisper), a roll that waits only for a rest, a fight or a death (rule), a check that mentions a clue, moments that are only people (npc), only times of day or «whenever …» (event); otherwise a scene.
- Each card shows its kind as a coloured badge (dashed when guessed). Click it to change the kind: the choice is written into the run sheet as `kind=…`, so the vault gets it on the next export. When a card could be read two ways, its picker is open with «What kind?».
- **Filter chips** under the spotlight: All · Scenes · Clues · Whispers · People · Events · Rules, with how many cards each has. The choice is remembered per GM.
- Clue cards are *found* / *not found*; whisper cards are *sent*; person cards have a button that opens the person in the Lens.
- **Rule cards** (`kind=rule`) are reminders, not beats: when their moment comes (a Short or Long Rest, the end of a fight, a death, or a place or person they name), a GM-only box shows the rule with its roll buttons at the top of the screen and stays until dismissed. They live in their own *Rules* section (folded, or open with the Rules chip), with a ⚖ button to show one now; they are never "must" nor "missed". The live log says when each one reminded.
- `tools/ready-check.mjs`: an unknown `kind=` is an error; a card whose kind is unclear, a written kind that contradicts what the card reads like, and a rule card marked `must` are warnings. Rule cards don't count towards the deck size.
- API: `api.prompter.kind(idOrBeat)` → `{kind, sure, written, guess}`; `api.prompter.core.inferKind`, `setBeatKind`, `KINDS`.

### Changed
- Beat callouts with a written kind get a `codex-beat-kind-<kind>` class in the reading view.
- The test harness run sheet has a rule card, a clue card and a card whose kind is unclear.

## [0.6.2]

Fixes from Session 03 (the Prompter at the table).

### Fixed
- The console window (Prompter and Lens) scrolls: long decks and Lens stacks were cut off at the bottom.
- **Presence:** who is at the table is snapshotted at *Start* and kept for the whole run, so a live log written after the players logged off no longer marks every hero absent and every hero card asleep. A player who joins mid-session puts their hero at the table; a dropped connection doesn't take them out.
- A misclicked ✓ / ✗ / ⏩ can be undone from a bar at the bottom of the window for a few seconds; ✓ and ✗ are bigger and further from the title. A played card's *where* is only what called it (when it was hot), not the last thing heard.
- Reloading Foundry mid-session (or Planar Atlas loading after Codex) no longer replays the whole road into the log: stops, purse lines and private lines made before the Prompter started listening are old news, and every logged event carries a reference so it is never logged twice.
- An Atlas stop with no name logs as "somewhere on the map" instead of «?» (Planar Atlas now names it "near «X»").
- *Played* in the live log runs from Start to the last thing that happened at the table (a Close the next afternoon read as 16 hours); the log also shows *Last at the table*.

### Added
- **Long Rest** and **Short Rest** buttons in the Prompter's header: wake the cards waiting for a rest that was narrated, not clicked on a sheet (the Long Rest button glows at night on the Atlas clock).
- A person icon beside each hero in the spotlight switches them in or out of tonight's table (guest heroes, a player who leaves early); a sleeping card says who it waits for.
- A banner in a GM browser that isn't the active GM: nothing is heard or logged there.
- An offer to close the session after a Long Rest or 30 minutes with nothing at the table; closing long after the last event offers "Close as of <time>".

## [0.6.1]

### Added
- **Lens: people you prepared but haven't met yet.** Notes tagged `people` (a chapter prep's NPC voice notes, say) add the people who have *want / fear / tell*, as headings or table rows. Their card carries a *not met yet* badge and opens that note.
- The same person in several notes is one card: the `type: npcs` note leads, the others add their fields and an *also* link each. A leading article doesn't split a name («ο Ζοκ» and «Ζοκ» are one person).
- `tools/ready-check.mjs`: checks a vault's notes are ready for the Prompter and the Lens (frontmatter types, people with want / fear / tell and a name in both languages, ledger numbers, beat triggers that match a Theater image, an Atlas place's Greek name or a person, heroes in `pc=`). `node tools/ready-check.mjs "<vault>" [--note <path>] [--json]`; exit code 1 on errors.

### Changed
- Lens: *Want*, *Fear* and *Tell* as separate fields or table columns read as one *Want / Fear / Tell*.
- Lens: a name heading's `[HB]` mark becomes "homebrew" in the about line; in the brackets, only capitalised pieces after commas are other names (the rest is about them). Separate other names from the role with `;`.

## [0.6.0]

### Added
- **The GM console.** The Prompter's window has tabs: *Prompter* and *Lens*, and a book button for the Library.
- **Lens** (Φακός), the console's second tab (Alt+L): everything the notes know about one name, most useful first.
  - Shows people (*want / fear / tell*, voice, attitude, what they know, status) and the place: Planar Atlas card and *Move the party*, Planar Theater images with *Show* and *Back to the map*, NPC cards, Planar Store shops.
  - Also: Planar Factions contacts, debts and favours; the deck's beats and tonight's notes; open ledger threads; where the prep and the session notes mention it (best match first, one click to the line); its book citations.
  - **Follows the table:** a Theater place or NPC card shown (on the stage or over the map), an Atlas stop, the active scene, a selected NPC token. 📌 pins it; a history of recent names.
  - Reads notes by frontmatter: `type: npcs` (heading blocks with `- **Label:**` fields, tables whose first column is NPC or Name), `type: ledger` (numbered tables), `type: prep` and `type: session` (mentions; run sheets without their beat boxes), and notes tagged `glossary` (name pairs, so «η Παλιά Βιβλιοθήκη» finds what «The Old Library» finds). Note aliases count. A first name finds the full name.
  - Settings: *Lens: follow the table*, *Lens: follow selected NPC tokens*, *Lens: switch to it when the table moves*.
- **Library** (Βιβλιοθήκη, Alt+B, and a *Library* button in the Journal sidebar).
  - *Import books* reads a folder of Markdown books (one subfolder per book, one file per chapter; book codes from an index table with *code* and *book* columns, or the book's initials) into a GM-only world compendium.
  - Book citations in notes, Prompter cards and the Lens open the section they name: `ToFW, Ch. 2 › Harmonium Officers`, `PHB 2024, Ch. 7 › Using a Potion`, `› M3` (the book of the citation before it, then the other books the note cites).
  - The reader steps ◀ ▶ through the sections and shows the contents or the whole chapter. Search looks through headings first, then the text.
- API: `api.lens` (`open`, `show`, `gather`), `api.library` (`open`, `importBooks`, `resolve`, `books`, `pack`).
- `test/harness/lens.html`: the Lens and the Library with stubbed Foundry and made-up notes.

### Changed
- The Prompter panel's window title follows its tab. Alt+N always opens the Prompter tab.

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
