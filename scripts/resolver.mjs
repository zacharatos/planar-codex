/**
 * Planar Codex — note lookup, Obsidian style. Pure: used by the importer report (Node and Foundry)
 * and by the live link index inside Foundry.
 */
import { normalizeKey, basename, dirname, extractLinks, isAssetTarget, fmList, splitFrontmatter } from "./markdown.mjs";

/**
 * @typedef {object} NoteEntry
 * @property {string} id        Anything unique (a page UUID in Foundry, the path in tests).
 * @property {string} path      Vault path, e.g. "Prep/Chapter 01 - The Sunken Road.md".
 * @property {string} name      Display name (note basename or Foundry page name).
 * @property {string[]} [aliases]
 */

export class NoteIndex {
  constructor(entries = []) {
    this.entries = [];
    this.byPath = new Map();
    this.byName = new Map();
    this.byAlias = new Map();
    for ( const e of entries ) this.add(e);
  }

  add(entry) {
    const e = { aliases: [], ...entry };
    this.entries.push(e);
    const pathKey = normalizeKey(e.path || e.name);
    this.byPath.set(pathKey, e);
    push(this.byName, normalizeKey(basename(e.path || e.name)), e);
    if ( e.name && normalizeKey(e.name) !== normalizeKey(basename(e.path || "")) ) push(this.byName, normalizeKey(e.name), e);
    for ( const a of e.aliases ?? [] ) push(this.byAlias, normalizeKey(a), e);
    return e;
  }

  get size() { return this.entries.length; }

  /**
   * All notes a link target could mean, best first.
   * @param {string} target      The link target without heading ("Prologue", "Homebrew/Prologue", "Prologue.md").
   * @param {string} [fromPath]  The linking note, used to break ties by folder distance.
   */
  candidates(target, fromPath = "") {
    const key = normalizeKey(target);
    if ( !key ) return [];
    let found = [];
    if ( key.includes("/") ) {
      const exact = this.byPath.get(key);
      if ( exact ) found = [exact];
      else found = this.entries.filter(e => normalizeKey(e.path).endsWith(`/${key}`) || normalizeKey(e.path) === key);
    }
    if ( !found.length ) found = this.byName.get(normalizeKey(basename(key))) ?? [];
    if ( !found.length ) found = this.byAlias.get(key) ?? [];
    return rankByDistance(found, fromPath);
  }

  /** The single best match for a link target, or null. */
  resolve(target, fromPath = "") {
    return this.candidates(target, fromPath)[0] ?? null;
  }
}

function push(map, key, value) {
  if ( !key ) return;
  const list = map.get(key);
  if ( list ) { if ( !list.includes(value) ) list.push(value); }
  else map.set(key, [value]);
}

function rankByDistance(list, fromPath) {
  if ( list.length < 2 ) return [...list];
  const from = normalizeKey(dirname(fromPath)).split("/").filter(Boolean);
  const score = e => {
    const parts = normalizeKey(dirname(e.path)).split("/").filter(Boolean);
    let common = 0;
    while ( common < parts.length && common < from.length && parts[common] === from[common] ) common++;
    return { common, depth: parts.length };
  };
  return [...list].sort((a, b) => {
    const sa = score(a), sb = score(b);
    return (sb.common - sa.common) || (sa.depth - sb.depth) || a.path.localeCompare(b.path);
  });
}

/**
 * Build a link report for a set of notes: which links resolve, which dangle, which are ambiguous.
 * @param {Array<{path: string, markdown: string, aliases?: string[]}>} notes
 * @param {object} [options]
 * @param {(name: string) => boolean} [options.assetExists]  Whether an embedded file exists in the vault.
 */
export function linkReport(notes, { assetExists = () => true } = {}) {
  const index = new NoteIndex(notes.map(n => ({
    id: n.path, path: n.path, name: basename(n.path),
    aliases: n.aliases ?? fmList(splitFrontmatter(n.markdown).data, "aliases")
  })));
  const report = { notes: notes.length, links: 0, typed: 0, resolved: 0, dangling: [], ambiguous: [], assets: [], missingAssets: [], backlinks: new Map() };
  for ( const n of notes ) {
    for ( const link of extractLinks(n.markdown) ) {
      if ( link.type ) { report.typed++; continue; }
      if ( link.embed && isAssetTarget(link.target) ) {
        report.assets.push({ from: n.path, target: link.target });
        if ( !assetExists(link.target) ) report.missingAssets.push({ from: n.path, target: link.target, line: link.line });
        continue;
      }
      if ( !link.target ) { report.links++; report.resolved++; continue; } // [[#Heading]] in the same note
      report.links++;
      const c = index.candidates(link.target, n.path);
      if ( !c.length ) { report.dangling.push({ from: n.path, target: link.target, heading: link.heading, line: link.line }); continue; }
      report.resolved++;
      if ( c.length > 1 && !link.target.includes("/") ) {
        report.ambiguous.push({ from: n.path, target: link.target, chosen: c[0].path, others: c.slice(1).map(e => e.path) });
      }
      const set = report.backlinks.get(c[0].path) ?? new Set();
      set.add(n.path);
      report.backlinks.set(c[0].path, set);
    }
  }
  return report;
}
