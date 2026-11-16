// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Source-level accessibility guards from the 2026-11-15 UI review:
//   * ID-29 — every icon-only `<button>` must carry an `aria-label`; a `title`
//     alone is a tooltip, not a guaranteed accessible name.
//   * ID-30 — the keyboard-chord spelling rule of UI_STYLE_GUIDE §3.8 is
//     enforced mechanically: `Ctrl + Z` / `Cmd/Ctrl + Shift + Z`, never the
//     compact `Ctrl+Z` and never a spaced `⌘ + Z`.
//
// Both checks are static (regex over the JSX/text), which is enough to stop
// regressions at commit time; full AT testing remains a manual QA step.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const srcRoot = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?)$/.test(entry)) out.push(p);
  }
  return out;
}

describe('icon-only buttons expose an accessible name (ID-29)', () => {
  it('every <button> whose class mentions "icon" has aria-label', () => {
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      if (file.endsWith('.test.tsx') || file.endsWith('.test.ts')) continue;
      const text = readFileSync(file, 'utf8');
      const re = /<button\b([^>]*?)>/gs;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const attrs = m[1];
        if (!/\bicon\b/.test(attrs)) continue;
        if (/\baria-label\s*=/.test(attrs)) continue;
        // A visible text label inside the button also satisfies the rule; the
        // opening tag alone cannot show it, so flag only the clear case where
        // the element is self-contained or contains only an icon expression.
        const line = text.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line} ${attrs.replace(/\s+/g, ' ').trim().slice(0, 100)}`);
      }
    }
    expect(offenders, `icon buttons without aria-label:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('keyboard chord spelling follows UI_STYLE_GUIDE §3.8 (ID-30)', () => {
  const files = [join(srcRoot, 'ui/strings.ts'), join(srcRoot, 'ui/ShortcutsDialog.tsx')];

  it('no compact Ctrl+/Cmd+ chord and no spaced ⌘ form', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const re of [/\b(?:Ctrl|Cmd)\+/g, /⌘\s+[A-Z0-9⇧.?]/g]) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line}: ${m[0]}`);
        }
      }
    }
    expect(offenders, `chord spelling violations:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('modifier chords use spaces around the plus sign', () => {
    const text = readFileSync(files[1], 'utf8');
    const chords = text.match(/'(?:[^']*\+[^']*)'/g) ?? [];
    const bad = chords.filter((c) => /\+\s*'/.test(c) === false && !c.includes(' + '));
    expect(bad).toEqual([]);
  });
});
