/**
 * Planar Codex — Prompter: card kinds in Foundry (0.7).
 *
 * The pure guess is core.inferKind; this adds what only Foundry knows (which moments are people) and writes a kind
 * the GM picks back into the run sheet's Markdown, so the vault gets it on the next export.
 */
import { MODULE_ID, getMarkdown, updateMarkdown } from "../codex.mjs";
import { inferKind, setBeatKind, hash, KINDS } from "./core.mjs";
import { isPersonName } from "../lens/data.mjs";

const cache = new Map();

/** {kind, sure, written, guess} for a beat (cached per title, moments, body and written kind). */
export function kindInfo(beat) {
  if ( !beat ) return { kind: "story", sure: true, written: false, guess: "story" };
  const key = `${beat.id}|${beat.kind ?? ""}|${hash(`${beat.title}\u0000${beat.at.join(";")}\u0000${beat.body}`)}`;
  let hit = cache.get(key);
  if ( !hit ) {
    hit = inferKind(beat, { isPerson: name => { try { return isPersonName(name); } catch(err) { return false; } } });
    if ( cache.size > 400 ) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}

export const kindOf = beat => kindInfo(beat).kind;

/** The GM's filter chip in the Prompter (remembered per GM user). */
export const FILTER_SETTING = "prompterKindFilter";
export function kindFilter() {
  try { const v = game.settings.get(MODULE_ID, FILTER_SETTING); return KINDS.includes(v) ? v : "all"; } catch(err) { return "all"; }
}
export function setKindFilter(value) {
  return game.settings.set(MODULE_ID, FILTER_SETTING, KINDS.includes(value) ? value : "all");
}

/**
 * Write `kind=` on a beat in its run sheet.
 * @returns {Promise<boolean>}
 */
export async function writeKind(page, beat, kind) {
  if ( !page || !beat || !KINDS.includes(kind) ) return false;
  const md = getMarkdown(page);
  const next = setBeatKind(md, beat.line, kind);
  if ( next === null || next === md ) return false;
  await updateMarkdown(page, next);
  return true;
}
