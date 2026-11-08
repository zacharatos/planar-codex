/**
 * Planar Codex — keys: one stable id per place and person (`key: wayfarer` in its note), written in buttons and
 * triggers instead of the asset's real name. Pure: no Foundry globals (unit-tested, and used by tools/ready-check.mjs).
 *
 *   @Place[wayfarer+riaen]  @Place[prison@antipeak]  @Cast[farrow@glitch]  @Scape[wayfarer]  @Atlas[wayfarer | move]
 *
 * A key finds its asset (1) through the note's frontmatter (`theater:`, `scape:`, `actor:`, `atlas:`), (2) by the
 * naming templates (the note's English name), and when nothing on the server has that name yet, (3) it stays a
 * "planned" chip that says exactly which file or name to create.
 */

/** `wayfarer`, `black-hood`, `wayfarer+riaen`, `m1-morgue@eye`, `prison@antipeak`, `wayfarer+riaen+parisa@night`. */
export const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\+[a-z0-9]+(?:-[a-z0-9]+)*)*(?:@[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

/** Words that are never keys, even though they look like one (Theater's `@Place[off]`). */
const NOT_KEYS = new Set(["off", "clear", "all", "close", "none"]);

/** Points of view: written in brackets at the end of an image name, «(eye level)». Other variants are « - word». */
export const VIEWS = { eye: "eye level", inside: "inside", outside: "outside" };

/**
 * @param {string} text
 * @returns {{key: string, base: string, with: string[], variant: string|null}|null}
 */
export function parseKey(text) {
  const s = String(text ?? "").trim();
  if ( !KEY_RE.test(s) || NOT_KEYS.has(s) ) return null;
  const [main, variant = null] = s.split("@");
  const [base, ...others] = main.split("+");
  return { key: s, base, with: others, variant };
}

/** Lower case, no accents, apostrophes dropped, anything else that isn't a letter or digit to one space. */
export function fold(text) {
  return String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[’'`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const hasGreek = s => /[Ͱ-Ͽἀ-῿]/.test(s);
const hasLatin = s => /[A-Za-z]/.test(s);
const dropArticle = s => s.replace(/^the /, "");

/**
 * What the resolver knows about one keyed note.
 * @typedef {object} Thing
 * @property {string} key
 * @property {"place"|"npc"} kind
 * @property {string} title       the note's display name (Greek first)
 * @property {string} en          its English name
 * @property {string[]} names     every name it answers to
 * @property {string[]} theater   Theater labels the note lists (`theater:`)
 * @property {Object<string,string>} theaterMap  `theater: {key: label}` in the frontmatter
 * @property {string[]} scape
 * @property {string|null} actor
 * @property {string|null} atlas
 */

/**
 * A Thing from a note's frontmatter and parsed title. `names` is everything else it is called (the note's file name,
 * the title's other names, the aliases).
 */
export function thingOf({ key, kind, title, names = [], fm = {} }) {
  const list = v => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String).map(s => s.trim()).filter(Boolean);
  const theaterMap = fm.theater && typeof fm.theater === "object" && !Array.isArray(fm.theater) ? Object.fromEntries(Object.entries(fm.theater).map(([k, v]) => [k, String(v)])) : {};
  const all = [...new Set([title, ...names, ...list(fm.aliases)].filter(Boolean).map(String))];
  const en = all.find(n => hasLatin(n) && !hasGreek(n)) ?? all[0] ?? key;
  return {
    key: String(key), kind, title: title || en, en, names: all,
    theater: Object.keys(theaterMap).length ? Object.values(theaterMap) : list(fm.theater),
    theaterMap, scape: list(fm.scape), actor: fm.actor ? String(fm.actor) : null, atlas: fm.atlas ? String(fm.atlas) : null
  };
}

/** Folded English names a label may use for a thing ("ubiquitous wayfarer", "wayfarer"), longest first. */
function needles(thing) {
  const out = new Set();
  for ( const n of thing.names.filter(x => hasLatin(x) && !hasGreek(x)) ) {
    const f = dropArticle(fold(n));
    if ( f.length >= 4 ) out.add(f);
  }
  return [...out].sort((a, b) => b.length - a.length);
}
/** The words a person goes by in a label: the full English name and its first word («riaen blackhome», «riaen»). */
function personNeedles(thing) {
  const f = dropArticle(fold(thing.en));
  const first = f.split(" ")[0];
  return [...new Set([f, ...(first.length >= 3 ? [first] : []), ...needles(thing)])];
}
const contains = (label, word) => ` ${fold(label)} `.includes(` ${word} `);
const variantWords = v => (VIEWS[v] ? [fold(VIEWS[v]), v] : [fold(v.replace(/-/g, " "))]);
/** A label's extra part after the name: « - marquee», «(eye level)», « + Riaen». */
const isPlain = label => !/\s\+\s|\s-\s[^-]*$|\([^)]*\)\s*$/.test(String(label).replace(/^Ch\d+\s*-\s*\d+\s*-\s*/i, ""));
const titleCase = s => s.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/** «A», «A and B», «A, B and C». */
function joinNames(names) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The Theater place label for a key: from the note's own list (or `theater: {key: label}`), then the labels on the
 * server, by the § 9.4 template.
 * @param {Thing} thing
 * @param {{with: string[], variant: string|null, key: string}} parsed
 * @param {object} opts
 * @param {(key: string) => Thing|null} opts.thingFor   the person in a «+npc» part
 * @param {string[]|null} [opts.labels]                  the place labels on the server; null: unknown (no check)
 * @returns {{name: string, exists: boolean|null, create: string|null}}
 *   name: what to put in the button; exists: on the server (null: couldn't check); create: the file to make, when planned
 */
export function theaterPlace(thing, parsed, { thingFor = () => null, labels = null } = {}) {
  const people = parsed.with.map(k => thingFor(k) ?? { en: k, names: [k] });
  const mapped = thing.theaterMap[parsed.key];
  const onServer = name => (labels ? labels.some(l => fold(l) === fold(name)) : null);
  if ( mapped ) return { name: mapped, exists: onServer(mapped), create: onServer(mapped) === false ? `${mapped}.webp` : null };

  const own = needles(thing);
  const fits = (label, listed) => {
    if ( !listed && !own.some(n => contains(label, n)) ) return false;
    const plus = /\s\+\s/.test(label);
    if ( people.length ) {
      if ( !plus ) return false;
      const after = label.slice(label.search(/\s\+\s/));
      if ( !people.every(p => personNeedles(p).some(n => contains(after, n))) ) return false;
    }
    else if ( plus ) return false;
    if ( parsed.variant ) return variantWords(parsed.variant).some(w => contains(label, w));
    return true;
  };
  const listed = thing.theater.filter(l => fits(l, true));
  const server = (labels ?? []).filter(l => fits(l, thing.theater.some(t => fold(t) === fold(l))));
  // Plain names first when no variant was asked for; then the shortest.
  const rank = l => (parsed.variant ? 0 : isPlain(l) ? 0 : 1) * 1000 + String(l).length;
  const best = list => [...list].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  const there = best(server);
  if ( there ) return { name: there, exists: labels ? true : null, create: null };
  const wanted = best(listed);
  if ( wanted ) return { name: wanted, exists: labels ? false : null, create: labels ? `${wanted}.webp` : null };

  // Nothing yet: the § 9.4 name, numbered like the place's other scenes («Ch02 - 05 - »), in the note or on the server.
  const related = [...thing.theater, ...(labels ?? []).filter(l => own.some(n => contains(l, n)))];
  const prefix = related.map(l => l.match(/^(Ch\d+\s*-\s*\d+\s*-\s*)/i)?.[1]).find(Boolean) ?? "ChNN - NN - ";
  let name = `${prefix}${thing.en}`;
  if ( people.length ) name += ` + ${joinNames(people.map(p => p.en))}`;
  if ( parsed.variant ) name += VIEWS[parsed.variant] ? ` (${VIEWS[parsed.variant]})` : ` - ${parsed.variant.replace(/-/g, " ")}`;
  return { name, exists: labels ? false : null, create: `${name}.webp` };
}

/**
 * The Theater NPC card label for a person's key (`@Cast[farrow]`, `@Cast[farrow@glitch]`).
 * @returns {{name: string, exists: boolean|null, create: string|null}}
 */
export function theaterCast(thing, parsed, { labels = null } = {}) {
  const mapped = thing.theaterMap[parsed.key];
  const onServer = name => (labels ? labels.some(l => fold(l) === fold(name)) : null);
  if ( mapped ) return { name: mapped, exists: onServer(mapped), create: onServer(mapped) === false ? `${mapped}.webp` : null };
  const own = personNeedles(thing);
  const fits = l => {
    const f = fold(l);
    if ( !own.some(n => f === n || f.startsWith(`${n} `) || contains(l, n)) ) return false;
    if ( parsed.variant ) return variantWords(parsed.variant).some(w => contains(l, w));
    return true;
  };
  const rank = l => (parsed.variant ? 0 : /\([^)]*\)\s*$/.test(l) ? 1 : 0) * 1000 + l.length;
  const best = list => [...list].filter(fits).sort((a, b) => rank(a) - rank(b))[0] ?? null;
  const there = best(labels ?? []);
  if ( there ) return { name: there, exists: labels ? true : null, create: null };
  const wanted = best(thing.theater);
  const name = wanted ?? `${thing.en}${parsed.variant ? ` (${titleCase(parsed.variant.replace(/-/g, " "))})` : ""}`;
  return { name, exists: labels ? false : null, create: labels ? `${name}.webp` : null };
}

/**
 * The soundscape for a place's key: the note's `scape:`, else its English name.
 * @param {string[]|null} names  the soundscapes on the server; null: unknown
 */
export function scapeFor(thing, { names = null } = {}) {
  const name = thing.scape[0] ?? thing.en;
  const exists = names ? names.some(n => fold(n) === fold(name)) : null;
  return { name, exists, create: exists === false ? name : null };
}

/** The actor for a person's key: the note's `actor:`, else its English name. */
export const actorFor = thing => thing.actor ?? thing.en;

/**
 * A module button (`@Place[…]`, `@Cast[…]`, `@Scape[…]`, `@Atlas[…]`, `@Shop[…]`) with its target split out:
 * `head` + target + `tail` rebuilds the inside of the brackets.
 * @returns {{module: string, target: string, head: string, tail: string, label: string|null}|null}
 */
export function splitButton(raw) {
  const m = String(raw).match(/^@(Place|Cast|Scape|Cue|Atlas|Shop)\[([^\]\n]+)\](?:\{([^}\n]*)\})?$/i);
  if ( !m ) return null;
  const module = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const inner = m[2];
  const bar = inner.indexOf("|");
  let head = "", target = bar >= 0 ? inner.slice(0, bar) : inner, tail = bar >= 0 ? inner.slice(bar) : "";
  // Atlas verbs: @Atlas[reveal: wayfarer]
  const verb = module === "Atlas" && target.match(/^(\s*\w+\s*:\s*)(.*)$/);
  if ( verb ) { head = verb[1]; target = verb[2]; }
  const lead = target.match(/^\s*/)[0];
  const trail = target.match(/\s*$/)[0];
  return { module, target: target.trim(), head: head + lead, tail: trail + tail, label: m[3] ?? null };
}

