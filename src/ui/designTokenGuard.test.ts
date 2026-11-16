// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Source-level guards from the 2026-11-15 reviews (UI_UX_REVIEW B2/B3, Sonus S01):
//   * B3 — every `var(--x)` consumed by app.css must be defined in app.css
//     (the shadcn migration removed definitions but kept consumers, collapsing
//     popovers/dialogs to square, shadow-less corners).
//   * B2 — surface tokens (`--muted`, `--accent`) must never appear in TSX/TS
//     as ink (fill/stroke/color). They are now shadcn *surface* colors; using
//     them for text or data marks is how the time-axis labels became invisible.
//   * B2 follow-up — CSS fills/strokes that reference surface tokens directly
//     inside app.css are allowed (the alias block maps them), but TSX must go
//     through the ink tokens.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const srcRoot = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(p);
  }
  return out;
}

function readCss(): string {
  return readFileSync(join(srcRoot, 'styles', 'app.css'), 'utf8');
}

describe('B3: every var() token in app.css has a definition', () => {
  it('no consumer without a matching `--x:` declaration', () => {
    const css = readCss();
    const defined = new Set<string>();
    // Definitions appear as `--x:` at the start of a declaration — either at
    // line start or right after a `;`. Scanned per line because definitions
    // share lines (e.g. the gray palette) and multi-line var() calls exist.
    for (const line of css.split('\n')) {
      for (const m of line.matchAll(/(?:^|;)\s*(--[\w-]+)\s*:/g)) defined.add(m[1]);
    }
    const offenders = new Set<string>();
    for (const m of css.matchAll(/var\((--[\w-]+)/g)) {
      if (!defined.has(m[1])) offenders.add(m[1]);
    }
    expect([...offenders]).toEqual([]);
  });
});

describe('V5: app.css uses the z-index scale, not bare numbers', () => {
  it('every z-index declaration reads a --z-* token', () => {
    const css = readCss();
    // The :root definitions themselves are numbers; consumers must not be.
    const raw = [...css.matchAll(/^\s*z-index:\s*(-?\d+)/gm)].map((m) => m[1]);
    expect(raw, `bare z-index values: ${raw.join(', ')}`).toEqual([]);
  });
});

describe('B2: surface tokens never used as ink in TSX/TS', () => {
  it('no var(--muted) / var(--accent) in component sources', () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      if (!/\.(tsx|ts)$/.test(file) || file.endsWith('.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      if (/var\(--muted\)|var\(--accent\)/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('var(--muted-foreground) and var(--primary) ARE defined tokens', () => {
    const css = readCss();
    expect(css).toMatch(/--muted-foreground:/);
    expect(css).toMatch(/--primary:/);
  });
});
