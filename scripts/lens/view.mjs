/**
 * Planar Codex — Lens: the tab in the GM console.
 *
 * One stack of small cards about the name the Lens is on, most urgent first: the people, the place (Atlas, Theater,
 * shops), factions, tonight's beats and notes, the open threads, where the prep and the sessions mention it, the books.
 */
import { localize, convert } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { lens, setLensTarget, togglePin } from "./index.mjs";
import { gather } from "./data.mjs";
import { stripMd, excerpt, plainText } from "./core.mjs";
import { openLibrary } from "../library/index.mjs";

const esc = escapeHTML;
const TextEditorImpl = () => foundry.applications.ux.TextEditor.implementation;
const api = id => { const m = game.modules.get(id); return m?.active ? m.api ?? null : null; };
const hhmm = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const PRIORITY_MARK = { must: "🔴", should: "🟡", fit: "⚪", watch: "👂" };
const STATUS_MARK = { played: "✓", skipped: "✗", later: "⏩" };
/** A word from a list the other modules use (attitudes, place statuses): translated when we know it. */
const word = (group, value) => (game.i18n.has(`PLANARCODEX.Lens.${group}.${value}`) ? localize(`Lens.${group}.${value}`) : String(value ?? ""));

/** Markdown inline → HTML (links, rolls and bold work after enrichment), without the wrapping paragraph. */
function md(text) {
  const { html } = convert(String(text ?? ""), { gm: true });
  return html.trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
}

/* -------------------------------------------- */
/*  HTML                                        */
/* -------------------------------------------- */

/** The Lens tab's HTML (enriched). */
export async function renderLens() {
  const search = `<form class="lens-search" autocomplete="off">
      <i class="fa-solid fa-magnifying-glass"></i>
      <input type="text" name="q" value="${esc(lens.query)}" placeholder="${esc(localize("Lens.Placeholder"))}">
      <button type="button" class="lens-pin ${lens.pinned ? "on" : ""}" data-lens="pin" data-tooltip="${esc(localize(lens.pinned ? "Lens.Unpin" : "Lens.Pin"))}"><i class="fa-solid fa-thumbtack"></i></button>
    </form>`;
  const history = lens.history.length ? `<div class="lens-history"><i class="fa-solid fa-clock-rotate-left"></i> ${lens.history.map(q => `<a data-lens="name" data-q="${esc(q)}">${esc(q)}</a>`).join(" · ")}</div>` : "";
  if ( !lens.query ) return `<div class="lens">${search}<p class="lens-help">${localize("Lens.Help")}</p>${history}</div>`;

  const data = gather(lens.query);
  if ( !data ) return `<div class="lens">${search}<p class="lens-help">${localize("Lens.TooShort")}</p>${history}</div>`;

  const target = `<div class="lens-target">
      ${data.names.slice(0, 6).map((n, i) => `<span class="lens-name ${i ? "" : "lens-main"}">${esc(n)}</span>`).join("")}
      ${lens.source ? `<span class="lens-from"><i class="fa-solid fa-bolt"></i> ${esc(lens.source)} ${hhmm(lens.at)}</span>` : ""}
    </div>`;

  const body = data.empty
    ? `<p class="lens-none">${localize("Lens.Nothing", { name: esc(data.names[0]) })}</p>`
    : [people(data), place(data), factions(data), beats(data), tonight(data), threads(data), prep(data), sessions(data), notes(data)].join("");
  const books = `<section class="lens-card lens-books"><h3><i class="fa-solid fa-book"></i> ${localize("Lens.Books")}</h3>
      ${data.cites.map(c => `<cite class="codex-cite">${esc(c)}</cite>`).join(" ")}
      <button type="button" class="lens-btn" data-lens="books" data-q="${esc(stripMd(data.names[0]))}"><i class="fa-solid fa-magnifying-glass"></i> ${localize("Lens.SearchBooks", { name: esc(data.names[0]) })}</button>
    </section>`;

  const html = `<div class="lens">${search}${target}${body}${books}${history}</div>`;
  return TextEditorImpl().enrichHTML(html, { secrets: true, rollData: {} });
}

