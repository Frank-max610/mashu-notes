import MarkdownIt from 'markdown-it';
import type { NoteSummary } from './types';

/**
 * Markdown rendering for Mashu.
 *
 * Output is sanitised by construction: raw HTML is disabled and only
 * `http(s)`/`mailto` links are kept as external links. `[[wiki links]]` become
 * anchors with `data-wiki-target`, which the preview layer turns into note
 * navigation (and "create note" for dangling links).
 */

export interface RenderContext {
  /** Normalised titles of existing notes, so links can be styled as missing. */
  titles?: Map<string, NoteSummary>;
  /** Resolves a wiki link target to an existing note title. */
  resolveTitle?: (target: string) => string | null;
  /** markdown-it passes its environment object through `env`. */
  [key: string | symbol]: unknown;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

const WIKI_LINK_INLINE_RE = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]*))?\]\]/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Turn `[[target|alias]]` into a markdown link with a private `wiki:` scheme so
 * the inline parser handles nesting/escaping, then rewrite it back to an anchor
 * in the renderer. Code spans are protected by the inline parser itself.
 */
function preprocessWikiLinks(content: string): string {
  // Code spans and fences must stay verbatim, so stash them behind placeholders
  // before rewriting wiki links and restore afterwards.
  const codeSegments: string[] = [];
  const stash = (segment: string) => `\u0000${codeSegments.push(segment) - 1}\u0000`;

  let masked = content.replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\3[^\n]*(\n|$)/g,
    (match) => stash(match),
  );
  // Unterminated fences (common while typing) must not leak links either.
  masked = masked.replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*$/g,
    (match) => stash(match),
  );
  masked = masked.replace(/`[^`\n]*`/g, (match) => stash(match));

  const replaced = masked.replace(
    WIKI_LINK_INLINE_RE,
    (_full, rawTarget: string, rawAlias?: string) => {
      const target = rawTarget.trim();
      if (!target) return _full;
      const alias = (rawAlias ?? target).trim() || target;
      // Encode the target so spaces/brackets survive URL parsing.
      return `[${alias}](wiki:${encodeURIComponent(target)})`;
    },
  );

  return replaced.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => codeSegments[Number(index)] ?? '');
}

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = String(token.attrGet('href') ?? '');
  if (href.startsWith('wiki:')) {
    let target = href.slice('wiki:'.length);
    try {
      target = decodeURIComponent(target);
    } catch {
      /* keep raw target */
    }
    const ctx = (env ?? {}) as unknown as RenderContext;
    const resolved = ctx.resolveTitle ? ctx.resolveTitle(target) : target;
    const cls = resolved ? 'wiki-link' : 'wiki-link is-missing';
    return `<a class="${cls}" href="#" data-wiki-target="${escapeHtml(target)}" role="link">`;
  }
  if (/^https?:/i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer nofollow');
  }
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.link_close = () => '</a>';

/** GitHub-style task list checkboxes (`- [ ]` / `- [x]`), read-only in preview. */
md.core.ruler.after('inline', 'task-list-checkboxes', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    const children = token.children;
    if (!children || children.length === 0) continue;
    const first = children[0];
    if (first.type !== 'text') continue;
    const match = /^\[([ xX])\]\s+/.exec(first.content);
    if (!match) continue;
    const checked = match[1].toLowerCase() === 'x';
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input class="task-checkbox" type="checkbox" disabled${checked ? ' checked' : ''} />`;
    first.content = first.content.slice(match[0].length);
    children.unshift(box);
  }
});

/** Render Markdown to HTML, resolving wiki links against known notes. */
export function renderMarkdown(content: string, ctx: RenderContext = {}): string {
  return md.render(preprocessWikiLinks(content), ctx);
}

/** Strip Markdown syntax down to readable plain text (used for excerpts). */
export function plainText(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g, (_m, target: string, alias?: string) => alias || target)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[([ xX])\]\s+/gm, (_m, mark: string) => (mark.toLowerCase() === 'x' ? '✓ ' : '○ '))
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/gm, ' ')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/\[[ xX]\]\s?/g, '')
    .replace(/[*_~`]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** One-line excerpt for list cards. */
export function excerpt(content: string, maxLength = 120): string {
  const text = plainText(content).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/** Plain word count, CJK counted per character. */
export function countWords(content: string): number {
  const text = plainText(content);
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const words = (text.match(/[A-Za-z0-9_'-]+/g) ?? []).length;
  return cjk + words;
}
