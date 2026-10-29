/**
 * Planar Codex — Prompter, the pure part (no Foundry globals: unit-tested in Node).
 *
 * A run sheet holds the session's deck as beat callouts:
 *
 *   > [!beat|should|at=The Old Library; the archivist; any official paper|pc=Ilsa, Brannoc|ledger=8,53|missed=1] The forged deed
 *   >
 *   > Body: what to say, rolls, and private lines as nested callouts.
 *
 * Options after `|`: a priority (must, should, fit, watch), then key=value pairs:
 *   at      the moments to play it, separated by `;` (place names, people, "first Long Rest", "any meal" …)
 *   pc      the heroes it is for, separated by `,` (absent heroes put the beat to sleep)
 *   ledger  ledger numbers, separated by `,`
 *   missed  how many sessions it has already been missed
 *   id      a stable id (otherwise made from the title)
 */

export const PRIORITIES = ["must", "should", "fit", "watch"];
const PRIORITY_ALIASES = {
  must: "must", red: "must", gate: "must", critical: "must",
  should: "should", yellow: "should",
  fit: "fit", "if-it-fits": "fit", maybe: "fit", nice: "fit", optional: "fit", white: "fit",
  watch: "watch", "watch-for": "watch", listen: "watch"
};

/** Note tags offered as one-click chips; any other #tag typed in a note works too. */
export const NOTE_TAGS = ["canon", "npc", "paid", "loot", "ruling", "quote", "hi", "idea"];

/* -------------------------------------------- */
/*  Text helpers                                */
/* -------------------------------------------- */