const section = (cls, icon, title, inner, count = null) => (inner ? `<section class="lens-card ${cls}">
    <h3><i class="${icon}"></i> ${title}${count !== null ? ` <span class="pr-count">${count}</span>` : ""}</h3>${inner}</section>` : "");

function people(data) {
  if ( !data.people.length ) return "";
  const contactFor = p => data.contacts.find(c => [p.name, ...p.aliases].some(n => stripMd(n).toLowerCase() === String(c.name).toLowerCase()));
  const items = data.people.map(({ person: p, page, also = [], prepared }) => {
    const wft = p.fields.find(f => f.kind === "wft");
    const parts = wft ? stripMd(wft.value).split(/\s+\/\s+/) : [];
    const wftHTML = wft ? `<div class="lens-wft">${["Want", "Fear", "Tell"].map((k, i) => (parts[i] && parts[i] !== "—"
      ? `<div><b>${localize(`Lens.${k}`)}</b> ${esc(parts[i])}</div>` : "")).join("")}</div>` : "";
    const order = ["voice", "attitude", "knows", "status", "other", "book"];
    const fields = p.fields.filter(f => f !== wft).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.extra ? 1 : 0) - (b.extra ? 1 : 0))
      .map(f => `<div class="lens-field lens-${f.kind}"><span class="lens-label">${esc(f.label)}</span> ${md(f.value)}</div>`).join("");
    const c = contactFor(p);
    const contact = c ? `<div class="lens-contact"><i class="fa-solid fa-flag"></i> ${esc(c.factionName || "")} · <span class="lens-att lens-att-${esc(c.attitude)}">${esc(word("Attitude", c.attitude))}</span>${c.role ? ` · ${esc(c.role)}` : ""}</div>` : "";
    const card = data.cards.find(t => [p.name, ...p.aliases].some(n => String(t.label).toLowerCase().includes(stripMd(n).toLowerCase())));
    const buttons = [
      `<button type="button" class="lens-btn" data-lens="open" data-uuid="${esc(page.uuid)}" data-line="${p.line}"><i class="fa-solid fa-file-lines"></i> ${prepared ? esc(page.parent.name) : localize("Lens.OpenNote")}</button>`,
      ...also.map(a => `<button type="button" class="lens-btn lens-also" data-lens="open" data-uuid="${esc(a.page.uuid)}" data-line="${a.line}"><i class="fa-solid fa-scroll"></i> ${esc(a.page.parent.name)}</button>`),
      card ? `<button type="button" class="lens-btn" data-lens="card" data-label="${esc(card.label)}" data-scene="${esc(card.scene)}"><i class="fa-solid fa-user"></i> ${localize("Lens.Card")}</button>` : ""
    ].join("");
    return `<article class="lens-person">
      <header>${prepared ? `<span class="lens-prepared" data-tooltip="${esc(localize("Lens.PreparedHint"))}">${localize("Lens.Prepared")}</span> ` : ""}<b>${esc(stripMd(p.name))}</b>${p.aliases.length ? ` <span class="lens-alias">${esc(p.aliases.join(", "))}</span>` : ""}
        ${p.about ? `<div class="lens-about">${esc(p.about)}${p.note ? ` · ${esc(p.note)}` : ""}</div>` : (p.note ? `<div class="lens-about">${esc(p.note)}</div>` : "")}</header>
      ${wftHTML}${contact}${fields}<div class="lens-acts">${buttons}</div></article>`;
  }).join("");
  return section("lens-people", "fa-solid fa-user-group", localize("Lens.People"), items);
}

