/**
 * Planar Codex — Library (Βιβλιοθήκη), the pure part (no Foundry globals: unit-tested in Node).
 *
 * The books the GM owns, as Markdown files (one folder per book, one file per chapter), imported into a GM-only
 * compendium. Book citations in notes (`ToFW, Ch. 2 › Harmonium Officers`) open the section they name.
 *
 * A citation is: a book code, an optional year, then places separated by "›" (or ","):
 *   `PHB 2024, Ch. 3`   `DMG 2024, Ch. 7 › Using a Potion`   `SatO, Ch. 2 › Market Ward › Great Bazaar`   `› M3`
 * "› M3" (no book) means "the same book as the citation before it".
 */
import { fold } from "../prompter/core.mjs";
import { sectionsOf, tablesOf, stripMd } from "../lens/core.mjs";

export { sectionsOf };

/* -------------------------------------------- */
/*  Books                                       */
/* -------------------------------------------- */

/** Book codes from an index note: a table with "code" and "book" columns → [{code, book}]. */
export function parseBookIndex(markdown) {
  const out = [];
  for ( const t of tablesOf(markdown) ) {
    const h = t.header.map(x => fold(x));
    const ci = h.indexOf("code"), bi = h.indexOf("book");
    if ( ci < 0 || bi < 0 ) continue;
    for ( const r of t.rows ) {
      const code = stripMd(r.cells[ci] ?? ""), book = stripMd(r.cells[bi] ?? "");
      if ( code && book ) out.push({ code, book });
    }
  }
  return out;
}

/** A short code for a book with no index row: the capitals and digits of its name ("Monster Manual (2025)" → "MM"). */
export function guessCode(name) {
  const clean = String(name ?? "").replace(/\(.*?\)/g, " ");
  const caps = clean.split(/[\s_:–-]+/).filter(w => /^[A-Z0-9]/.test(w)).map(w => w[0]).join("");
  return caps || clean.trim().slice(0, 4) || "BOOK";
}

/** Folder name ↔ book name: index rows may write ":" where the folder has "_" (file systems forbid ":"). */
const bookKey = s => fold(String(s ?? "").replace(/_/g, ":"));
export function codeForFolder(folder, index = []) {
  return index.find(r => bookKey(r.book) === bookKey(folder))?.code ?? guessCode(folder);
}

