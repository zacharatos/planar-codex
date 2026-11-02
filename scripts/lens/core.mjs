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
 * A person heading or table cell: «Farrow, Echo of the Wheel (Φάροου, ο Αντίλαλος; homebrew; the Trollskull) — first met S00».
 * The first part in brackets gives other names when it is in the other script (Greek for an English name, or the reverse).
 */
export function parsePersonTitle(raw) {
  const text = stripMd(raw);
  const [title, ...after] = text.split(/\s+[—–]\s+/);
  const m = title.match(/^(.*?)\s*\((.*)\)\s*$/);
  const name = (m ? m[1] : title).trim();
  const parts = m ? m[2].split(";").map(s => s.trim()).filter(Boolean) : [];
  const aliases = [];
  const about = [];
  parts.forEach((p, i) => {
    const otherScript = (hasGreek(name) && !hasGreek(p) && hasLatin(p)) || (!hasGreek(name) && hasGreek(p));
    const nameLike = p.split(",").every(x => x.trim().split(/\s+/).length <= 6);
    if ( i === 0 && otherScript && nameLike ) aliases.push(...p.split(",").map(s => s.trim()).filter(Boolean));
    else about.push(p);
  });
  return { name, aliases, about: about.join("; "), note: after.join(" — ").trim() };
}

const SKIP_HEADINGS = /^(template|name|πρότυπο|ονομα)\b/i;
const NAME_COLUMNS = /^(npc|name|who|person|ονομα|ποιοσ)$/;

/**
 * People in a note: heading blocks with `- **Label:** value` bullets, and rows of tables whose first column is a name.
 * @returns {{name, aliases, about, note, fields: {label, value, kind}[], line, source}[]}
 */
export function parsePeople(markdown, source = "") {
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
    people.push({ ...t, fields, line: sec.line, source });
  }
  for ( const table of tablesOf(markdown) ) {
    if ( !NAME_COLUMNS.test(fold(table.header[0] ?? "")) ) continue;
    for ( const row of table.rows ) {
      const t = parsePersonTitle(row.cells[0] ?? "");
      if ( !t.name ) continue;
      const fields = table.header.slice(1).map((label, i) => ({ label: stripMd(label), value: row.cells[i + 1] ?? "", kind: fieldKind(label) }))
        .filter(f => stripMd(f.value) && !/^[—–-]$/.test(stripMd(f.value)));
      people.push({ ...t, fields, line: row.line, source, row: true });
    }
  }
  return mergePeople(people);
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
    hits.push({ heading: sec.text, level: sec.level, line: sec.line, count, inHeading, order,
      excerpt: excerpt(plainText(own.join("\n")) || sec.text, variants, 150) });
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
