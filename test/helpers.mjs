import { parseHTML } from "linkedom";
import { Marked } from "../lib/marked.esm.js";
import { MARKED_OPTIONS } from "../scripts/markdown.mjs";
const engine = new Marked(MARKED_OPTIONS);
export const render = md => engine.parse(md);
export function parseFragment(html) {
  const { document } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
  const root = document.getElementById("root");
  root.innerHTML = html;
  return root;
}
export const lexer = md => engine.lexer(md);
export const parser = tokens => engine.parser(tokens);
