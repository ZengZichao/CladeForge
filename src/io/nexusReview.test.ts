// Regression tests for the NEXUS matrix review findings (S4/S5/S12).
import { describe, it, expect } from 'vitest';
import { parseNexusMatrix, serializeNexus, applyMatrixToProject } from './nexus';
import { parseNewick } from './newick';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';

describe('review: matrix taxa (S4)', () => {
  it('rows are one taxon per line even without TAXLABELS', () => {
    const r = parseNexusMatrix(`#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=3 NCHAR=2;
FORMAT DATATYPE=STANDARD SYMBOLS="01";
MATRIX
A 01
B 10
C 11
;
END;`);
    expect(r.tipLabels).toEqual(['A', 'B', 'C']);
    expect(r.characters).toHaveLength(2);
  });

  it('a quoted TAXLABELS name keeps its row', () => {
    const r = parseNexusMatrix(`#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=3 NCHAR=1;
FORMAT DATATYPE=STANDARD SYMBOLS="01";
TAXLABELS 'Taxon A' B C;
MATRIX
'Taxon A' 0
B 1
C 0
;
END;`);
    expect(r.tipLabels).toEqual(['Taxon A', 'B', 'C']);
    expect(r.characters).toHaveLength(1);
  });
});

describe('review: interleaved and compact matrices (S5)', () => {
  it('interleaved chunks concatenate instead of overwriting', () => {
    const r = parseNexusMatrix(`#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=2 NCHAR=4;
FORMAT DATATYPE=STANDARD SYMBOLS="01" INTERLEAVE=YES;
TAXLABELS A B;
MATRIX
A 0 1
B 1 0

A 1 0
B 0 1
;
END;`);
    expect(r.characters).toHaveLength(4);
    // A = 0,1,1,0 — verify by applying to a tree.
    const tree = parseNewick('(A,B);');
    applyMatrixToProject(tree, r);
    const a = Object.values(tree.nodes).find((n) => n.label === 'A')!;
    expect(a.charStates).toBeTruthy();
  });

  it('a compact state string is one column per character', () => {
    const r = parseNexusMatrix(`#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=2 NCHAR=2;
FORMAT DATATYPE=STANDARD SYMBOLS="01";
TAXLABELS A B;
MATRIX
A 01
B 10
;
END;`);
    expect(r.characters).toHaveLength(2);
  });
});

describe('review: state labels and missing codes (S12)', () => {
  it('STATELABELS binds by declared symbol position, not observed order', () => {
    const r = parseNexusMatrix(`#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=3 NCHAR=1;
FORMAT DATATYPE=STANDARD SYMBOLS="012";
STATELABELS 1 s0 s1 s2;
MATRIX
A 0
B 2
C 0
;
END;`);
    const ch = r.characters[0];
    expect(ch.states.map((s) => s.label)).toEqual(['s0', 's2']);
  });

  it('a declared MISSING code is not a third state', () => {
    const r = parseNexusMatrix(`#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=3 NCHAR=1;
FORMAT DATATYPE=STANDARD SYMBOLS="01" MISSING=X;
MATRIX
A 0
B 1
C X
;
END;`);
    const ch = r.characters[0];
    expect(ch.states).toHaveLength(2);
    // C carries no assignment (missing), not a third state.
    const tree = parseNewick('(A,B,C);');
    applyMatrixToProject(tree, r);
    const c = Object.values(tree.nodes).find((n) => n.label === 'C')!;
    expect(c.charStates?.[ch.id]).toBeUndefined();
  });

  it('CHARSTATELABELS is not misread as STATELABELS and names the character', () => {
    const r = parseNexusMatrix(`#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=2 NCHAR=1;
FORMAT DATATYPE=STANDARD SYMBOLS="01";
CHARSTATELABELS 1 trait / s0 s1;
MATRIX
A 0
B 1
;
END;`);
    expect(r.characters[0].name).toBe('trait');
    expect(r.characters[0].states.map((s) => s.label)).toEqual(['s0', 's1']);
  });

  it('the writer emits a numbered STATELABELS and parenthesised polymorphs', () => {
    const p = createEmptyProject('t');
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[a].label = 'A';
    p.nodes[b].label = 'B';
    p.characters = [
      {
        id: 'c1',
        name: 'trait, with comma',
        type: 'discrete',
        states: [
          { id: 's0', label: '0', color: '#000000' },
          { id: 's1', label: '1', color: '#ffffff' },
        ],
      },
    ];
    p.nodes[a].charStates = { c1: ['s0', 's1'] }; // polymorphic
    p.nodes[b].charStates = { c1: 's1' };
    const out = serializeNexus(p, { includeCharacters: true });
    expect(out).toMatch(/STATELABELS 1 /);
    expect(out).toMatch(/\(12\)/); // 1-based STATE_SYMBOLS: s0→1, s1→2
  });
});
