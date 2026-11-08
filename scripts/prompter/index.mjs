/**
 * Planar Codex — Prompter (Υποβολέας): the session's deck, live.
 * Settings, keys, the toolbar button and the API. See panel.mjs, context.mjs, state.mjs, core.mjs.
 */
import { MODULE_ID } from "../codex.mjs";
import * as core from "./core.mjs";
import { registerState, sheetPage, readSheet, run, setBeat, addNote, flush } from "./state.mjs";
import { registerContextHooks, primeContext, hear } from "./context.mjs";
import { PrompterPanel, startSession, closeSession, writeLiveLog } from "./panel.mjs";
import { setPanelOpener, watchBeatBoxes } from "./beats-in-note.mjs";
import { setToastPanelOpener } from "./toasts.mjs";
import { kindInfo, FILTER_SETTING } from "./kinds.mjs";

export function initPrompter() {
  registerState();
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  register("prompterToasts", {
    name: "PLANARCODEX.Settings.PrompterToasts", hint: "PLANARCODEX.Settings.PrompterToastsHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  register("prompterChime", {
    name: "PLANARCODEX.Settings.PrompterChime", hint: "PLANARCODEX.Settings.PrompterChimeHint",
    scope: "client", config: true, type: Boolean, default: true
  });
  register("prompterWhisperPlays", {
    name: "PLANARCODEX.Settings.PrompterWhisperPlays", hint: "PLANARCODEX.Settings.PrompterWhisperPlaysHint",
    scope: "world", config: true, type: Boolean, default: true
  });
  // The filter chip the GM last picked (Όλα, Σκηνές, Στοιχεία …): per GM user, not per browser.
  // Whether "Notes and what the modules saw" is unfolded (per GM user).
  register("prompterFeedOpen", { scope: "user", config: false, type: Boolean, default: true });
  register(FILTER_SETTING, { scope: "user", config: false, type: String, default: "all", onChange: () => PrompterPanel.instance?.renderSoon() });
  register("prompterAutoOpen", {
    name: "PLANARCODEX.Settings.PrompterAutoOpen", hint: "PLANARCODEX.Settings.PrompterAutoOpenHint",
    scope: "client", config: true, type: Boolean, default: true
  });

  game.keybindings.register(MODULE_ID, "prompter", {
    name: "PLANARCODEX.Keybindings.Prompter",
    hint: "PLANARCODEX.Keybindings.PrompterHint",
    editable: [{ key: "KeyD", modifiers: ["Alt"] }],
    restricted: true,
    onDown: () => { PrompterPanel.toggle(); return true; }
  });
  game.keybindings.register(MODULE_ID, "lens", {
    name: "PLANARCODEX.Keybindings.Lens",
    hint: "PLANARCODEX.Keybindings.LensHint",
    editable: [{ key: "KeyL", modifiers: ["Alt"] }],
    restricted: true,
    onDown: () => { PrompterPanel.lens(); return true; }
  });
  game.keybindings.register(MODULE_ID, "prompterNote", {
    name: "PLANARCODEX.Keybindings.PrompterNote",
    hint: "PLANARCODEX.Keybindings.PrompterNoteHint",
    editable: [{ key: "KeyN", modifiers: ["Alt"] }],
    restricted: true,
    onDown: () => { PrompterPanel.note(); return true; }
  });

  // The Now strip's cards from anywhere (in the panel, plain 1 / 2 / 3 work too). Alt, so the hotbar's digits stay the hotbar's.
  for ( const n of [1, 2, 3] ) {
    game.keybindings.register(MODULE_ID, `prompterNow${n}`, {
      name: `PLANARCODEX.Keybindings.PrompterNow${n}`,
      hint: "PLANARCODEX.Keybindings.PrompterNowHint",
      editable: [{ key: `Digit${n}`, modifiers: ["Alt"] }],
      restricted: true,
      onDown: () => !!PrompterPanel.instance?.rendered && PrompterPanel.instance.playNow(n)
    });
  }

  setPanelOpener(() => PrompterPanel.open());
  setToastPanelOpener(() => PrompterPanel.open({ tab: "prompter" }));
  registerContextHooks();

  Hooks.on("getSceneControlButtons", controls => {
    if ( !game.user.isGM || !controls?.tokens?.tools ) return;
    controls.tokens.tools[`${MODULE_ID}-prompter`] = {
      name: `${MODULE_ID}-prompter`, title: "PLANARCODEX.Prompter.Title", icon: "fa-solid fa-scroll",
      order: 61, button: true, visible: true, onChange: () => PrompterPanel.toggle()
    };
  });
}

export function readyPrompter() {
  if ( !game.user.isGM ) return;
  primeContext();
  watchBeatBoxes();
  window.addEventListener("beforeunload", () => { flush(); });
  if ( game.settings.get(MODULE_ID, "prompterAutoOpen") && run().active ) PrompterPanel.open();
}

/** The Prompter part of the Codex API: game.modules.get("planar-codex").api.prompter */
export const prompterApi = {
  open: () => PrompterPanel.open(),
  toggle: () => PrompterPanel.toggle(),
  note: text => (text ? addNote(core.parseNote(text)) : PrompterPanel.note()),
  start: () => startSession(),
  close: () => closeSession(),
  writeLog: () => writeLiveLog(),
  /** Tell the Prompter something happened: hear({kind: "place", text: "The Old Library"}). */
  hear: (context, options) => hear(context, options),
  /** The current run sheet's beats, and tonight's state. */
  sheet: () => sheetPage(),
  beats: () => readSheet(sheetPage())?.beats ?? [],
  run: () => run(),
  played: (id, where = "") => setBeat(id, "played", where),
  /** The Now strip's cards (0.10): the beat ids in order, as the open panel last drew them ([] when it's closed). */
  now: () => [...(PrompterPanel.instance?.nowIds ?? [])],
  /** Play the n-th Now card, as the keys 1 / 2 / 3 do. */
  playNow: n => PrompterPanel.instance?.playNow(n) ?? false,
  /** A beat's kind: {kind, sure, written, guess} (0.7). */
  kind: idOrBeat => kindInfo(typeof idOrBeat === "string" ? (readSheet(sheetPage())?.beats ?? []).find(b => b.id === idOrBeat) : idOrBeat),
  core
};
