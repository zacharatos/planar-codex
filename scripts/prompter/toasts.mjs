/**
 * Planar Codex — Prompter: rule toasts (0.7).
 *
 * A rule card (kind=rule) isn't a story beat to tick off: when its moment comes (a Short Rest, the end of a fight,
 * a death, a place or a person it names), a small GM-only box shows the rule with its roll buttons and stays until
 * dismissed. The card also stays in the deck, under «Κανόνες», to look up any time. Logged as "reminded".
 */
import { localize, convert } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { decorateCallouts } from "../actions.mjs";
import { KIND_ICONS, plainTitle } from "./core.mjs";

const TextEditorImpl = () => foundry.applications.ux.TextEditor.implementation;
const esc = escapeHTML;
const MAX_TOASTS = 4;
/** beat id → the toast element on screen. */
const open = new Map();
let openPanel = () => {};

/** How the toast's "Prompter" button opens the panel (set by index.mjs; avoids an import cycle). */
export function setToastPanelOpener(fn) { openPanel = fn; }

function stack() {
  let el = document.getElementById("codex-rule-toasts");
  if ( !el ) {
    el = document.createElement("div");
    el.id = "codex-rule-toasts";
    el.className = "planar-codex codex-rule-toasts";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", localize("Prompter.Kind.rule"));
    document.body.append(el);
  }
  return el;
}

/**
 * Show a rule card at its moment. A card already on screen moves to the top instead of showing twice.
 * @param {object} beat   parseBeats() entry
 * @param {object} page   the run sheet page
 * @param {string} where  what called it ("Rest", "Atlas · Η Τσαγιέρα" …)
 */
export async function showRuleToast(beat, page, where = "") {
  if ( !game.user?.isGM || !beat ) return null;
  const root = stack();
  const existing = open.get(beat.id);
  if ( existing?.isConnected ) { root.prepend(existing); existing.classList.remove("codex-rt-flash"); void existing.offsetWidth; existing.classList.add("codex-rt-flash"); return existing; }
  const el = document.createElement("section");
  el.className = "codex-rule-toast codex-rt-flash";
  el.dataset.beat = beat.id;
  const pcs = beat.pc.length ? ` · ${esc(beat.pc.join(", "))}` : "";
  el.innerHTML = `<header class="codex-rt-head">
      <span class="codex-rt-icon" aria-hidden="true">${KIND_ICONS.rule}</span>
      <span class="codex-rt-title"><b>${esc(plainTitle(beat.title))}</b>${pcs}</span>
      <button type="button" class="codex-rt-btn" data-rt="panel" data-tooltip="${esc(localize("Prompter.Title"))}" aria-label="${esc(localize("Prompter.Title"))}"><i class="fa-solid fa-scroll"></i></button>
      <button type="button" class="codex-rt-btn" data-rt="close" data-tooltip="${esc(localize("Prompter.RuleDismiss"))}" aria-label="${esc(localize("Prompter.RuleDismiss"))}"><i class="fa-solid fa-xmark"></i></button>
    </header>
    ${where ? `<div class="codex-rt-where"><i class="fa-solid fa-bolt"></i> ${esc(where)}</div>` : ""}
    <div class="codex-rt-body codex-page"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
  el.addEventListener("click", ev => {
    const b = ev.target.closest("[data-rt]");
    if ( !b ) return;
    ev.preventDefault();
    if ( b.dataset.rt === "close" ) dismiss(beat.id);
    else openPanel();
  });
  root.prepend(el);
  open.set(beat.id, el);
  // At most a few at once: the oldest go.
  const all = Array.from(root.querySelectorAll(".codex-rule-toast"));
  for ( const old of all.slice(MAX_TOASTS) ) dismiss(old.dataset.beat);

  const body = el.querySelector(".codex-rt-body");
  try {
    const { html: raw } = convert(beat.body || "", { gm: true, page });
    const html = await TextEditorImpl().enrichHTML(raw, { relativeTo: page, secrets: true, rollData: {} });
    body.innerHTML = html || `<p class="pr-none">${localize("Prompter.NoBody")}</p>`;
    decorateCallouts(body, { source: page?.uuid ?? "" });
  } catch(err) {
    body.textContent = beat.body || "";
    console.warn("planar-codex | rule toast", err);
  }
  return el;
}

export function dismiss(id) {
  const el = open.get(id);
  open.delete(id);
  el?.remove();
}

/** The rule toasts on screen (ids), for tests and the panel. */
export const openToasts = () => [...open.keys()];