/** Files of a book in reading order (numeric prefixes first, files starting with "_" left out). */
export function bookFiles(paths) {
  return paths.filter(p => /\.md$/i.test(p) && !/^_/.test(p.split("/").pop()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** A chapter's display name from its file name: "03-02 - Chapter 6 - Curst.md" → "Chapter 6 - Curst". */
export function chapterName(file) {
  return String(file ?? "").split("/").pop().replace(/\.md$/i, "").replace(/^[\d-]+\s*-\s*/, "").trim() || file;
}

/**
 * Batches of pages that stay under a size (so one database call isn't too big): [[item, …], …].
 * @param {{size: number}[]} items
 */
export function batchBySize(items, maxBytes = 400000, maxCount = 25) {
  const out = [];
  let cur = [], bytes = 0;
  for ( const it of items ) {
    if ( cur.length && (bytes + it.size > maxBytes || cur.length >= maxCount) ) { out.push(cur); cur = []; bytes = 0; }
    cur.push(it);
    bytes += it.size;
  }
  if ( cur.length ) out.push(cur);
  return out;
}

/* -------------------------------------------- */
/*  Citations                                   */
/* -------------------------------------------- */

/**
 * Read a citation.
 * @returns {{code: string|null, segments: string[], hint: string}}  code null = the same book as before ("› M3").
 */
export function parseCitation(text) {
  const t = String(text ?? "").trim();
  if ( !t ) return { code: null, segments: [], hint: "" };
  const parts = t.split("›").map(s => s.trim());
  let code = null;
  const segments = [];
  if ( parts[0] ) {
    // "ToFW, Ch. 2" → code ToFW, segment "Ch. 2"; "PHB 2024, Ch. 3" → code PHB; "AATM" → code AATM.
    const [head, ...rest] = parts[0].split(",").map(s => s.trim());
    const m = head.match(/^(\S+)(?:\s+(?:\d{4}))?(?:\s+(.*))?$/);
    code = m ? m[1].replace(/[^\w]/g, "") : head;
    if ( m?.[2] ) segments.push(m[2]);
    segments.push(...rest.filter(Boolean));
  }
  segments.push(...parts.slice(1).filter(Boolean));
  // A note in brackets on the last place is a hint, not part of the heading.
  let hint = "";
  if ( segments.length ) {
    const last = segments[segments.length - 1];
    const h = last.match(/^(.*?)\s*\((.*)\)\s*$/);
    if ( h && h[1] ) { segments[segments.length - 1] = h[1]; hint = h[2]; }
  }
  return { code: code || null, segments: segments.map(s => s.replace(/[*`]/g, "").trim()).filter(Boolean), hint };
}

/** Fold a heading or a citation place, spelling out the usual abbreviations ("Ch. 2" → "chapter 2"). */
export function foldPlace(text) {
  return fold(String(text ?? "")
    .replace(/\bCh\.?\s*(?=\d)/gi, "Chapter ")
    .replace(/\bApp\.?\s/gi, "Appendix ")
    .replace(/\bPt\.?\s*(?=\d)/gi, "Part ")
    .replace(/\bIntro\b\.?/gi, "Introduction"));
}

/**
 * How well a heading answers a place: 100 the same, 80 the heading starts with it as whole words
 * ("chapter 2" → "chapter 2 philosophers with clubs"), 60 the place starts with the heading,
 * 40 the heading contains it as words, 0 no.
 */
export function placeScore(heading, place) {
  const h = foldPlace(heading), p = foldPlace(place);
  if ( !h || !p ) return 0;
  if ( h === p ) return 100;
  if ( h.startsWith(`${p} `) ) return 80;
  if ( p.startsWith(`${h} `) ) return 60;
  if ( ` ${h} `.includes(` ${p} `) ) return 40;
  return 0;
}

/**
 * Find the section a citation names in a book.
 * @param {{name: string, sections: {level, text, line}[]}[]} chapters  the book's files, in order
 * @param {string[]} segments  the citation's places, outermost first
 * @returns {{chapter: number, section: number, score: number}|null}  section -1 = the whole chapter
 */
export function findSection(chapters, segments) {
  if ( !segments.length ) return chapters.length ? { chapter: 0, section: -1, score: 1 } : null;
  const target = segments[segments.length - 1];
  const context = segments.slice(0, -1);
  let best = null;
  chapters.forEach((ch, ci) => {
    const chapterBonus = Math.max(0, ...context.map(c => placeScore(ch.name, c) ? 15 : 0), ...context.map(c => ch.sections.some(s => s.level <= 2 && placeScore(s.text, c) >= 60) ? 15 : 0));
    // The chapter file itself can be the answer ("PHB 2024, Ch. 3").
    const own = placeScore(ch.name, target);
    if ( own && (!best || own + chapterBonus > best.score) ) best = { chapter: ci, section: -1, score: own + chapterBonus };
    const open = [];
    ch.sections.forEach((s, si) => {
      while ( open.length && open[open.length - 1].level >= s.level ) open.pop();
      const score = placeScore(s.text, target);
      if ( score ) {
        let bonus = chapterBonus;
        for ( const c of context ) if ( open.some(o => placeScore(o.text, c) >= 60) ) bonus += 20;
        bonus -= s.level;  // the higher heading wins a tie
        const total = score + bonus;
        if ( !best || total > best.score ) best = { chapter: ci, section: si, score: total };
      }
      open.push(s);
    });
  });
  if ( best ) return best;
  // Nothing named the last place: settle for the deepest context that matches.
  return context.length ? findSection(chapters, context) : null;
}

/**
 * The part of a chapter under one heading (subsections included).
 * @returns {string} Markdown
 */
export function sectionMarkdown(markdown, sections, index) {
  if ( index < 0 ) return markdown;
  const s = sections[index];
  if ( !s ) return markdown;
  const lines = String(markdown).split(/\r?\n/);
  const end = Number.isFinite(s.endLine) ? s.endLine + 1 : lines.length;
  return lines.slice(s.line, end).join("\n");
}

/* -------------------------------------------- */
/*  Search                                      */
/* -------------------------------------------- */

/**
 * Search chapters: headings first, then text.
 * @param {{book: string, code: string, chapter: number, name: string, sections: {level, text, body, line}[]}[]} chapters
 * @param {string} query
 * @returns {{code, book, chapter, name, section, heading, level, score, excerpt}[]}
 */
export function searchBooks(chapters, query, max = 40) {
  const q = fold(query);
  if ( q.length < 2 ) return [];
  const words = q.split(" ").filter(w => w.length > 1);
  const hits = [];
  for ( const ch of chapters ) {
    ch.sections.forEach((s, si) => {
      const head = foldPlace(s.text);
      let score = 0;
      if ( head === q ) score = 100;
      else if ( head.startsWith(q) ) score = 80;
      else if ( ` ${head} `.includes(` ${q} `) ) score = 60;
      else if ( words.length > 1 && words.every(w => head.includes(w)) ) score = 50;
      let excerpt = "";
      if ( !score ) {
        const own = [];
        for ( const line of String(s.body ?? "").split("\n") ) { if ( /^#{1,6}\s/.test(line) ) break; own.push(line); }
        const body = own.join(" ");
        const fb = fold(body);
        const at = ` ${fb} `.indexOf(` ${q} `);
        if ( at >= 0 ) { score = 20 + Math.max(0, 10 - s.level); excerpt = around(stripMd(body), fb, at); }
        else if ( words.length > 1 && words.every(w => ` ${fb} `.includes(` ${w} `)) ) { score = 10; excerpt = stripMd(body).slice(0, 140); }
      }
      if ( score ) hits.push({ code: ch.code, book: ch.book, chapter: ch.chapter, name: ch.name, section: si, heading: s.text, level: s.level, score, excerpt });
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.level - b.level).slice(0, max);
}

function around(plain, folded, at, size = 150) {
  const ratio = plain.length / Math.max(folded.length, 1);
  const start = Math.max(0, Math.round(at * ratio) - 50);
  const cut = plain.slice(start, start + size).trim();
  return `${start > 0 ? "…" : ""}${cut}${start + size < plain.length ? "…" : ""}`;
}
