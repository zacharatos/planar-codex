/**
 * Planar Codex — Lens (Φακός), the pure part (no Foundry globals: unit-tested in Node).
 *
 * The Lens shows everything the notes know about one thing at the table: a person, a place, a name.
 * It reads notes the GM already keeps, by their frontmatter:
 *
 *   type: npcs     people as headings with field bullets   ### Brannoc (ο Μπράνοκ; smith, Low Ward) — met S02
 *                                                           - **Want / Fear / Tell:** … / … / …
 *                  and tables whose first column is NPC / Name / Who
 *   type: ledger   numbered tables (first column "#"): the open threads and promises
 *   tag glossary   two-column tables that pair names (English | Ελληνικά): every row is one name in two languages
 *
 * Matching is by whole words, accents and case ignored, with leading articles dropped
 * ("The Hall of Records" matches "Hall of Records"; «το Αρχειοφυλάκειο» matches «Αρχειοφυλάκειο»).
 */
import { fold } from "../prompter/core.mjs";

export { fold };

/** Articles dropped from the start of a name before matching (English and Greek). */
const ARTICLES = new Set(["the", "a", "an", "ο", "η", "το", "οι", "τα", "του", "τησ", "των", "τον", "την", "τουσ", "τισ"]);
const MIN_NAME = 3;
const hasGreek = s => /[Ͱ-Ͽἀ-῿]/.test(s);
const hasLatin = s => /[A-Za-z]/.test(s);

/* -------------------------------------------- */
/*  Text                                        */
/* -------------------------------------------- */

