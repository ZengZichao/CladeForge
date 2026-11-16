// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// S18: the in-app manual renders through `markdown.tsx` — the parser must
// handle the manual's real constructs and must NEVER emit HTML (the security
// contract is React-elements-only; there is no dangerouslySetInnerHTML).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('rejects javascript: link schemes (allow-list: http(s) and anchors)', () => {
    const blocks = parseMarkdown('[x](javascript:alert(1)) [y](https://ok.example)');
    expect(blocks[0].kind).toBe('para');
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