function place(data) {
  const rows = [];
  if ( data.place ) {
    const p = data.place;
    rows.push(`<div class="lens-row"><i class="fa-solid fa-location-dot"></i> <b>${esc(p.name)}</b> <span class="lens-status lens-st-${esc(p.status ?? "")}">${esc(word("PlaceStatus", p.status ?? ""))}</span>
      <span class="lens-acts"><button type="button" class="lens-btn" data-lens="atlas-card" data-q="${esc(p.name)}">${localize("Lens.AtlasCard")}</button>
      <button type="button" class="lens-btn" data-lens="atlas-move" data-q="${esc(p.name)}"><i class="fa-solid fa-person-walking-arrow-right"></i> ${localize("Lens.AtlasMove")}</button></span></div>`);
  }
  for ( const t of data.stage ) {
    rows.push(`<div class="lens-row"><i class="fa-solid fa-masks-theater"></i> ${esc(t.label)}${t.title ? ` <span class="lens-alias">«${esc(t.title)}»</span>` : ""}
      <span class="lens-acts"><button type="button" class="lens-btn" data-lens="stage" data-label="${esc(t.label)}" data-scene="${esc(t.scene)}">${localize("Lens.Show")}</button></span></div>`);
  }
  if ( data.stage.length ) rows.push(`<div class="lens-row lens-off"><button type="button" class="lens-btn" data-lens="stage-off"><i class="fa-solid fa-eye-slash"></i> ${localize("Lens.BackToMap")}</button></div>`);
  for ( const t of data.cards ) {
    if ( data.people.length && data.people.some(({ person }) => [person.name, ...person.aliases].some(n => String(t.label).toLowerCase().includes(stripMd(n).toLowerCase()))) ) continue;
    rows.push(`<div class="lens-row"><i class="fa-solid fa-user"></i> ${esc(t.label)}
      <span class="lens-acts"><button type="button" class="lens-btn" data-lens="card" data-label="${esc(t.label)}" data-scene="${esc(t.scene)}">${localize("Lens.Card")}</button></span></div>`);
  }
  for ( const s of data.shops ) {
    const owner = s.owner?.name ? ` · ${esc(s.owner.name)}` : "";
    rows.push(`<div class="lens-row"><i class="fa-solid fa-store"></i> ${esc(s.name)}${owner}
      <span class="lens-acts"><button type="button" class="lens-btn" data-lens="shop" data-id="${esc(s.id)}">${localize("Lens.Shop")}</button></span></div>`);
  }
  return section("lens-place", "fa-solid fa-map-location-dot", localize("Lens.Place"), rows.join(""));
}

function factions(data) {
  const shown = new Set(data.people.flatMap(({ person }) => [person.name, ...person.aliases].map(n => stripMd(n).toLowerCase())));
  const contacts = data.contacts.filter(c => !shown.has(String(c.name).toLowerCase())).map(c => `<div class="lens-row"><i class="fa-solid fa-address-card"></i> <b>${esc(c.name)}</b>
      ${c.factionName ? ` · ${esc(c.factionName)}` : ""} · <span class="lens-att lens-att-${esc(c.attitude)}">${esc(word("Attitude", c.attitude))}</span>${c.role ? ` · ${esc(c.role)}` : ""}
      ${c.offers ? `<div class="lens-sub">${esc(c.offers)}</div>` : ""}${c.notes ? `<div class="lens-sub lens-gm">${esc(c.notes)}</div>` : ""}</div>`);
  const favours = data.favours.map(e => `<div class="lens-row"><i class="fa-solid ${e.kind === "favour" ? "fa-hand-holding-heart" : "fa-scale-unbalanced"}"></i>
      <b>${esc(e.withName)}</b>${e.whoName ? ` ↔ ${esc(e.whoName)}` : ""}: ${esc(e.what)}</div>`);
  return section("lens-factions", "fa-solid fa-flag", localize("Lens.Factions"), [...contacts, ...favours].join(""));
}