/** Markdown inline → plain text: [[a|b]] → b, [[a]] → a, bold/italic/code marks and table escapes removed. */
export function stripMd(text) {
  return String(text ?? "")
    .replace(/\\\|/g, "|")
    .replace(/!?\[\[([^\]|]+?)(?:#[^\]|]*)?\|([^\]]+?)\]\]/g, "$2")
    .replace(/!?\[\[([^\]|#]+?)(?:#[^\]]*)?\]\]/g, (m, a) => a.split("/").pop())
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|==|~~)/g, "")
    .replace(/(^|[\s(])[*_](\S[^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One line of a note as reading text: no quote markers, no callout header syntax ("[!beat|must|at=…] Title" → "Title"),
 * roll enrichers shown as a die, list markers and heading marks dropped.
 */
export function plainLine(line) {
  return String(line ?? "")
    .replace(/^\s*(?:>\s?)+/, "")
    .replace(/\[![\w-]+(?:\|[^\]]*)?\][+-]?\s*/g, "")
    .replace(/\[\[\/[^\]]*\]\](?:\{([^}]*)\})?/g, (m, label) => (label ? `🎲 ${label}` : "🎲"))
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/%%[^%]*%%/g, "");
}

/** Lines of Markdown as one reading text (see plainLine). */
export const plainText = text => String(text ?? "").split(/\r?\n/).map(plainLine).filter(l => l.trim()).join(" ");

/** The ways a name can be written, folded: as is, without a leading article, before a comma. */
export function nameVariants(name) {
  const out = new Set();
  const add = v => {
    const f = fold(v);
    if ( f.length < MIN_NAME ) return;
    out.add(f);
    const words = f.split(" ");
    if ( words.length > 1 && ARTICLES.has(words[0]) ) {
      const rest = words.slice(1).join(" ");
      if ( rest.length >= MIN_NAME ) out.add(rest);
    }
  };
  const plain = stripMd(name).replace(/\([^)]*\)/g, " ").trim();
  add(plain);
  if ( plain.includes(",") ) add(plain.split(",")[0]);
  return [...out];
}

/** Does folded text contain one of the folded names as whole words? */
export function mentions(foldedText, variants) {
  const hay = ` ${foldedText} `;
  return variants.some(v => v && hay.includes(` ${v} `));
}

/** A short plain excerpt around the first mention. */
export function excerpt(text, variants, size = 160) {
  const plain = stripMd(text);
  const folded = fold(plain);
  let at = -1;
  for ( const v of variants ) {
    const i = ` ${folded} `.indexOf(` ${v} `);
    if ( i >= 0 && (at < 0 || i < at) ) at = i;
  }
  if ( plain.length <= size ) return plain;
  // fold() keeps letters and digits in place and collapses the rest, so positions only drift a little.
  const ratio = plain.length / Math.max(folded.length, 1);
  const centre = at < 0 ? 0 : Math.round(at * ratio);
  const start = Math.max(0, centre - Math.round(size / 3));
  const cut = plain.slice(start, start + size);
  return `${start > 0 ? "…" : ""}${cut.trim()}${start + size < plain.length ? "…" : ""}`;
}

/* -------------------------------------------- */
/*  Markdown structure                          */
/* -------------------------------------------- */

/** Where the content starts: the line after the frontmatter, or 0. */
function bodyStart(lines) {
  if ( lines[0]?.trim() !== "---" ) return 0;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end > 0 ? end + 1 : 0;
}

/** Lines outside fenced code blocks and frontmatter, with their numbers. */
function* contentLines(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  let fence = null;
  for ( let i = bodyStart(lines); i < lines.length; i++ ) {
    const line = lines[i];
    const f = line.match(/^\s*(```|~~~)/);
    if ( f ) { fence = fence ? (fence === f[1] ? null : fence) : f[1]; continue; }
    if ( fence ) continue;
    yield { line, n: i };
  }
}

/**
 * Sections by heading: [{level, text, raw, line, endLine, body}]. A section's body is the lines under its heading,
 * its subsections included, up to the next heading of the same or a higher level.
 * Text before the first heading is a section of level 0 with empty text (left out when blank).
 */
export function sectionsOf(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const heads = [];
  for ( const { line, n } of contentLines(markdown) ) {
    // Headings inside a quoted box count too (books put sidebars in quotes: "> ##### Faction Taboo").
    const h = line.match(/^(?:\s*>)*\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if ( h ) heads.push({ level: h[1].length, raw: h[2], text: stripMd(h[2]), line: n });
  }
  const out = [];
  const start = bodyStart(lines);
  const firstHead = heads[0]?.line ?? lines.length;
  const pre = lines.slice(start, firstHead).join("\n");
  if ( pre.trim() ) out.push({ level: 0, text: "", raw: "", line: start, endLine: firstHead - 1, body: pre });
  heads.forEach((h, i) => {
    const next = heads.slice(i + 1).find(x => x.level <= h.level);
    const end = next ? next.line : lines.length;
    out.push({ ...h, endLine: end - 1, body: lines.slice(h.line + 1, end).join("\n") });
  });
  return out;
}

/** Split a table row into cells (escaped pipes kept inside a cell). */
export function tableCells(line) {
  const t = line.trim();
  if ( !t.startsWith("|") ) return null;
  const cells = [];
  let cur = "";
  for ( let i = 1; i < t.length; i++ ) {
    const ch = t[i];
    if ( ch === "\\" && t[i + 1] === "|" ) { cur += "\\|"; i++; continue; }
    if ( ch === "|" ) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if ( cur.trim() ) cells.push(cur.trim());
  return cells;
}

/** Tables: [{header: [..], rows: [{cells, line}], line, heading}] (heading = the nearest h2/h3 above). */
export function tablesOf(markdown) {
  const out = [];
  let heading = "";
  let cur = null;
  let prev = null;
  for ( const { line, n } of contentLines(markdown) ) {
    const h = line.match(/^(#{1,6})\s+(.+)/);
    if ( h ) { heading = stripMd(h[2]); cur = null; prev = null; continue; }
    const cells = tableCells(line);
    if ( !cells ) { cur = null; prev = null; continue; }
    if ( cells.every(c => /^:?-{2,}:?$/.test(c)) ) {
      if ( prev && !cur ) { cur = { header: prev.cells, rows: [], line: prev.n, heading }; out.push(cur); }
      continue;
    }
    if ( cur ) cur.rows.push({ cells, line: n });
    else prev = { cells, n };
  }
  return out;
}

/* -------------------------------------------- */
/*  People                                      */
/* -------------------------------------------- */

const FIELD_KINDS = [
  ["wft", /\bwant\b|θελει/],
  ["fear", /^fears?\b|^φοβ/],
  ["tell", /^tell\b|^σημαδι/],
  ["voice", /\bvoice\b|φωνη/],
  ["attitude", /\battitude\b|σταση/],
  ["knows", /\bknow|ξερει/],
  ["status", /\bstatus\b|κατασταση/],
  ["book", /\bbook\b|reference|βιβλιο/]
];
export function fieldKind(label) {
  const f = fold(label);
  return FIELD_KINDS.find(([, re]) => re.test(f))?.[0] ?? "other";
}

/**
 * Want, Fear and Tell written as three fields (or three table columns) → one «want / fear / tell» field, as the Lens shows it.
 * @param {{label, value, kind}[]} fields
 */
export function combineWft(fields) {
  const want = fields.find(f => f.kind === "wft");
  const fear = fields.find(f => f.kind === "fear");
  const tell = fields.find(f => f.kind === "tell");
  if ( !fear && !tell ) return fields;
  if ( want && /\//.test(want.label) ) return fields;
  const value = [want?.value, fear?.value, tell?.value].map(v => stripMd(v ?? "") || "—").join(" / ");
  const merged = { label: "Want / Fear / Tell", value, kind: "wft" };
  return [merged, ...fields.filter(f => ![want, fear, tell].includes(f))];
}

/**
 * A person heading or table cell: «Farrow, Echo of the Wheel (Φάροου, ο Αντίλαλος; homebrew; the Trollskull) — first met S00».
 * The first part in brackets gives other names when it is in the other script (Greek for an English name, or the reverse).
 */
export function parsePersonTitle(raw) {
  // A homebrew mark at the end ("… (the Taker) [HB]") is about the person, not part of the name.
  let text = stripMd(raw);
  const marks = [];
  text = text.replace(/\s*\[(HB|HOMEBREW|homebrew|hb)\]\s*/g, () => { marks.push("homebrew"); return " "; }).trim();
  const [title, ...after] = text.split(/\s+[—–]\s+/);
  const m = title.match(/^(.*?)\s*\((.*)\)\s*$/);
  const name = (m ? m[1] : title).trim();
  const parts = m ? m[2].split(";").map(s => s.trim()).filter(Boolean) : [];
  const aliases = [];
  const about = [];
  const capital = w => /^[A-ZΑ-ΩΆΈΉΊΌΎΏ0-9]/u.test(w);
  parts.forEach((p, i) => {
    const otherScript = (hasGreek(name) && !hasGreek(p) && hasLatin(p)) || (!hasGreek(name) && hasGreek(p));
    const pieces = p.split(",").map(x => x.trim()).filter(Boolean);
    const nameLike = pieces.every(x => x.split(/\s+/).length <= 6);
    if ( i === 0 && otherScript && nameLike ) {
      // "Parisa, bariaur tout": with commas, only the pieces that look like names (a capital letter) are names.
      const named = pieces.length > 1 ? pieces.filter(x => x.split(/\s+/).some(capital)) : pieces;
      aliases.push(...named);
      const rest = pieces.filter(x => !named.includes(x));
      if ( rest.length ) about.push(rest.join(", "));
    }
    else about.push(p);
  });
  if ( marks.length && !about.some(a => /homebrew/i.test(a)) ) about.push("homebrew");
  return { name, aliases, about: about.join("; "), note: after.join(" — ").trim() };
}

const SKIP_HEADINGS = /^(template|name|πρότυπο|ονομα)\b/i;
const NAME_COLUMNS = /^(npc|name|who|person|ονομα|ποιοσ)$/;

/**
 * People in a note: heading blocks with `- **Label:** value` bullets, and rows of tables whose first column is a name.
 * @returns {{name, aliases, about, note, fields: {label, value, kind}[], line, source}[]}
 */
export function parsePeople(markdown, source = "", { requireWft = false } = {}) {
  const people = [];
  for ( const sec of sectionsOf(markdown) ) {
    if ( sec.level < 2 || SKIP_HEADINGS.test(sec.text) ) continue;
    const fields = [];
    for ( const line of sec.body.split("\n") ) {
      if ( /^#{1,6}\s/.test(line) ) break;
      const f = line.match(/^\s*[-*]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/);
      if ( f ) fields.push({ label: f[1].replace(/:$/, "").trim(), value: f[2].trim(), kind: fieldKind(f[1]) });
    }
    if ( !fields.length ) continue;
    const t = parsePersonTitle(sec.raw);
    if ( !t.name ) continue;
    people.push({ ...t, fields: combineWft(fields), line: sec.line, source });
  }
  for ( const table of tablesOf(markdown) ) {
    if ( !NAME_COLUMNS.test(fold(table.header[0] ?? "")) ) continue;
    for ( const row of table.rows ) {
      const t = parsePersonTitle(row.cells[0] ?? "");
      if ( !t.name ) continue;
      const fields = table.header.slice(1).map((label, i) => ({ label: stripMd(label), value: row.cells[i + 1] ?? "", kind: fieldKind(label) }))
        .filter(f => stripMd(f.value) && !/^[—–-]$/.test(stripMd(f.value)));
      people.push({ ...t, fields: combineWft(fields), line: row.line, source, row: true });
    }
  }
  // Outside the NPC notes (prep, homebrew), only entries with a want / fear / tell are people: scene headings aren't.
  return mergePeople(requireWft ? people.filter(p => p.fields.some(f => f.kind === "wft")) : people);
}

/**
 * People from several notes, as one list: the first note that has a person keeps them (the NPC notes come first, so
 * "as played" wins over "as prepared"); the same person in a later note adds its new fields and is remembered in `also`.
 * @param {{person: object, page: any}[][]} lists  in order of authority
 * @returns {{person: object, page: any, also: {page: any, line: number}[]}[]}
 */
export function mergeAcross(lists) {
  const out = [];
  // Full names, with and without a leading article («ο Ζοκ» is «Ζοκ»); not the part before a comma (too loose).
  const keys = p => new Set([p.name, ...p.aliases].flatMap(n => {
    const f = fold(stripMd(n).replace(/\([^)]*\)/g, " "));
    const words = f.split(" ");
    return words.length > 1 && ARTICLES.has(words[0]) ? [f, words.slice(1).join(" ")] : [f];
  }).filter(k => k.length >= MIN_NAME));
  for ( const list of lists ) {
    for ( const { person, page } of list ) {
      const mine = keys(person);
      const same = out.find(o => [...keys(o.person)].some(k => mine.has(k)));
      if ( !same ) { out.push({ person: { ...person, fields: [...person.fields], aliases: [...person.aliases] }, page, also: [] }); continue; }
      if ( same.page === page && same.person.line === person.line ) continue;
      same.also.push({ page, line: person.line });
      for ( const a of [person.name, ...person.aliases] ) {
        if ( fold(a) !== fold(same.person.name) && !same.person.aliases.some(x => fold(x) === fold(a)) ) same.person.aliases.push(a);
      }
      const have = new Set(same.person.fields.map(f => `${f.kind}|${fold(f.value)}`));
      for ( const f of person.fields ) if ( !have.has(`${f.kind}|${fold(f.value)}`) ) same.person.fields.push({ ...f, extra: true, from: page });
    }
  }
  return out;
}


/**
 * The as-played fields for an NPC card: npcs.md's own lines, plus a merged line from a prep note only when
 * npcs.md has nothing of that kind (two «Want / Fear / Tell» lines read as a contradiction at the table).
 */
export function playedFields(fields) {
  const own = new Set(fields.filter(f => !f.extra).map(f => f.kind));
  return fields.filter(f => !f.extra || !own.has(f.kind));
}

/** One entry per person: a heading block and a table row about the same name become one (heading first). */
export function mergePeople(list) {
  const out = [];
  for ( const p of list ) {
    const key = fold(stripMd(p.name));
    const same = out.find(o => o.source === p.source && [o.name, ...o.aliases].some(n => fold(stripMd(n)) === key));
    if ( !same ) { out.push({ ...p, fields: [...p.fields], aliases: [...p.aliases] }); continue; }
    for ( const a of p.aliases ) if ( !same.aliases.includes(a) ) same.aliases.push(a);
    if ( !same.about && p.about ) same.about = p.about;
    const have = new Set(same.fields.map(f => `${f.kind}|${fold(f.value)}`));
    for ( const f of p.fields ) if ( !have.has(`${f.kind}|${fold(f.value)}`) ) same.fields.push({ ...f, extra: true });
  }
  return out;
}

/** Every folded way to write a person's name. */
export const personVariants = p => [...new Set([p.name, ...p.aliases].flatMap(nameVariants))];

/* -------------------------------------------- */
/*  Ledger (threads)                            */
/* -------------------------------------------- */

const COLUMN_KINDS = [["owner", /owner|who|κατοχ|ποιο/], ["made", /made|session|since|ποτε/], ["payoff", /payoff|pay off|where|πληρω/], ["status", /status|κατασταση/]];
const columnKind = label => COLUMN_KINDS.find(([, re]) => re.test(fold(label)))?.[0] ?? null;

/**
 * Numbered rows of the ledger: [{n, text, owner, made, payoff, status, section, line}].
 * A ledger table's first column is "#"; its second column is the thread itself.
 */
export function parseLedger(markdown) {
  const out = [];
  for ( const table of tablesOf(markdown) ) {
    if ( !/^(#|no\.?|n)$/i.test(stripMd(table.header[0] ?? "")) ) continue;
    const kinds = table.header.map(columnKind);
    for ( const row of table.rows ) {
      const n = stripMd(row.cells[0]).replace(/^#/, "");
      if ( !/^\d+[a-z]?$/i.test(n) ) continue;
      const entry = { n, text: row.cells[1] ?? "", owner: "", made: "", payoff: "", status: "", section: table.heading, line: row.line };
      kinds.forEach((k, i) => { if ( k && i > 1 ) entry[k] = row.cells[i] ?? ""; });
      out.push(entry);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Glossary                                    */
/* -------------------------------------------- */

/**
 * Name pairs from a glossary note: every table row whose first two cells are short names → [english, greek].
 * Cells may hold alternatives ("Σίγκιλ / το Κλουβί") and bold.
 */
export function parseGlossary(markdown) {
  const out = [];
  const clean = cell => stripMd(cell).replace(/\s*\(.*?\)\s*/g, " ").trim();
  for ( const table of tablesOf(markdown) ) {
    if ( table.header.length < 2 ) continue;
    for ( const row of table.rows ) {
      const a = clean(row.cells[0] ?? "");
      const b = clean(row.cells[1] ?? "");
      const short = x => x.length <= 50 && x.split(/\s+/).length <= 7;
      if ( !a || !b || !short(a) || !short(b) || fold(a) === fold(b) ) continue;
      const names = [a, b].flatMap(x => x.split(/\s+[/·]\s+/)).map(x => x.trim()).filter(Boolean);
      out.push(names);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Names → everything                          */
/* -------------------------------------------- */

/**
 * A lookup of name groups: each group is the names of one thing in every language and spelling.
 * groups: string[][] (glossary rows, people's names + aliases).
 */
export class NameBook {
  #groups = [];
  #index = new Map();

  constructor(groups = []) { for ( const g of groups ) this.add(g); }

  add(names) {
    const id = this.#groups.length;
    const variants = [...new Set(names.flatMap(nameVariants))];
    if ( !variants.length ) return;
    this.#groups.push({ names, variants });
    for ( const v of variants ) {
      const list = this.#index.get(v) ?? [];
      list.push(id);
      this.#index.set(v, list);
    }
  }

  /** The names that mean the same thing as `query` (query first), and all their folded variants. */
  expand(query) {
    const names = [String(query ?? "").trim()].filter(Boolean);
    const variants = new Set(nameVariants(query));
    const seen = new Set();
    const ids = v => {
      const exact = this.#index.get(v);
      if ( exact?.length ) return exact;
      // A first name finds the whole name ("Marina" → "Marina Kollia"), when nothing has exactly that name.
      if ( v.length < 4 ) return [];
      const out = [];
      for ( const [k, list] of this.#index ) if ( k.startsWith(`${v} `) ) out.push(...list);
      return out;
    };
    for ( const v of [...variants] ) {
      for ( const id of ids(v) ) {
        if ( seen.has(id) ) continue;
        seen.add(id);
        const g = this.#groups[id];
        for ( const n of g.names ) if ( !names.some(x => fold(x) === fold(n)) ) names.push(n);
        for ( const x of g.variants ) variants.add(x);
      }
    }
    return { names, variants: [...variants] };
  }
}

/**
 * What the table just showed, as names for the Lens: Theater labels ("Ch02 - 07 - The Hall of Records · Το Αρχειοφυλάκειο"),
 * Atlas stops, NPC cards ("Athar null (the philosopher)"), scene names.
 * Drops file-style numbering, view notes in brackets and "+ someone" variants; keeps every part as a name.
 */
export function namesFromLabel(label) {
  const parts = String(label ?? "").split(/\s+·\s+|\s+\|\s+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for ( let p of parts ) {
    if ( /\.(webp|png|jpe?g|avif|gif)$/i.test(p) ) p = p.replace(/\.[a-z0-9]+$/i, "").split("/").pop();
    p = p.replace(/^(?:[A-Za-zΑ-Ωα-ω]{0,4}\d+[a-z]?\s*[-–—:.]\s*)+/u, "");
    const [main, ...plus] = p.split(/\s+\+\s+/);
    const dashed = main.split(/\s+[-–]\s+/);
    for ( const x of [main, ...(dashed.length > 1 ? dashed : []), ...plus] ) {
      const n = x.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      if ( n && fold(n).length >= MIN_NAME && !out.some(o => fold(o) === fold(n)) ) out.push(n);
    }
  }
  return out;
}

/**
 * Sections of a note that mention a name, best first: [{heading, line, level, excerpt, count}].
 * A section whose heading names the thing comes first, then the sections that mention it most.
 * Only a section's own text counts (its subsections are sections of their own).
 * @param {string} markdown
 * @param {string[]} variants  folded names
 * @param {number} [max]
 */
export function mentionsIn(markdown, variants, max = 5) {
  const hits = [];
  sectionsOf(markdown).forEach((sec, order) => {
    const own = [];
    for ( const line of sec.body.split("\n") ) {
      if ( /^#{1,6}\s/.test(line) ) break;
      own.push(line);
    }
    const inHeading = mentions(fold(sec.text), variants);
    const body = ` ${fold(own.join("\n"))} `;
    const count = variants.reduce((n, v) => n + (v ? body.split(` ${v} `).length - 1 : 0), 0);
    if ( !inHeading && !count ) return;
    // A list or a table (a session's live log): the lines that name it, not the whole section run together.
    const named = own.filter(l => /^\s*(?:[-*+]\s|\d+[.)]\s|\|)/.test(l) && mentions(fold(l), variants)).map(plainLine).map(l => l.trim()).filter(Boolean);
    const text = named.length ? named.slice(0, 2).join(" · ") : plainText(own.join("\n"));
    hits.push({ heading: sec.text, level: sec.level, line: sec.line, count, inHeading, order,
      excerpt: excerpt(text || sec.text, variants, 150) });
  });
  return hits.sort((a, b) => (b.inHeading - a.inHeading) || (b.count - a.count) || (a.order - b.order)).slice(0, max);
}

/** A run sheet without its beat callouts (the Lens lists beats on their own). */
export function withoutBeats(markdown) {
  const out = [];
  let inBeat = false;
  for ( const line of String(markdown ?? "").split(/\r?\n/) ) {
    if ( /^\s*>\s*\[!beat\b/i.test(line) ) { inBeat = true; continue; }
    if ( inBeat && /^\s*>/.test(line) ) continue;
    inBeat = false;
    out.push(line);
  }
  return out.join("\n");
}

/** All the text of a ledger row, for matching. */
export const ledgerText = row => [row.text, row.owner, row.made, row.payoff, row.status].join(" ");

/** Book citations written in a text (`ToFW, Ch. 2 › Harmonium Officers`), in order. */
export function citationsIn(text, citationRe) {
  const out = [];
  for ( const m of String(text ?? "").matchAll(/`([^`\n]+)`/g) ) {
    const t = m[1].trim();
    if ( citationRe.test(t) && !out.includes(t) ) out.push(t);
  }
  return out;
}

/* -------------------------------------------- */
/*  Place and NPC cards (0.8)                   */
/* -------------------------------------------- */

/**
 * The fixed headings of a place note (`type: place`) and an NPC note (`type: npc`), Greek or English.
 * Every section is optional; anything else is shown after them under its own heading.
 */
export const PLACE_SECTIONS = {
  glance: ["Με μια ματιά", "At a glance", "Overview"],
  where: ["Πού είναι", "Where it is", "Where", "Location"],
  readaloud: ["Ανάγνωση", "Read-aloud", "Read aloud", "Readaloud"],
  senses: ["Αισθήσεις", "Senses"],
  view: ["Η ματιά από εδώ", "The view from here", "Point of view", "View"],
  who: ["Ποιοι είναι εδώ", "Ποιος είναι εδώ", "Who is here", "Who's here", "People here"],
  events: ["Τι μπορεί να συμβεί", "What can happen", "Events", "Random events"],
  secrets: ["Μυστικά και στοιχεία", "Μυστικά", "Secrets and clues", "Secrets", "Clues"],
  prices: ["Τιμές και υπηρεσίες", "Τιμές", "Prices and services", "Prices", "Services"],
  whispers: ["Ψίθυροι", "Whispers", "Private lines"],
  remember: ["Θυμήσου", "Remember", "Notes"]
};
export const NPC_SECTIONS = {
  who: ["Ποια είναι", "Ποιος είναι", "Ποιοι είναι", "Who she is", "Who he is", "Who they are", "Who"],
  look: ["Εμφάνιση", "Appearance", "Looks", "Look"],
  voice: ["Φωνή και τρόπος", "Φωνή", "Voice and manner", "Voice", "Roleplay", "Roleplaying"],
  wfh: ["Θέλει · Φοβάται · Κρύβει", "Θέλει, φοβάται, κρύβει", "Wants · Fears · Hides", "Want / Fear / Hide", "Wants, fears, hides", "Motives"],
  attitude: ["Στάση απέναντι στην ομάδα", "Στάση", "Attitude to the party", "Attitude"],
  knows: ["Τι ξέρει", "What she knows", "What he knows", "What they know", "Knowledge", "Knows"],
  secrets: ["Μυστικά", "Secrets"],
  where: ["Πού θα τη βρουν", "Πού θα τον βρουν", "Πού θα τους βρουν", "Πού θα το βρουν", "Where to find her", "Where to find him", "Where to find them", "Where to find"],
  combat: ["Μάχη", "Combat", "In a fight"],
  whispers: ["Ψίθυροι", "Whispers", "Private lines"]
};

const foldedSections = table => Object.fromEntries(Object.entries(table).map(([id, names]) => [id, names.map(n => fold(n))]));
const PLACE_FOLDED = foldedSections(PLACE_SECTIONS);
const NPC_FOLDED = foldedSections(NPC_SECTIONS);

/** Which known section a heading is, or null. */
export function sectionId(heading, kind) {
  const f = fold(stripMd(heading));
  for ( const [id, names] of Object.entries(kind === "npc" ? NPC_FOLDED : PLACE_FOLDED) ) if ( names.includes(f) ) return id;
  return null;
}

/**
 * A place or NPC note as a card.
 * @param {string} markdown
 * @param {"place"|"npc"} kind
 * @returns {{title: string, name: string, aliases: string[], about: string, intro: string, sections: {id: string|null,
 *   heading: string, body: string, line: number}[], by: Record<string, {heading, body, line}>}}
 */
export function parseCard(markdown, kind = "place") {
  const secs = sectionsOf(markdown);
  const h1 = secs.find(s => s.level === 1);
  const titleText = h1 ? h1.raw : "";
  const t = parsePersonTitle(titleText);
  // Text between the title and the first sub-heading (the note's DM box: sources, links).
  let intro = "";
  if ( h1 ) {
    const own = [];
    for ( const line of h1.body.split("\n") ) { if ( /^#{1,6}\s/.test(line) ) break; own.push(line); }
    intro = own.join("\n").trim();
  }
  const level = Math.min(...secs.filter(s => s.level >= 2).map(s => s.level), 2);
  const sections = secs.filter(s => s.level === level && s !== h1).map(s => ({ id: sectionId(s.text, kind), heading: s.text, body: s.body.trim(), line: s.line }));
  const by = {};
  for ( const s of sections ) if ( s.id && !(s.id in by) ) by[s.id] = s;
  return { title: stripMd(titleText), name: t.name, aliases: t.aliases, about: t.about, intro, sections, by };
}

/**
 * `- **Label:** value` bullets of a section, by label (folded): the voice strip (Μιλάει / Κινείται / Σημάδι / Ατάκες)
 * and want · fear · hide (Θέλει / Φοβάται / Κρύβει).
 * @returns {{label: string, value: string}[]}
 */
export function labelledBullets(body) {
  const out = [];
  for ( const line of String(body ?? "").split("\n") ) {
    const m = line.match(/^\s*[-*+]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/);
    if ( m ) out.push({ label: m[1].trim().replace(/:$/, ""), value: m[2].trim() });
    else if ( out.length && /^\s{2,}\S/.test(line) ) out[out.length - 1].value += ` ${line.trim()}`;
  }
  return out;
}

const VOICE_KEYS = {
  speaks: ["μιλαει", "speaks", "speech", "voice"],
  moves: ["κινειται", "moves", "body", "manner"],
  tell: ["σημαδι", "tell", "the tell"],
  lines: ["ατακεσ", "lines", "quotes", "says"]
};
const WFH_KEYS = { want: ["θελει", "wants", "want"], fear: ["φοβαται", "fears", "fear"], hide: ["κρυβει", "hides", "hide", "secret"] };

function pick(bullets, keys) {
  const out = {};
  for ( const b of bullets ) {
    const f = fold(b.label);
    for ( const [k, names] of Object.entries(keys) ) if ( !(k in out) && names.includes(f) ) out[k] = b.value;
  }
  return out;
}
/** The roleplay strip of an NPC note: {speaks, moves, tell, lines} (Markdown, any may be missing). */
export const voiceOf = body => pick(labelledBullets(body), VOICE_KEYS);
/** Want · fear · hide of an NPC note: {want, fear, hide}. */
export const wfhOf = body => pick(labelledBullets(body), WFH_KEYS);

/**
 * The events table of a place: its die (from the first header cell, "d6") and its rows.
 * @returns {{die: number, rows: {n: string, text: string, when: string}[]}|null}
 */
export function eventsOf(body) {
  const table = tablesOf(body)[0];
  if ( !table ) return null;
  const m = String(table.header[0] ?? "").match(/d\s*(\d+)/i);
  const rows = table.rows.map(r => ({ n: stripMd(r.cells[0] ?? ""), text: r.cells[1] ?? "", when: r.cells[2] ?? "" })).filter(r => r.text);
  if ( !rows.length ) return null;
  return { die: m ? Number(m[1]) : rows.length, rows };
}

/** Which row a roll lands on: a row whose first cell is the number or a range ("2-3", "5–6"), else the n-th row. */
export function eventRow(events, roll) {
  const i = events.rows.findIndex(r => {
    const m = r.n.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    return m && roll >= Number(m[1]) && roll <= Number(m[2] ?? m[1]);
  });
  return i >= 0 ? i : (roll - 1 < events.rows.length ? roll - 1 : -1);
}

/** Wiki-link targets in a section ("[[Riaen Blackhome|Ράιεν]]" → "Riaen Blackhome"). */
export function linkTargets(body) {
  const out = [];
  for ( const m of String(body ?? "").matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g) ) {
    const t = m[1].trim();
    if ( t && !out.includes(t) && !/^(npcs|monster:|actor:|item:|spell:)/i.test(t) ) out.push(t);
  }
  return out;
}
