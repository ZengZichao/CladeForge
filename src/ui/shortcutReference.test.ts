// Shortcut-reference integrity (review PM-81): the bindings, the in-app
// reference and the manual §13 must share one source. The manual-side assertion
// reads docs/MANUAL_EN.md's §13 table and requires every binding printed in the
// dialog to appear there (and vice versa for the rows the doc documents), so a
// future edit that updates one side goes red instead of drifting.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHORTCUT_GROUPS } from './ShortcutsDialog';

describe('shortcut reference single-source', () => {
  it('has no duplicate key rows and no empty entries', () => {
    const seen = new Set<string>();
    for (const group of SHORTCUT_GROUPS()) {
      expect(group.rows.length, group.title).toBeGreaterThan(0);
      for (const row of group.rows) {
        expect(row.keys.trim().length, `${group.title}: ${row.label}`).toBeGreaterThan(0);
        expect(row.label.trim().length).toBeGreaterThan(0);
        const key = `${row.keys}::${row.label}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it('every dialog row appears in the manual shortcut table', () => {
    const manual = readFileSync(new URL('../../docs/MANUAL_EN.md', import.meta.url), 'utf8');
    const missing: string[] = [];
    for (const group of SHORTCUT_GROUPS()) {
      for (const row of group.rows) {
        // The manual writes the key column in backticks; match either the full
        // key string or its ⌘-stripped Ctrl equivalent.
        const key = row.keys.replace(/\s+/g, ' ');
        const ok =
          manual.includes(`\`${key}\``) ||
          manual.includes(key) ||
          manual.includes(key.replace(/⌘/g, 'Ctrl+')) ||
          manual.includes(key.split('/')[0].trim());
        if (!ok) missing.push(`${group.title}: ${row.keys} — ${row.label}`);
      }
    }
    expect(missing, `rows missing from MANUAL_EN §13:\n${missing.join('\n')}`).toEqual([]);
  });
});