function beats(data) {
  if ( !data.beats.length ) return "";
  const rows = data.beats.map(({ beat: b, status }) => `<a class="lens-row lens-beat ${status ? `lens-${status}` : ""}" data-lens="beat" data-id="${esc(b.id)}">
      ${PRIORITY_MARK[b.priority] ?? ""} ${esc(b.title)} ${b.ledger.map(n => `<span class="pr-ledger">#${esc(n)}</span>`).join("")}
      ${status ? `<span class="lens-st">${STATUS_MARK[status] ?? ""}</span>` : ""}</a>`).join("");
  return section("lens-beats", "fa-solid fa-layer-group", localize("Lens.Beats"), rows, data.beats.length);
}

function tonight(data) {
  if ( !data.tonight.length ) return "";
  const rows = data.tonight.map(n => `<div class="lens-row"><span class="pr-t">${hhmm(n.t)}</span> ${n.tags.map(t => `<span class="pr-tag">#${esc(t)}</span>`).join(" ")} ${esc(n.text)}</div>`).join("");
  return section("lens-tonight", "fa-solid fa-pen", localize("Lens.Tonight"), rows);
}

function threads(data) {
  if ( !data.threads.length ) return "";
  const rows = data.threads.slice(0, 12).map(({ row, page }) => `<a class="lens-row lens-thread" data-lens="open" data-uuid="${esc(page.uuid)}" data-line="${row.line}">
      <span class="pr-ledger">#${esc(row.n)}</span> ${esc(excerpt(plainText(row.text), data.variants, 170))}
      <div class="lens-sub">${[stripMd(row.owner), stripMd(row.status)].filter(Boolean).map(esc).join(" · ")}${row.payoff ? ` → ${esc(stripMd(row.payoff).slice(0, 120))}` : ""}</div></a>`).join("");
  return section("lens-threads", "fa-solid fa-link", localize("Lens.Threads"), rows, data.threads.length);
}

const hitRows = list => list.map(({ page, hits }) => hits.map(h => `<a class="lens-row lens-hit" data-lens="open" data-uuid="${esc(page.uuid)}" data-line="${h.line}">
    <b>${esc(page.parent.name)}</b>${h.heading ? ` › ${esc(h.heading)}` : ""}${h.excerpt && h.excerpt !== h.heading ? `<div class="lens-sub">${esc(h.excerpt)}</div>` : ""}</a>`).join("")).join("");

const prep = data => section("lens-prep", "fa-solid fa-scroll", localize("Lens.Prep"), hitRows(data.prep));
const sessions = data => section("lens-sessions", "fa-solid fa-calendar-days", localize("Lens.Sessions"), hitRows(data.sessions));

function notes(data) {
  if ( !data.notes.length ) return "";
  const rows = data.notes.map(p => `<a class="lens-row" data-lens="open" data-uuid="${esc(p.uuid)}"><i class="fa-solid fa-book-skull"></i> ${esc(p.parent.name)}</a>`).join("");
  return section("lens-notes", "fa-solid fa-book-skull", localize("Lens.Notes"), rows);
}

/* -------------------------------------------- */
/*  Behaviour                                   */
/* -------------------------------------------- */

/**
 * A click inside the Lens tab.
 * @param {HTMLElement} target  the element with data-lens
 * @param {object} panel        the console (to switch tabs, expand a beat)
 * @param {(page, line) => Promise} jumpTo
 */
export async function onLensClick(target, panel, jumpTo) {
  const d = target.dataset;
  const atlas = api("planar-atlas"), theater = api("planar-theater"), store = api("planar-store");
  const busy = async fn => {
    target.classList.add("busy");
    try { await fn(); } catch(err) { ui.notifications.warn(err.message ?? String(err)); } finally { target.classList.remove("busy"); }
  };
  switch ( d.lens ) {
    case "pin": return togglePin();
    case "name": return setLensTarget(d.q);
    case "books": return openLibrary({ query: d.q });
    case "open": {
      const page = await fromUuid(d.uuid);
      if ( page ) return jumpTo(page, d.line ? Number(d.line) : null);
      return null;
    }
    case "beat":
      panel.tab = "prompter";
      panel.expanded.add(d.id);
      return panel.render();
    case "atlas-card": return atlas?.showCard?.(d.q);
    case "atlas-move": return busy(() => atlas?.move?.(d.q));
    case "stage": return busy(() => theater?.showPlace?.(d.label, { scene: d.scene }));
    case "stage-off": return busy(() => theater?.hide?.());
    case "card": return busy(() => theater?.showNpc?.(d.label, { scene: d.scene }));
    case "shop": return store?.console?.({ shopId: d.id });
  }
  return null;
}

/** The Lens search box was submitted. */
export function onLensSearch(form) {
  const q = form.querySelector("input[name=q]")?.value?.trim();
  if ( q ) setLensTarget(q);
}
