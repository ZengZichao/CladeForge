// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Guard against dead-string accumulation (2026-11-15 review §3.3 / P-6).
//
// The UI catalogue had grown ~50 keys with no remaining entry point (whole
// `toolbar.*` legacy group, menu titles, reconciliation labels prepared for
// features that never shipped). They inflate translation and maintenance cost
// and mislead later development into thinking a capability has a UI. This test
// walks every leaf of BOTH catalogues and requires at least one qualified
// reference (`S.group.key`, `ZH_STRINGS.group.key`, …) somewhere outside
// strings.ts. A new orphan therefore fails CI instead of rotting silently.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { EN_STRINGS, ZH_STRINGS } from './strings';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const corpus = walk(srcRoot)
  .filter((f) => !f.endsWith('strings.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

function leaves(node: unknown, path: string[] = []): string[] {
  if (typeof node !== 'object' || node === null) return [path.join('.')];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, [...path, k]),
  );
}

describe('UI string catalogue has no dead keys', () => {
  it('every zh and en leaf is referenced outside strings.ts', () => {
    const zh = leaves(ZH_STRINGS);
    const en = leaves(EN_STRINGS);
    const missing: string[] = [];
    for (const path of [...zh, ...en]) {
      const re = new RegExp(`(?:S|ZH_STRINGS|EN_STRINGS)\\.${path.replace(/\./g, '\\.')}\\b`);
      if (!re.test(corpus)) missing.push(path);
    }
    expect(missing, `unused string keys: ${missing.join(', ')}`).toEqual([]);
  });
});
