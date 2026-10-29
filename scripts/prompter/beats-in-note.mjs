/**
 * Planar Codex — Prompter: beat callouts in the reading view (GM).
 * Each beat box shows whether it was played tonight, with ✓ / ✗ / ↺ and a button that opens the Prompter.
 */
import { localize } from "../codex.mjs";
import { escapeHTML } from "../markdown.mjs";
import { readSheet, run, setBeat, subscribe } from "./state.mjs";

const DONE = ["played", "skipped"];
let openPanel = () => {};

/** The panel opener (set by the Prompter on init, to avoid an import cycle). */
export function setPanelOpener(fn) { openPanel = fn; }

/** Called by the note sheet after it renders. */
export function decorateBeats(page, root) {
  const boxes = Array.from(root.querySelectorAll(".codex-callout-beat"));
  if ( !boxes.length ) return;
  const beats = readSheet(page)?.beats ?? [];
  boxes.forEach((box, i) => {
    const beat = beats[i];
    if ( !beat ) return;
    box.dataset.beat = beat.id;
    box.dataset.pageUuid = page.uuid;
    paint(box, page);
  });
}

function paint(box, page) {
  const id = box.dataset.beat;
  const title = box.querySelector(":scope > .codex-callout-title");
  if ( !title ) return;
  title.querySelector(".codex-beat-state")?.remove();
  const st = run(page).beats[id]?.s ?? null;
  box.classList.toggle("codex-beat-played", st === "played");
  box.classList.toggle("codex-beat-skipped", st === "skipped");
  const span = document.createElement("span");
  span.className = "codex-actions codex-beat-state";
  const btn = (icon, text, tip, fn, cls = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `codex-action ${cls}`;
    b.dataset.tooltip = tip;
    b.setAttribute("aria-label", tip);
    b.innerHTML = `<i class="${icon}"></i>${text ? `<span>${escapeHTML(text)}</span>` : ""}`;
    b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); fn(); });
    span.append(b);
  };
  if ( DONE.includes(st) ) {
    btn("fa-solid fa-rotate-left", st === "played" ? "✓" : "✗", localize("Prompter.Reset"), () => setBeat(id, null, "", page), "codex-beat-done");
  } else {
    btn("fa-solid fa-check", "", localize("Prompter.Played"), () => setBeat(id, "played", "", page));
    btn("fa-solid fa-xmark", "", localize("Prompter.Skip"), () => setBeat(id, "skipped", "", page));
  }
  btn("fa-solid fa-scroll", "", localize("Prompter.Open"), () => openPanel());
  title.append(span);
}

/** Keep the boxes of open notes in step with the Prompter. */
export function watchBeatBoxes() {
  subscribe(() => {
    for ( const box of document.querySelectorAll(".codex-callout-beat[data-beat][data-page-uuid]") ) {
      const page = fromUuidSync(box.dataset.pageUuid, { strict: false });
      if ( page ) paint(box, page);
    }
  });
}
