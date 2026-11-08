// Regression tests for the character/annotation table review findings (M11 + minors).
import { describe, it, expect } from 'vitest';
import { parseTable, importMatrixTable, importAnnotationsTable, exportMatrixCsv } from './tableIO';
import { parseNewick } from './newick';

describe('review: quoted newlines survive parsing', () => {
  it('a newline inside a quoted field does not split the record', () => {
    // RFC 4180: the field value is `X, "The<newline>long note"` — the embedded
    // newline must not start a second record (the old split(/\r?\n/) did).
    const t = parseTable('name,note\nA,"X, ""The\nlong note"""');
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toHaveLength(2);
    expect(t.rows[0][1]).toContain('long note');
    expect(t.rows[0][0]).toBe('A');
  });
});

describe('review: compact polymorphic cells (M11)', () => {
  it('(AB) is a polymorphic set of A and B, not one state labelled "AB"', () => {
    const csv = 'tip,trait\nA,(AB)\nB,B/C\n';
    const r = importMatrixTable(csv, 't');
    const ch = r.characters[0];
    // The universe has A, B (from (AB)) and C (from B/C) — and NO "AB" state.
    expect(ch.states.map((s) => s.label).sort()).toEqual(['A', 'B', 'C']);
    // Tip A's cell is a SET of the two member states, not the monomorphic "AB".
    const bag = ch as typeof ch & { __assignments?: Record<string, string | string[]> };
    expect(Array.isArray(bag.__assignments?.A)).toBe(true);
  });
});

describe('review: identifier-shaped values keep their leading zeros', () => {
  it('"007" stays text, "0" stays zero', () => {
    const tree = parseNewick('(A,B);');
    const csv = 'taxon,acc,weight\nA,007,0.5\n';
    const r = importAnnotationsTable(tree, csv);
    expect(r.applied).toBe(1);
    const a = Object.values(tree.nodes).find((n) => n.label === 'A')!;
    // An identifier-shaped string with a leading zero must survive as text —
    // Number() used to silently rewrite it as 7.
    expect(a.annotations?.acc).toBe('007');
    expect(a.annotations?.weight).toBe(0.5);
  });
});

describe('review: exported CSV escapes state labels', () => {
  it('a state label containing a comma keeps the column alignment', () => {
    const p = parseNewick('(A,B);');
    p.characters = [
      {
        id: 'c1',
        name: 'trait',
        type: 'discrete',
        states: [
          { id: 's0', label: 'yes, strongly', color: '#000000' },
          { id: 's1', label: 'no', color: '#ffffff' },
        ],
      },
    ];
    Object.values(p.nodes).find((n) => n.label === 'A')!.charStates = { c1: 's0' };
    Object.values(p.nodes).find((n) => n.label === 'B')!.charStates = { c1: 's1' };
    const out = exportMatrixCsv(p);
    const rows = out.split('\n');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // 2 columns per row once quoted fields are considered: a naive split
      // would give 3+ pieces on the escaped row.
      const pieces = row.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      expect(pieces.length).toBe(2);
    }
  });
});
