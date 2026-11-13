// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import {
  parseNexus,
  parseNexusMatrix,
  parseNexusTrees,
  serializeNexus,
  DEFAULT_NEXUS_OPTIONS,
} from './nexus';
import { addChildren, renameNode } from '../model/treeOps';
import type { Character, Project } from '../model/types';
import { createEmptyProject } from '../model/sampleTree';

/** First preserved `[...]` comment on a node (meta.comments is a string[]). */
function firstComment(n: { meta?: Record<string, unknown> } | undefined): unknown {
  const c = n?.meta?.comments;
  return Array.isArray(c) ? c[0] : undefined;
}

describe('nexus', () => {
  it('detects the [&R] rooted marker on the root node meta', () => {
    // The rooted-marker match runs BEFORE comments are stripped, because `[&R]`
    // is itself a bracketed comment and would be undetectable afterwards.
    const nx = `#NEXUS
BEGIN TAXA;
  DIMENSIONS NTAX=2;
  TAXLABELS A B;
END;
BEGIN TREES;
  TREE tree1 = [&R] (A,B);
END;`;
    const p = parseNexus(nx, 't');
    const root = p.nodes[p.rootId];
    expect(root.meta?.rooted).toBe(true);
  });

  it('detects the [&U] unrooted marker', () => {
    const nx = `#NEXUS
BEGIN TREES;
  TREE tree1 = [&U] (A,B);
END;`;
    const p = parseNexus(nx, 't');
    const root = p.nodes[p.rootId];
    expect(root.meta?.rooted).toBe(false);
  });

  it('leaves meta unset when no root marker is present', () => {
    const nx = `#NEXUS
BEGIN TREES;
  TREE tree1 = (A,B);
END;`;
    const p = parseNexus(nx, 't');
    const root = p.nodes[p.rootId];
    expect(root.meta?.rooted).toBeUndefined();
  });

  it('applies a TRANSLATE table to tip labels', () => {
    const nx = `#NEXUS
BEGIN TAXA;
  DIMENSIONS NTAX=2;
  TAXLABELS 'Homo sapiens' Pan;
END;
BEGIN TREES;
  TRANSLATE
    1 'Homo sapiens',
    2 Pan
  ;
  TREE tree1 = (1,2);
END;`;
    const p = parseNexus(nx, 't');
    const labels = Object.values(p.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .map((n) => n.label);
    expect(labels).toContain('Homo sapiens');
    expect(labels).toContain('Pan');
  });

  it('round-trips a tree through serializeNexus', () => {
    const nx = `#NEXUS
BEGIN TREES;
  TREE tree1 = (A,B)R;
END;`;
    const p = parseNexus(nx, 't');
    const out = serializeNexus(p);
    expect(out).toContain('BEGIN TREES;');
    // A document that never declared a rootedness marker keeps the CladeForge
    // convention ([&R]); declaring [&U] must survive the round-trip (see below).
    expect(out).toContain('TREE tree1 = [&R]');
    // Trees reference the TRANSLATE indices; the table carries the names.
    expect(out).toContain('(1,2)R;');
    expect(out).toMatch(/TRANSLATE[\s\S]*1 A/);
    expect(out).toMatch(/TRANSLATE[\s\S]*2 B/);
    // The serialised output must parse again without errors — and the
    // round-trip restores the original tip names through the translate table.
    const again = parseNexus(out);
    const labels = Object.values(again.nodes)
      .filter((n) => n.childrenIds.length === 0)
      .map((n) => n.label)
      .sort();
    expect(labels).toEqual(['A', 'B']);
    expect(() => parseNexus(out)).not.toThrow();
  });

  describe('rootedness', () => {
    const rooted = (marker: string) => {
      const p = parseNexus(`#NEXUS\nBEGIN TREES;\n  TREE t = ${marker} (A,B)R;\nEND;`, 't');
      return { project: p, exported: serializeNexus(p) };
    };

    it('re-exports an [&U] import as [&U] instead of claiming [&R]', () => {
      const { project, exported } = rooted('[&U]');
      expect(project.nodes[project.rootId].meta?.rooted).toBe(false);
      expect(exported).toContain('TREE tree1 = [&U]');
      expect(exported).not.toContain('[&R]');
      // And the flag is stable over another import → export cycle.
      const again = parseNexus(exported, 't');
      expect(again.nodes[again.rootId].meta?.rooted).toBe(false);
    });

    it('re-exports an [&R] import as [&R]', () => {
      const { project, exported } = rooted('[&R]');
      expect(project.nodes[project.rootId].meta?.rooted).toBe(true);
      expect(exported).toContain('TREE tree1 = [&R]');
    });

    it('says out loud that an unrooted tree was loaded into a rooted model', () => {
      const { issues } = parseNexusTrees('#NEXUS\nBEGIN TREES;\n  TREE t = [&U] (A,B)R;\nEND;', 't');
      expect(issues.join(' ')).toMatch(/\[&U\]/);
    });

    it('does not leave the statement marker as a node annotation', () => {
      // [&R] / [&U] describe the TREE statement; keeping it in the Newick text
      // would make it round-trip as node metadata and duplicate on export.
      const p = parseNexus('#NEXUS\nBEGIN TREES;\n  TREE t = [&R] (A,B)R;\nEND;', 't');
      const out = serializeNexus(p);
      expect((out.match(/\[&R\]/g) ?? [])).toHaveLength(1);
      expect(out).not.toContain('R[&R]');
    });
  });

  describe('multi-tree files', () => {
    const multi = `#NEXUS
BEGIN TAXA; DIMENSIONS NTAX=2; TAXLABELS A B; END;
BEGIN TREES;
  TREE gen1 = [&U] (A:1,B:2)R;
  TREE gen2 = [&R] (A:3,B:4)S;
  TREE gen3 = (A:5,B:6)T;
END;`;

    it('returns every tree instead of silently keeping the first', () => {
      const { projects } = parseNexusTrees(multi, 'sample');
      expect(projects).toHaveLength(3);
      expect(projects[1].name).toBe('sample (2)');
      const tipsOf = (p: Project) => Object.values(p.nodes).filter((n) => !n.childrenIds.length).length;
      projects.forEach((p) => expect(tipsOf(p)).toBe(2));
      // parseNexus keeps meaning "the first one", now as an explicit choice.
      expect(parseNexus(multi, 'sample').name).toBe('sample (1)');
    });

    it('reads rootedness per statement, not once for the whole file', () => {
      const { projects } = parseNexusTrees(multi, 'sample');
      expect(projects[0].nodes[projects[0].rootId].meta?.rooted).toBe(false);
      expect(projects[1].nodes[projects[1].rootId].meta?.rooted).toBe(true);
      expect(projects[2].nodes[projects[2].rootId].meta?.rooted).toBeUndefined();
    });

    it('applies the TRANSLATE table to every tree, not just the first', () => {
      const nx = `#NEXUS
BEGIN TREES;
  TRANSLATE 1 Alpha, 2 Beta;
  TREE t1 = (1,2)R;
  TREE t2 = (1,2)S;
END;`;
      const { projects } = parseNexusTrees(nx, 't');
      expect(projects).toHaveLength(2);
      for (const p of projects) {
        const labels = Object.values(p.nodes).filter((n) => !n.childrenIds.length).map((n) => n.label);
        expect(labels).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
      }
    });

    it('is not confused by a semicolon inside a tree comment', () => {
      // `[&&NHX:…]` payloads legitimately contain ';', so statements must not be
      // split on ';' before the comments are shielded.
      const nx = `#NEXUS
BEGIN TREES;
  TREE t1 = [&R] (A[&&NHX:S=sp1;D=yes],B)R;
  TREE t2 = (C,D)S;
END;`;
      const { projects } = parseNexusTrees(nx, 't');
      expect(projects).toHaveLength(2);
      const a = Object.values(projects[0].nodes).find((n) => n.label === 'A');
      expect(firstComment(a)).toBe('&&NHX:S=sp1;D=yes');
    });
  });

  describe('node annotations are preserved', () => {
    it('keeps NHX / dating metadata through the NEXUS path and re-exports it', () => {
      const nx = `#NEXUS
BEGIN TREES;
  TREE t1 = [&R] ((A[&date=2020-01-01],B)[&NHX:S=anc],C)[&mod=9]R;
END;`;
      const p = parseNexus(nx, 't');
      const byLabel = (l: string) => Object.values(p.nodes).find((n) => n.label === l);
      expect(firstComment(byLabel('A'))).toBe('&date=2020-01-01');
      expect(firstComment(byLabel('R'))).toBe('&mod=9');
      const out = serializeNexus(p);
      expect(out).toContain('[&date=2020-01-01]');
      expect(out).toContain('[&NHX:S=anc]');
      expect(out).toContain('[&mod=9]');
      // Round-trip: re-importing keeps the annotations rather than losing them.
      const again = parseNexus(out, 't');
      expect(
        firstComment(Object.values(again.nodes).find((n) => n.label === 'A')),
      ).toBe('&date=2020-01-01');
    });

    it('still strips comments outside the TREES block', () => {
      const nx = `#NEXUS
[ a comment with ; a semicolon and BEGIN TREES; inside it ]
BEGIN TREES;
  TREE t1 = (A,B)R;
END;`;
      const p = parseNexus(nx, 't');
      expect(Object.values(p.nodes).map((n) => n.label)).toContain('A');
    });
  });

  describe('CHARACTERS + ASSUMPTIONS export', () => {
    const withChars = (): Project => {
      const p = createEmptyProject('chars');
      const [a, b] = addChildren(p, p.rootId, 2);
      renameNode(p, a, 'Taxon A');
      renameNode(p, b, 'Taxon A'); // deliberate duplicate
      const character1: Character = {
        id: 'c1',
        name: 'character1',
        type: 'discrete',
        states: [
          { id: 's1', label: '状态 A', color: '#111111' },
          { id: 's2', label: '状态 B', color: '#222222' },
        ],
        costMatrix: [
          [0, 2],
          [3, 0],
        ],
      };
      const character2: Character = { id: 'c2', name: 'character2', type: 'continuous', states: [] };
      p.characters = [character1, character2];
      p.nodes[a].charStates = { c1: 's1', c2: 12.5 };
      p.nodes[b].charStates = { c1: 'not-a-declared-state' };
      return p;
    };
    const opts = {
      includeCharacters: true,
      includeHypothesis: true,
      includeMrBayes: false,
      includeBeast: false,
    };

    it('declares 1-based SYMBOLS and STATELABELS per character block', () => {
      const out = serializeNexus(withChars(), opts);
      expect(out).toContain('BEGIN CHARACTERS;');
      expect(out).toContain('DIMENSIONS NTAX=2 NCHAR=1;');
      expect(out).toContain('SYMBOLS="12"');
      // STATELABELS carries the (block-local) character number — without it
      // the statement is not valid NEXUS.
      expect(out).toContain("STATELABELS 1 '状态 A' '状态 B';");
      expect(out).toContain("CHARLABELS character1;");
      // State 1 → '1' (never the 0-based '0'), and an undeclared value → MISSING.
      expect(out).toMatch(/'Taxon A'\s+1\s*\n/);
      expect(out).toMatch(/'Taxon A_2'\s+\?/);
      expect(out).not.toContain('SYMBOLS="0');
    });

    it('writes continuous characters as CONTINUOUS data, not as missing states', () => {
      const out = serializeNexus(withChars(), opts);
      expect(out).toContain('FORMAT DATATYPE=CONTINUOUS MISSING=?;');
      expect(out).toContain('NCHAR=1 NEXTRA=1;');
      expect(out).toMatch(/character2/);
      // The continuous matrix holds the value and a '?' for the uncoded tip.
      expect(out).toMatch(/12\.5/);
      // NCHAR only ever counts what the block can actually hold.
      const nchar = [...out.matchAll(/NCHAR=(\d+)/g)].map((m) => Number(m[1]));
      expect(nchar).toEqual([1, 1]);
    });

    it('gives duplicate / empty tip labels unique names shared by TAXA and TREES', () => {
      const out = serializeNexus(withChars(), opts);
      expect(out).toContain('DIMENSIONS NTAX=2;');
      expect(out).toMatch(/TAXLABELS 'Taxon A' 'Taxon A_2';/);
      // The TREE string uses the very same names, so the blocks agree.
      expect(out).toContain("'Taxon A'");
      expect(out).toContain("'Taxon A_2'");
      expect(() => parseNexus(out, 'again')).not.toThrow();
    });

    it('emits the applied cost matrix instead of contradicting it', () => {
      const out = serializeNexus(withChars(), opts);
      expect(out).toContain('BEGIN ASSUMPTIONS;');
      expect(out).not.toContain('DEFTYPE = UNORD');
      // character1 declares [[0,2],[3,0]] → asymmetric custom matrix, row-major.
      expect(out).toContain('OPTIONS DEFTYPE=CUSTOM APPLYTO=(1);');
      expect(out).toContain('OPTIONS COSTMATRIX=(0 2 3 0) APPLYTO=(1) STATES=(1 2);');
      // Valid character-set syntax: a set of character numbers, not state names.
      expect(out).toContain('CHARSET character1 = 1;');
      expect(out).not.toContain('CHARSET character1 = 状态 A');
    });

    it('reports a uniform matrix as NONADDITIVE 0/1 costs', () => {
      const p = withChars();
      delete p.characters[0].costMatrix;
      const out = serializeNexus(p, opts);
      expect(out).toContain('OPTIONS DEFTYPE=NONADDITIVE APPLYTO=(1);');
      expect(out).toContain('OPTIONS COSTMATRIX=(0 1 1 0) APPLYTO=(1)');
    });

    it('exports nothing for an empty project and honours the option flags', () => {
      const p = createEmptyProject('bare');
      addChildren(p, p.rootId, 1);
      expect(serializeNexus(p, DEFAULT_NEXUS_OPTIONS)).not.toContain('BEGIN CHARACTERS;');
      expect(serializeNexus(p, DEFAULT_NEXUS_OPTIONS)).not.toContain('BEGIN ASSUMPTIONS;');
    });
  });

  describe('STANDARD matrix import regressions', () => {
    const matrixFile = (body: string): string => `#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=3 NCHAR=2;
FORMAT DATATYPE=STANDARD GAP="-" MISSING="?" SYMBOLS="01";
TAXLABELS A B C;
MATRIX
A  ${body}
B  1 0
C  0 1;
END;`;

    it('reads a `{01}` uncertainty cell as a state set, not four pseudo-states', () => {
      // `{…}` is the NEXUS uncertainty notation (Mesquite / PAUP): the braces
      // group their contents into ONE cell that carries BOTH states. Leaving
      // the braces in place used to split the cell into `{`, `0`, `1`, `}`.
      const r = parseNexusMatrix(matrixFile('0 {01}'));
      expect(r.characters).toHaveLength(2);
      const ch = r.characters[1];
      expect(ch.states.map((s) => s.label)).toEqual(['0', '1']);
      const asg = (ch as Character & { __assignments?: Record<string, string | string[]> })
        .__assignments;
      expect(asg?.A).toHaveLength(2);
      // A single observed state assigns one state id (a bare string)…
      expect(typeof asg?.B).toBe('string');
      expect(typeof asg?.C).toBe('string');
      // …and B/C sit on DIFFERENT states of the same column.
      expect(asg?.B).not.toBe(asg?.C);
    });

    it('does not swallow the MATRIX body when OPTIONS carries `COSTMATRIX = (…)`', () => {
      // The space before `=` is legal NEXUS; without a word boundary the
      // MATRIX regex matched INSIDE `costmatrix` and the OPTIONS line was
      // parsed as the matrix body, silently dropping the real data.
      const nx = `#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=3 NCHAR=1;
FORMAT DATATYPE=STANDARD GAP="-" MISSING="?" SYMBOLS="01";
TAXLABELS A B C;
OPTIONS COSTMATRIX = (0 1 1 0) APPLYTO = (1);
MATRIX
A  0
B  1
C  1;
END;`;
      const r = parseNexusMatrix(nx);
      expect(r.characters).toHaveLength(1);
      expect(r.characters[0].states.map((s) => s.label)).toEqual(['0', '1']);
    });

    it('reshapes a flat row-major COSTMATRIX and round-trips its own export', () => {
      // CladeForge writes `COSTMATRIX=(0 2 3 0)` (row-major flat). A k-state
      // cost matrix is k×k, so a single n²-length row reshapes to n rows —
      // without this the import dropped the matrix it had just exported.
      const nx = `#NEXUS
BEGIN DATA;
DIMENSIONS NTAX=3 NCHAR=1;
FORMAT DATATYPE=STANDARD GAP="-" MISSING="?" SYMBOLS="01";
TAXLABELS A B C;
OPTIONS COSTMATRIX=(0 2 3 0) APPLYTO=(1);
MATRIX
A  0
B  1
C  1;
END;`;
      const r = parseNexusMatrix(nx);
      expect(r.characters).toHaveLength(1);
      expect(r.characters[0].costMatrix).toEqual([
        [0, 2],
        [3, 0],
      ]);
    });
  });
});