/** Lower case, no accents (Greek tonos included), punctuation to spaces, single spaces. */
export function fold(text) {
  return String(text ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A short stable hash (FNV-1a, base 36). */
export function hash(text) {
  let h = 0x811c9dc5;
  for ( const ch of String(text) ) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const splitList = (value, sep) => String(value ?? "").split(sep).map(s => s.trim()).filter(Boolean);

/* -------------------------------------------- */
/*  Parsing the deck                            */
/* -------------------------------------------- */

/** Callout options (`must|at=…|pc=…`) → beat fields. */
export function parseBeatMeta(meta) {
  const out = { priority: "should", at: [], pc: [], ledger: [], missed: 0, id: null };
  for ( const part of String(meta ?? "").split("|").map(s => s.trim()).filter(Boolean) ) {
    const eq = part.indexOf("=");
    if ( eq < 0 ) {
      const p = PRIORITY_ALIASES[part.toLowerCase()];
      if ( p ) out.priority = p;
      continue;
    }
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if ( ["at", "when", "where", "trigger", "triggers"].includes(key) ) out.at.push(...splitList(value, ";"));
    else if ( ["pc", "pcs", "hero", "heroes", "for"].includes(key) ) out.pc.push(...splitList(value, ","));
    else if ( key === "ledger" ) out.ledger.push(...splitList(value, ",").map(s => s.replace(/^#/, "")));
    else if ( key === "missed" ) out.missed = Math.max(0, parseInt(value, 10) || 0);
    else if ( key === "id" ) out.id = value || null;
    else if ( ["priority", "p"].includes(key) ) out.priority = PRIORITY_ALIASES[value.toLowerCase()] ?? out.priority;
  }
  return out;
}

const BEAT_HEAD = /^>[ \t]?\[!beat(?:\|([^\]]*))?\][+-]?[ \t]*(.*)$/i;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * Every beat callout in a note, in order.
 * @param {string} markdown
 * @returns {{id: string, title: string, priority: string, at: string[], pc: string[], ledger: string[], missed: number,
 *            body: string, line: number, section: string, order: number}[]}
 */
export function parseBeats(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const beats = [];
  const seen = new Map();
  let fence = null;
  let section = "";
  let i = 0;
  // Skip frontmatter.
  if ( lines[0]?.trim() === "---" ) {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if ( end > 0 ) i = end + 1;
  }
  for ( ; i < lines.length; i++ ) {
    const line = lines[i];
    if ( FENCE.test(line) ) {
      const mark = line.trim().slice(0, 3);
      fence = fence === mark ? null : (fence ?? mark);
      continue;
    }
    if ( fence ) continue;
    const h = line.match(HEADING);
    if ( h ) { section = h[2].trim(); continue; }
    const m = line.match(BEAT_HEAD);
    if ( !m ) continue;
    const meta = parseBeatMeta(m[1]);
    const title = m[2].trim();
    const body = [];
    let j = i + 1;
    while ( j < lines.length && /^>/.test(lines[j]) ) {
      body.push(lines[j].replace(/^>[ \t]?/, ""));
      j++;
    }
    while ( body.length && !body[0].trim() ) body.shift();
    while ( body.length && !body.at(-1).trim() ) body.pop();
    let id = meta.id ?? `b${hash(fold(title) || `${section}|${i}`)}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if ( n > 1 ) id = `${id}-${n}`;
    beats.push({ title: title || "—", ...meta, id, body: body.join("\n"), line: i, section, order: beats.length });
    i = j - 1;
  }
  return beats;
}

/**
 * The close-out questions: the numbered items under a heading that says "close-out" (or "closeout", «κλείσιμο»).
 * @returns {string[]}
 */
export function parseCloseout(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let inside = false;
  let level = 0;
  for ( const line of lines ) {
    const h = line.match(HEADING);
    if ( h ) {
      const isClose = /close[\s-]?out|κλείσιμο|κλεισιμο/i.test(h[2]);
      if ( isClose ) { inside = true; level = h[1].length; continue; }
      if ( inside && h[1].length <= level ) inside = false;
      continue;
    }
    if ( !inside ) continue;
    const q = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if ( q ) out.push(q[1].replace(/\*\*/g, "").trim());
  }
  return out;
}

/** The session number from the frontmatter (`session: "3"`) or the note name ("Session 03 - run sheet"). */
export function sessionOf(frontmatter, name) {
  const fm = frontmatter?.session;
  if ( fm !== undefined && fm !== null && String(fm).trim() ) return String(fm).trim();
  const m = String(name ?? "").match(/session\s*0*(\d+)/i);
  return m ? m[1] : "";
}

export const pad2 = n => (/^\d+$/.test(String(n)) ? String(n).padStart(2, "0") : String(n));

/* -------------------------------------------- */
/*  Triggers                                    */
/* -------------------------------------------- */

/** Words a trigger can use for things the Prompter hears about (besides place and NPC names). */
const KEYWORDS = {
  start: ["session start", "table open", "start of the session", "opening", "αρχη", "εναρξη"],
  "rest-long": ["long rest", "first long rest", "the night", "μακρα αναπαυση", "υπνος"],
  "rest-short": ["short rest", "συντομη αναπαυση"],
  rest: ["rest", "αναπαυση"],
  combat: ["combat", "after combat", "fight", "after the fight", "μαχη"],
  death: ["death", "dies", "a death", "θανατοσ", "πεθαινει"],
  night: ["night", "at night", "midnight", "νυχτα", "μεσανυχτα"]
};

/** Triggers that describe a kind of moment ("any meal", "anything frozen"): shown, never matched automatically. */
export function isKindOfMoment(trigger) {
  return /^(any|anything|anyone|anybody|whenever|someone|something|a |an |οποιο|οτιδηποτε|καθε)/i.test(String(trigger).trim());
}

/**
 * Does a trigger match something that just happened?
 * @param {string} trigger           One `at=` entry.
 * @param {{kind: string, text?: string, long?: boolean}} context
 *   kind: place | npc | scene | time | rest | combat | death | start; text: the name (place, NPC, scene, part of day).
 */
export function triggerMatches(trigger, context) {
  const t = fold(trigger).replace(/^(the|a|an|at|in|on|o|η|το|οι|τα|στο|στη|στην|στον)\s+/, "");
  if ( !t ) return false;
  const kind = context?.kind;
  const has = list => list.some(k => t === k || t.includes(k));
  if ( kind === "start" ) return has(KEYWORDS.start);
  if ( kind === "rest" ) {
    if ( context.long ) return has(KEYWORDS["rest-long"]) || (has(KEYWORDS.rest) && !has(KEYWORDS["rest-short"]));
    return has(KEYWORDS["rest-short"]) || (has(KEYWORDS.rest) && !has(KEYWORDS["rest-long"]));
  }
  if ( kind === "combat" ) return has(KEYWORDS.combat);
  if ( kind === "death" ) return has(KEYWORDS.death);
  if ( kind === "time" ) {
    const band = fold(context.text);
    if ( band && (t.includes(band) || band.includes(t)) ) return true;
    const isNight = KEYWORDS.night.some(k => band.includes(k));
    return isNight && has(KEYWORDS.night);
  }
  // Names: a place, an NPC card, a scene. Contained either way, at least 4 letters.
  if ( isKindOfMoment(trigger) ) return false;
  const name = fold(context?.text);
  if ( name.length < 3 || t.length < 4 ) return false;
  return name.includes(t) || (t.includes(name) && name.length >= 4);
}

/** The beats a context makes "hot" (not yet played; sleeping ones included, the panel decides). */
export function beatsFor(beats, context, status = {}) {
  return beats.filter(b => !["played", "skipped"].includes(status[b.id]?.s) && b.at.some(t => triggerMatches(t, context)));
}

/** Is a beat asleep: it names heroes and none of them is at the table? */
export function isAsleep(beat, present) {
  if ( !beat.pc.length || !present ) return false;
  return !beat.pc.some(name => present(name));
}

/* -------------------------------------------- */
/*  Notes                                       */
/* -------------------------------------------- */

/** "#paid the guide, 3 gp #npc" → {text: "the guide, 3 gp", tags: ["paid", "npc"]} */
export function parseNote(input, extraTags = []) {
  const tags = new Set(extraTags.map(t => String(t).toLowerCase()));
  const text = String(input ?? "").replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, sp, tag) => { tags.add(tag.toLowerCase()); return sp; })
    .replace(/\s+/g, " ").trim();
  return { text, tags: [...tags] };
}

/* -------------------------------------------- */
/*  The live log                                */
/* -------------------------------------------- */

const hhmm = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const cell = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
const PRIORITY_MARK = { must: "🔴", should: "🟡", fit: "⚪", watch: "👂" };

/** "1:05" for a duration in minutes. */
export function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The «Session NN - live log» note, in vault Markdown.
 * @param {object} data
 * @param {string} data.sheetName
 * @param {string} data.session
 * @param {object[]} data.beats       parseBeats() output
 * @param {object} data.state         {startedAt, closedAt, beats: {id: {s, t, where}}, notes: [], events: [], answers: {}}
 * @param {string[]} [data.questions]
 * @param {(beat) => boolean} [data.asleep]
 * @param {{name: string, count: number, present: boolean}[]} [data.spotlight]
 */
export function buildLiveLog({ sheetName, session, beats, state, questions = [], asleep = () => false, spotlight = [] }) {
  const st = state ?? {};
  const status = st.beats ?? {};
  const nn = pad2(session);
  const started = st.startedAt ? new Date(st.startedAt) : null;
  const date = started && !Number.isNaN(started.getTime()) ? started.toISOString().slice(0, 10) : "";
  const lines = [
    "---",
    "type: session",
    `session: "${String(session).replace(/"/g, "")}"`,
    date ? `date: ${date}` : null,
    `aliases: [Session ${nn} live log]`,
    "tags: [session, live-log]",
    "---",
    `# Session ${nn} — live log`,
    "",
    `> Written by the Prompter (Planar Codex) from [[${sheetName}]]. Raw material for the session log: Claude turns it into \`Sessions/\`, the dashboard, the ledger and the recap.`,
    `> **Started** ${hhmm(st.startedAt) || "—"} · **Closed** ${hhmm(st.closedAt) || "—"}${st.startedAt && st.closedAt ? ` · **Played** ${duration(new Date(st.closedAt) - new Date(st.startedAt))}` : ""}`,
    ""
  ].filter(l => l !== null);

  const played = beats.filter(b => status[b.id]?.s === "played");
  const skipped = beats.filter(b => status[b.id]?.s === "skipped");
  const open = beats.filter(b => !["played", "skipped"].includes(status[b.id]?.s));
  const row = (b, mark, extra = "") => `| ${mark} | ${PRIORITY_MARK[b.priority] ?? ""} | ${cell(b.title)} | ${cell(b.ledger.map(n => `#${n}`).join(" "))} | ${cell(extra)} |`;
  lines.push("## The deck", "", "| | | Beat | Ledger | When / note |", "|---|---|---|---|---|");
  for ( const b of played ) lines.push(row(b, "✓", [hhmm(status[b.id].t), status[b.id].where].filter(Boolean).join(" · ")));
  for ( const b of skipped ) lines.push(row(b, "✗", `skipped ${hhmm(status[b.id].t)}`));
  for ( const b of open ) {
    const sleeping = asleep(b);
    const note = sleeping ? "💤 hero absent (not counted)"
      : b.priority === "watch" ? "not heard tonight (stays in the deck)"
        : `**not played → missed ×${b.missed + 1}**`;
    lines.push(row(b, sleeping ? "💤" : "☐", note));
  }
  lines.push("");

  if ( spotlight.length ) {
    lines.push("## Spotlight", "", spotlight.map(s => `**${s.name}** ${s.count}${s.present ? "" : " (absent)"}`).join(" · "), "");
  }

  const notes = st.notes ?? [];
  lines.push("## Notes from the table", "");
  if ( notes.length ) for ( const n of notes ) lines.push(`- ${hhmm(n.t)} ${n.tags.map(t => `\`#${t}\``).join(" ")} ${n.text}`.replace(/\s+$/, ""));
  else lines.push("- *(none)*");
  lines.push("");

  const events = st.events ?? [];
  lines.push("## What the modules saw", "");
  if ( events.length ) for ( const e of events ) lines.push(`- ${hhmm(e.t)} **${cell(e.label ?? e.kind)}** ${e.text}`.replace(/\s+$/, ""));
  else lines.push("- *(nothing)*");
  lines.push("");

  if ( questions.length ) {
    lines.push("## Close-out", "");
    questions.forEach((q, i) => {
      const a = String(st.answers?.[i] ?? "").trim();
      lines.push(`${i + 1}. **${q}**`, `   ${a || "*(no answer)*"}`);
    });
    lines.push("");
  }
  return lines.join("\n");
}