/** Rebuild a button with another target (and a label when it had none). */
export function joinButton(b, target, label = b.label) {
  return `@${b.module}[${b.head}${target}${b.tail}]${label ? `{${label}}` : ""}`;
}

/**
 * The names a trigger that is a key stands for (`at=wayfarer` → «The Ubiquitous Wayfarer», «Ο Πανταχού Οδοιπόρος»,
 * the Theater labels, the Atlas name), so the Prompter wakes it whatever the table reports.
 * @returns {string[]}  the trigger itself first
 */
export function triggerNames(trigger, thingFor) {
  const p = parseKey(trigger);
  const thing = p ? thingFor(p.base) : null;
  if ( !thing ) return [trigger];
  return [trigger, ...new Set([...thing.names, ...thing.theater, ...(thing.atlas ? [thing.atlas] : [])])];
}

/** A key's display words for a button that had no label: «Ο Πανταχού Οδοιπόρος + Ράιεν». */
export function defaultLabel(thing, parsed, thingFor = () => null) {
  const first = t => String(t.title).split(/\s*\(/)[0].trim();
  const people = parsed.with.map(k => thingFor(k)).filter(Boolean).map(first);
  return [first(thing), ...people].join(" + ") + (parsed.variant ? ` · ${parsed.variant}` : "");
}
