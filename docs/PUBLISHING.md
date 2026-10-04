# Publishing

There are two separate steps. Step 1 gives anyone a working install link. Step 2, which is optional, adds the module to Foundry's official package list so it shows up in Foundry's in-app search.

The module `id` (`planar-codex`) is permanent once published: it is the folder name on every user's server and the key for their saved data (`flags.planar-codex.*`, settings). Before you submit to foundryvtt.com, check that <https://foundryvtt.com/packages/planar-codex> doesn't already exist.

## 1. Publish on GitHub

1. Create an empty **public** repository `zacharatos/planar-codex` on GitHub (no README, licence or .gitignore, so nothing conflicts).
2. Push this folder. It is already a git repository with an initial commit on `main`:
   ```
   git remote add origin https://github.com/zacharatos/planar-codex.git
   git push -u origin main
   ```
3. CI (`.github/workflows/ci.yml`) runs lint and tests on every push. It also rebuilds `lib/` from `package-lock.json` and does a package dry run.
4. Make the first release. `CHANGELOG.md` already has a `## [0.3.0]` section, and `module.json` and `package.json` already say 0.3.0, so you only need:
   ```
   git tag v0.3.0
   git push origin v0.3.0
   ```
   `release.yml` runs the tests and checks that the tag matches `module.json`. It builds `module.zip` and a stamped `module.json`, then attaches both to a GitHub release with the changelog section as the notes.
5. Check that this URL downloads a JSON file:
   `https://github.com/zacharatos/planar-codex/releases/latest/download/module.json`

That URL is what people paste into Foundry's **Install Module → Manifest URL** box. It always points at the newest release, so installs and updates need no further work from you.

**Your own server.** Uninstall the hand-copied module first. Your notes and settings are safe: they live in the world, not in the module folder. Then install it from the manifest URL. From then on Foundry's **Update** button picks up new releases.

### Releasing later versions

1. Change the code, run `npm test`, and try it in Foundry (checklist in `docs/DEVELOPMENT.md`).
2. Add `## [0.4.0]` at the top of `CHANGELOG.md`. Set `"version": "0.4.0"` in `module.json` and `package.json`; the manifest test fails if they disagree. In `module.json`, also change the `download` URL to `v0.4.0` (the release build does this too, but the test checks the file).
3. Commit, then `git tag v0.4.0` and `git push origin main v0.4.0`.

For a Foundry version that needs a different code path, branch (for example `foundry-v13`), set `compatibility` in `module.json` on that branch, and release from it with the same tag flow (`v0.3.1-v13` style tags work too).

## 2. The official Foundry listing

Listing makes the module appear in Foundry's **Install Module** search for everyone.

- You need a foundryvtt.com account with an active Foundry VTT licence.
- Submit through the [package submission form](https://foundryvtt.com/creators/submit/). Modules get a **manual review** before they go live.
- On the form, give the package id (`planar-codex`), the title, a description, and the *latest* manifest URL from step 1.
- You must own or have rights to everything you ship. The package contains only code and text: our own code plus CodeMirror and marked, which are MIT-licensed with their licence files included. It contains no art, audio or game text. The sample note in `test/harness/` is original and isn't shipped in the zip.

### Foundry's AI Content Policy: do this before you submit

The code in this repo was written with AI assistance. Foundry's [AI Content Policy](https://foundryvtt.com/article/ai-policy) (revised March 18, 2026) applies to packages on the official listing. It doesn't apply to self-publishing on GitHub (step 1). In short:

- **Code**: AI assistance is allowed, but you must be able to "understand, explain, modify, and maintain every part" of the code. Vibe coding isn't allowed.
- **Interface text must be human-authored.** That means `lang/en.json` and any other strings users read.
- **The package description on foundryvtt.com must be written by you**, not generated.
- **Images**: any prepared visual asset must come from human work. The package ships none. For the listing, take your own screenshots in Foundry rather than using `docs/images/`.
- **Documentation** may be AI-assisted, as long as you understand it.
- **Consequences**: non-compliant packages can be archived or removed, or tagged as containing AI content.

Check the current wording before you submit, since the policy may change.

Before submitting:

1. Read through `scripts/` until you could explain and fix each file. `docs/DEVELOPMENT.md` has the map. The trickiest parts are `inline-edit.mjs` (scroll alignment, saving) and `editor/live-preview.mjs`.
2. Rewrite `lang/en.json` in your own words. Keep the keys and the `{placeholders}`; `npm test` checks that every key the code uses still exists.
3. Rewrite the `description` in `module.json`, and write the listing text yourself.
4. Optionally add a Greek interface (`lang/el.json`, plus an entry under `languages` in `module.json`). The tests check it has the same keys as English.
5. Test every item in the manual checklist in `docs/DEVELOPMENT.md` on the Foundry build you list as `verified`.
6. Keep your commit history; don't squash it away.

### After approval: announcing versions on foundryvtt.com

Once the package exists on foundryvtt.com, each new version must also be announced there. Either do it by hand on your package page, or automate it:

1. On your package's page on foundryvtt.com, copy the **Package Release Token** (it starts with `fvttp_`; the field sits just above *Save Package*).
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret** and create one named `FOUNDRY_PACKAGE_TOKEN`.
3. From then on, pushing a tag also runs `tools/release-api.mjs`. It posts the version, the version-specific manifest URL (`…/releases/download/vX.Y.Z/module.json`), the release notes link and the compatibility range to the [Package Release API](https://foundryvtt.com/article/package-release-api/).

To test the call without publishing anything:

```
FOUNDRY_PACKAGE_TOKEN=fvttp_... node tools/release-api.mjs --version 0.3.0 --repo zacharatos/planar-codex --dry-run
```

## Checklist

- [ ] `npm test` passes
- [ ] Repo pushed; CI green
- [ ] Tag `v0.3.0` pushed; the release has `module.json` and `module.zip`
- [ ] The manifest URL installs the module in a fresh world (and on your own server, replacing the hand-copied one)
- [ ] (Listing) You can explain and maintain the code
- [ ] (Listing) `lang/en.json`, the description and the listing text are in your own words; screenshots are your own
- [ ] (Listing) Submitted at foundryvtt.com/creators/submit
- [ ] (Listing, after approval) `FOUNDRY_PACKAGE_TOKEN` secret added
