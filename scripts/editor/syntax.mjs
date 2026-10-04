/**
 * Planar Codex editor — the Markdown language the editor parses: GFM plus the Obsidian / Foundry syntax the
 * Codex understands (frontmatter, [[wikilinks]], ![[embeds]], ==highlights==, %%comments%%, @UUID[…]{…} links).
 */
import {
  Language, markdownLanguage, tags
} from "../../lib/codemirror.esm.js";

const WIKILINK_RE = /^(!?)\[\[([^[\]\n]+?)\]\](\{[^}\n]*\})?/;
const FOUNDRY_RE = /^[@&][A-Za-z]+\[[^\]\n]+\](\{[^}\n]*\})?/;

/** `---` YAML block at the very top of the note. */
const Frontmatter = {
  defineNodes: [{ name: "Frontmatter", block: true, style: tags.meta }],
  parseBlock: [{
    name: "Frontmatter",
    before: "HorizontalRule",
    parse(cx, line) {
      if ( cx.lineStart !== 0 || !/^---\s*$/.test(line.text) ) return false;
      const from = cx.lineStart;
      while ( cx.nextLine() ) {
        if ( /^(---|\.\.\.)\s*$/.test(line.text) ) {
          const to = cx.lineStart + line.text.length;
          cx.nextLine();
          cx.addElement(cx.elt("Frontmatter", from, to));
          return true;
        }
      }
      cx.addElement(cx.elt("Frontmatter", from, cx.lineStart));
      return true;
    }
  }]
};

/** [[Note]], [[Note#Heading|label]], ![[embed]], [[/roll …]]{label}. */
const WikiLinks = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "Embed", style: tags.link },
    { name: "WikiMark", style: tags.processingInstruction }
  ],
  parseInline: [{
    name: "WikiLink",
    before: "Link",
    parse(cx, next, pos) {
      if ( next !== 91 && next !== 33 ) return -1;                          // [ or !
      if ( next === 33 && cx.char(pos + 1) !== 91 ) return -1;
      const m = WIKILINK_RE.exec(cx.slice(pos, Math.min(cx.end, pos + 400)));
      if ( !m ) return -1;
      const open = m[1] ? 3 : 2;
      const end = pos + m[0].length;
      const closeAt = pos + m[1].length + 2 + m[2].length;
      return cx.addElement(cx.elt(m[1] ? "Embed" : "WikiLink", pos, end, [
        cx.elt("WikiMark", pos, pos + open),
        cx.elt("WikiMark", closeAt, closeAt + 2)
      ]));
    }
  }]
};

/** ==highlight== */
const Highlight = {
  defineNodes: [{ name: "Highlight", style: tags.special(tags.strong) }, { name: "HighlightMark", style: tags.processingInstruction }],
  parseInline: [{
    name: "Highlight",
    before: "Emphasis",
    parse(cx, next, pos) {
      if ( next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61 ) return -1;
      const m = /^==([^=\n]+?)==/.exec(cx.slice(pos, Math.min(cx.end, pos + 1000)));
      if ( !m ) return -1;
      const end = pos + m[0].length;
      return cx.addElement(cx.elt("Highlight", pos, end, [cx.elt("HighlightMark", pos, pos + 2), cx.elt("HighlightMark", end - 2, end)]));
    }
  }]
};

/** %%GM-only comment%% */
const Comment = {
  defineNodes: [{ name: "CodexComment", style: tags.comment }],
  parseInline: [{
    name: "CodexComment",
    before: "Emphasis",
    parse(cx, next, pos) {
      if ( next !== 37 || cx.char(pos + 1) !== 37 ) return -1;
      const m = /^%%[\s\S]*?%%/.exec(cx.slice(pos, cx.end));
      if ( !m ) return -1;
      return cx.addElement(cx.elt("CodexComment", pos, pos + m[0].length));
    }
  }]
};

/** @UUID[Actor.x]{Name}, &Reference[prone], @Embed[…] */
const FoundryLinks = {
  defineNodes: [{ name: "FoundryLink", style: tags.link }],
  parseInline: [{
    name: "FoundryLink",
    before: "Link",
    parse(cx, next, pos) {
      if ( next !== 64 && next !== 38 ) return -1;                          // @ or &
      const m = FOUNDRY_RE.exec(cx.slice(pos, Math.min(cx.end, pos + 400)));
      if ( !m ) return -1;
      return cx.addElement(cx.elt("FoundryLink", pos, pos + m[0].length));
    }
  }]
};

const parser = markdownLanguage.parser.configure([Frontmatter, WikiLinks, Highlight, Comment, FoundryLinks]);

/** The Codex Markdown language (shares the Markdown language data, so Markdown commands still apply). */
export const codexMarkdown = new Language(markdownLanguage.data, parser, [], "markdown");

export { WIKILINK_RE, FOUNDRY_RE };
