const browser = {
  window: "readonly", document: "readonly", console: "readonly", URL: "readonly", Blob: "readonly", Event: "readonly",
  TextEncoder: "readonly", FormData: "readonly", requestAnimationFrame: "readonly", setTimeout: "readonly",
  clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", getComputedStyle: "readonly",
  HTMLElement: "readonly", globalThis: "readonly"
};
const foundry = {
  foundry: "readonly", game: "readonly", ui: "readonly", CONFIG: "readonly", CONST: "readonly", Hooks: "readonly",
  JournalEntry: "readonly", JournalEntryPage: "readonly", Folder: "readonly", ChatMessage: "readonly",
  fromUuid: "readonly", fromUuidSync: "readonly"
};
const node = {
  process: "readonly", Buffer: "readonly", console: "readonly", URL: "readonly", TextEncoder: "readonly",
  fetch: "readonly", setTimeout: "readonly", globalThis: "readonly"
};
const rules = {
  "no-undef": "error", "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }], "no-unreachable": "error",
  "no-dupe-keys": "error", "no-redeclare": "error", "no-const-assign": "error"
};

export default [
  { files: ["scripts/**/*.mjs"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...browser, ...foundry } }, rules },
  { files: ["tools/**/*.mjs", "test/**/*.mjs"], languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...node, ...browser } }, rules }
];
