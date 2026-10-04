/**
 * Planar Codex — the live index of Codex notes in the world: link resolution, typed document lookup, backlinks.
 */
import { MODULE_ID, isCodexPage, getMarkdown, folderTrail } from "./codex.mjs";
import { NoteIndex } from "./resolver.mjs";
import { extractLinks, normalizeKey, normalizeHeading, findHeading, extractHeadings, TYPE_PREFIXES, isAssetTarget } from "./markdown.mjs";
import { pathForNewNote } from "./vault.mjs";

class CodexLinkIndex {
  #index = null;
  #backlinks = null;
  #dirty = true;

  invalidate() {
    this.#dirty = true;
    this.#backlinks = null;
  }

  /** Vault path of a page: the imported path, or one derived from its folders for notes made in Foundry. */
  pathOf(page) {
    const flagged = page.getFlag(MODULE_ID, "path");
    if ( flagged ) return flagged;
    const entry = page.parent;
    const rootId = game.settings.get(MODULE_ID, "rootFolder") || null;
    return pathForNewNote(folderTrail(entry, rootId), entry.name);
  }

  /** @returns {NoteIndex} */
  get index() {
    if ( this.#index && !this.#dirty ) return this.#index;
    const idx = new NoteIndex();
    for ( const entry of game.journal ) {
      for ( const page of entry.pages ) {
        if ( !isCodexPage(page) ) continue;
        const meta = page.getFlag(MODULE_ID, "meta") ?? {};
        idx.add({ id: page.uuid, path: this.pathOf(page), name: entry.name, aliases: meta.aliases ?? [], page });
      }
    }
    this.#index = idx;
    this.#dirty = false;
    return idx;
  }

  /**
   * Resolve a note link target to a page.
   * @param {string} target
   * @param {JournalEntryPage} [from]  The linking page (ties break toward nearby folders).
   * @returns {JournalEntryPage|null}
   */
  resolvePage(target, from = null) {
    const fromPath = from && isCodexPage(from) ? this.pathOf(from) : "";
    const hit = this.index.resolve(target, fromPath);
    if ( hit?.page ) return hit.page;
    // Fall back to any journal entry with this name (notes not made with the Codex).
    const key = normalizeKey(target);
    const entry = game.journal.find(j => normalizeKey(j.name) === key);
    return entry?.pages.contents[0] ?? null;
  }

  /**
   * The TOC slug for a heading on a page, matching Obsidian heading-link text.
   * @returns {string|null}
   */
  headingSlug(page, heading) {
    if ( !heading ) return null;
    const toc = Object.values(page.toc ?? {});
    const hit = findHeading(toc.map(t => ({ text: t.text, slug: t.slug })), heading);
    if ( hit ) return hit.slug;
    // Heading only in the GM view (inside a DM callout) or not yet rendered: slug it the way Foundry does.
    const md = findHeading(extractHeadings(getMarkdown(page)), heading);
    const JEP = foundry.documents.JournalEntryPage ?? CONFIG.JournalEntryPage.documentClass;
    return JEP.slugifyHeading(md?.text ?? heading);
  }

  /**
   * Resolve a typed link ([[actor:Brannoc]], [[spell:Fireball]]) to a document UUID.
   * World documents win; then compendiums of that document type, 2024 packs first.
   * @returns {Promise<string|null>}
   */
  async resolveTyped(prefix, name) {
    const docName = TYPE_PREFIXES[prefix];
    if ( !docName ) return null;
    const key = normalizeKey(name);
    const itemType = { spell: "spell", feat: "feat", weapon: "weapon", armor: "equipment", equipment: "equipment" }[prefix];
    const collection = game.collections.get(docName);
    const local = collection?.find(d => normalizeKey(d.name) === key && (!itemType || d.type === itemType))
      ?? collection?.find(d => normalizeKey(d.name) === key);
    if ( local ) return local.uuid;

    const preferMonster = prefix === "monster" || prefix === "creature";
    const packs = game.packs.filter(p => p.documentName === docName)
      .sort((a, b) => packRank(b, preferMonster) - packRank(a, preferMonster));
    for ( const pack of packs ) {
      const index = pack.indexed ? pack.index : await pack.getIndex({ fields: ["type"] });
      const hit = index.find(e => normalizeKey(e.name) === key && (!itemType || e.type === itemType))
        ?? index.find(e => normalizeKey(e.name) === key);
      if ( hit ) return hit.uuid ?? `Compendium.${pack.collection}.${docName}.${hit._id}`;
    }
    return null;
  }

  /** Map of page UUID → Set of page UUIDs linking to it. Built lazily. */
  get backlinks() {
    if ( this.#backlinks ) return this.#backlinks;
    const map = new Map();
    for ( const entry of this.index.entries ) {
      const page = entry.page;
      for ( const link of extractLinks(getMarkdown(page)) ) {
        if ( link.type || !link.target || (link.embed && isAssetTarget(link.target)) ) continue;
        const target = this.index.resolve(link.target, entry.path);
        if ( !target || target.id === entry.id ) continue;
        const set = map.get(target.id) ?? new Set();
        set.add(entry.id);
        map.set(target.id, set);
      }
    }
    this.#backlinks = map;
    return map;
  }

  /** Pages linking to this page, sorted by name. */
  backlinksOf(page) {
    const ids = this.backlinks.get(page.uuid) ?? new Set();
    return [...ids].map(id => this.index.entries.find(e => e.id === id)?.page).filter(Boolean)
      .sort((a, b) => a.parent.name.localeCompare(b.parent.name));
  }
}

function packRank(pack, preferMonster) {
  let r = 0;
  const id = pack.collection;
  if ( /24\b|2024/.test(id) ) r += 4;
  if ( id.startsWith("dnd5e.") ) r += 2;
  if ( preferMonster && /monster|actors|bestiary/i.test(id) ) r += 3;
  if ( /heroes/i.test(id) ) r -= 1;
  return r;
}

export const linkIndex = new CodexLinkIndex();
export { normalizeHeading };
