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
  game.keybindings.register(MODULE_ID, "prompterNote", {
    name: "PLANARCODEX.Keybindings.PrompterNote",
    hint: "PLANARCODEX.Keybindings.PrompterNoteHint",
    editable: [{ key: "KeyN", modifiers: ["Alt"] }],
    restricted: true,
    onDown: () => { PrompterPanel.note(); return true; }
  });

  setPanelOpener(() => PrompterPanel.open());
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
  core
};
