// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// S18: the in-app manual renders through `markdown.tsx` — the parser must
// handle the manual's real constructs and must NEVER emit HTML (the security
// contract is React-elements-only; there is no dangerouslySetInnerHTML).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown, renderBlocks, tocOf } from './markdown';

describe('parseMarkdown', () => {
  it('parses headings with stable anchor ids', () => {
    const blocks = parseMarkdown('# Title\n\n## Section one\n\ntext');
    expect(blocks[0].kind).toBe('heading');
    const h = blocks[0] as { kind: string; level: number; id: string };
    expect(h.level).toBe(1);
    expect(h.id).toContain('manual-');
    expect(tocOf(blocks).map((t) => t.text)).toEqual(['Title', 'Section one']);
  });

  it('parses tables with a delimiter row', () => {
    const blocks = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(blocks[0].kind).toBe('table');
    const t = blocks[0] as { kind: string; header: string[]; rows: string[][] };
    expect(t.header).toEqual(['a', 'b']);
    expect(t.rows).toEqual([['1', '2']]);
  });

  it('parses lists, fenced code and paragraphs', () => {
    const blocks = parseMarkdown('- one\n- two\n\n```js\nx=1\n```\n\nplain line');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'code', 'para']);
  });

  it('S18: never produces HTML — markup stays inert text', () => {
    // A poisoned document tries to smuggle markup; the renderer's contract is
    // React elements with string children only, so the worst case is that the
    // literal characters appear (no DOM injection is possible by construction).
    const html = '<script>alert(1)</script>';
    const blocks = parseMarkdown(html);
    expect(blocks[0].kind).toBe('para');
    const rendered = renderBlocks(blocks);
    expect(rendered).toHaveLength(1);
    // The paragraph's child is the escaped TEXT node, not an element.
    const p = rendered[0] as { props: { children: unknown[] } };
    expect(p.props.children[0]).toBe('<script>alert(1)</script>');
  });

  it('normalizes CRLF and bare CR line endings without joining words', () => {
    const blocks = parseMarkdown('# Heading\r\n\r\nFirst\rSecond');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'para']);
    expect(renderToStaticMarkup(renderBlocks(blocks))).toBe('<h4 id="manual-heading-1">Heading</h4><p>First Second</p>');
  });

  it('BUG-001: removes HTML comments before parsing headings and paragraphs', () => {
    const blocks = parseMarkdown('<!-- AI-PROVENANCE: hidden -->\n# Visible\n\nBefore\n<!-- hidden paragraph -->\nAfter');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'para', 'para']);
    const html = renderToStaticMarkup(renderBlocks(blocks));
    expect(html).not.toContain('AI-PROVENANCE');
    expect(html).not.toContain('hidden');
    expect(html).toContain('Visible');
    expect(html).toContain('<p>Before</p><p>After</p>');
  });

  it('BUG-001: removes multiline comments, including comment-like block syntax', () => {
    const blocks = parseMarkdown('<!-- AI-PROVENANCE:\n# not a heading\n\n[link](javascript:alert(1))\n-->\n## Real heading');
    expect(blocks.map((b) => b.kind)).toEqual(['heading']);
    expect(renderToStaticMarkup(renderBlocks(blocks))).not.toContain('AI-PROVENANCE');
    expect(tocOf(blocks).map((t) => t.text)).toEqual(['Real heading']);
  });

  it('BUG-001: never exposes HTML comments from fenced code examples', () => {
    const blocks = parseMarkdown('```html\n<!-- hidden example -->\n<p>Visible example</p>\n```');
    expect(blocks.map((b) => b.kind)).toEqual(['code']);
    const html = renderToStaticMarkup(renderBlocks(blocks));
    expect(html).not.toContain('hidden example');
    expect(html).toContain('&lt;p&gt;Visible example&lt;/p&gt;');
  });

  it('BUG-001: does not expose an unterminated HTML comment', () => {
    const blocks = parseMarkdown('Visible\n<!-- AI-PROVENANCE: hidden to EOF');
    expect(blocks.map((b) => b.kind)).toEqual(['para']);
    expect(renderToStaticMarkup(renderBlocks(blocks))).toBe('<p>Visible</p>');
  });

  it('B-X03: renders relative manual links as readable text without navigation', () => {
    const blocks = parseMarkdown('[MANUAL_EN.md](./MANUAL_EN.md) and [guide](../guide.md#start)');
    expect(renderToStaticMarkup(renderBlocks(blocks))).toBe(
      '<p>MANUAL_EN.md (./MANUAL_EN.md) and guide (../guide.md#start)</p>',
    );
  });

  it('keeps external links safe and disables opener access', () => {
    const blocks = parseMarkdown('[bad](javascript:alert(1)) [bad data](data:text/html,x) [ok](https://ok.example)');
    const html = renderToStaticMarkup(renderBlocks(blocks));
    expect(html).toContain('<p>bad bad data ');
    expect(html).toContain('<a href="https://ok.example" target="_blank" rel="noreferrer noopener">ok</a>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
  });

  it('B-X03: the shipped manuals contain no visible provenance or raw relative link markup', () => {
    const root = fileURLToPath(new URL('../../docs', import.meta.url));
    for (const name of ['MANUAL_ZH.md', 'MANUAL_EN.md']) {
      const text = readFileSync(`${root}/${name}`, 'utf8');
      const html = renderToStaticMarkup(renderBlocks(parseMarkdown(text)));
      expect(html).not.toContain('AI-PROVENANCE');
      expect(html).not.toMatch(/\[[^\]]+\]\([^)]*\.md(?:#[^)]*)?\)/);
    }
  });

  it('parses the shipped manuals without throwing and builds a real TOC', () => {
    const root = fileURLToPath(new URL('../../docs', import.meta.url));
    for (const name of ['MANUAL_ZH.md', 'MANUAL_EN.md']) {
      const text = readFileSync(`${root}/${name}`, 'utf8');
      const blocks = parseMarkdown(text);
      const toc = tocOf(blocks);
      expect(blocks.length).toBeGreaterThan(20);
      expect(toc.length).toBeGreaterThan(5);
      expect(toc.every((t) => t.id.startsWith('manual-'))).toBe(true);
    }
  });
});
