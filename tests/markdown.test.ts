import { describe, expect, it } from 'vitest';
import { countWords, excerpt, plainText, renderMarkdown } from '../src/lib/markdown';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = renderMarkdown('# 标题\n\n**粗体**');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>粗体</strong>');
  });

  it('turns wiki links into anchors with a target', () => {
    const html = renderMarkdown('去 [[Alpha|甲]] 看看');
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-target="Alpha"');
    expect(html).toContain('>甲</a>');
  });

  it('marks unresolved wiki links as missing', () => {
    const html = renderMarkdown('[[Ghost]]', { resolveTitle: () => null });
    expect(html).toContain('is-missing');
  });

  it('marks resolved wiki links as normal', () => {
    const html = renderMarkdown('[[Alpha]]', { resolveTitle: (target) => (target === 'Alpha' ? 'Alpha' : null) });
    expect(html).toContain('wiki-link');
    expect(html).not.toContain('is-missing');
  });

  it('does not convert wiki links inside code spans or fences', () => {
    const html = renderMarkdown('`[[nope]]`\n\n```\n[[nope]]\n```');
    expect(html).not.toContain('data-wiki-target');
  });

  it('escapes raw html', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
  });

  it('adds safe rel/target to external links', () => {
    const html = renderMarkdown('[x](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('rejects javascript: urls', () => {
    const html = renderMarkdown('[x](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
  });

  it('renders task list checkboxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('task-checkbox');
    expect(html).toContain('checked');
  });

  it('renders tables', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
  });

  it('linkifies bare urls', () => {
    expect(renderMarkdown('访问 https://example.com')).toContain('href="https://example.com"');
  });
});

describe('plainText / excerpt / countWords', () => {
  it('strips markdown syntax', () => {
    const text = plainText('# 标题\n\n**粗体** [链接](https://x.com) `code`\n\n[[Wiki|别名]]');
    expect(text).toContain('标题');
    expect(text).toContain('粗体');
    expect(text).toContain('链接');
    expect(text).toContain('别名');
    expect(text).not.toContain('**');
    expect(text).not.toContain('](');
  });

  it('clips excerpts with an ellipsis', () => {
    const text = '字'.repeat(200);
    const result = excerpt(text, 40);
    expect(result.length).toBeLessThanOrEqual(41);
    expect(result.endsWith('…')).toBe(true);
  });

  it('counts CJK characters and latin words', () => {
    expect(countWords('你好 hello world')).toBe(4);
    expect(countWords('')).toBe(0);
  });
});
