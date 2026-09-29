import { describe, it, expect } from 'vitest';
import { parseNewick, parseNewickMulti, parseNewickTrees, serializeNewick } from './newick';
import { serializeNexus } from './nexus';
import { MAX_TREE_CHARS } from './limits';

/** First preserved `[...]` comment on a node (meta.comments is a string[]). */
function firstComment(n: { meta?: Record<string, unknown> } | undefined): unknown {
  const c = n?.meta?.comments;
  return Array.isArray(c) ? c[0] : undefined;
}

describe('newick', () => {
  it('round-trips a labelled tree with branch lengths', () => {
    const nwk = '((A:1,B:2)C:3,D:4)E;';
    const project = parseNewick(nwk);
    expect(serializeNewick(project)).toBe(nwk);
  });

  it('parses a multifurcation (polytomy)', () => {
    const project = parseNewick('(A,B,C,D)R;');
    const root = project.nodes[project.rootId];
    expect(root.label).toBe('R');
    expect(root.childrenIds).toHaveLength(4);
  });

  it('keeps quoted labels containing spaces', () => {
    const project = parseNewick("('Homo sapiens',B)R;");
    const labels = Object.values(project.nodes).map((n) => n.label);
    expect(labels).toContain('Homo sapiens');
  });

  it('converts underscores to spaces in unquoted names', () => {
    const project = parseNewick('(Homo_sapiens,Pan)R;');
    const labels = Object.values(project.nodes).map((n) => n.label);
    expect(labels).toContain('Homo sapiens');
  });

  it('round-trips a label whose underscore is literal', () => {
    // `_` means "space" in Newick, so a name that really contains one must be
    // written quoted. Unquoted, `Pakicetus_2` reads back as `Pakicetus 2`, and
    // because character states are keyed on the label the tip silently loses
    // every state assigned to the original name.
    const project = parseNewick('(Pakicetus_2,Ambulocetus)Cetacea;');
    expect(project.nodes).toBeTruthy();
    const withUnderscore = parseNewick('("Pakicetus_2",Ambulocetus)Cetacea;');
    const labels = Object.values(withUnderscore.nodes).map((n) => n.label);
    expect(labels).toContain('Pakicetus_2');
    const written = serializeNewick(withUnderscore);
    expect(written).toContain('"Pakicetus_2"');
    const reread = Object.values(parseNewick(written).nodes).map((n) => n.label);
    expect(reread).toContain('Pakicetus_2');
    expect(reread).not.toContain('Pakicetus 2');
  });

  it('keeps bracket comments as node metadata instead of stripping them', () => {
    // Bracket comments are node metadata, not noise to discard: the annotation
    // has to survive the parse, because that is what makes the Newick path
    // lossless.
    const project = parseNewick('(A[&x=1],B)R;');
    const root = project.nodes[project.rootId];
    expect(root.childrenIds).toHaveLength(2);
    const a = Object.values(project.nodes).find((n) => n.label === 'A');
    expect(firstComment(a)).toBe('&x=1');
    expect(serializeNewick(project)).toBe('(A[&x=1],B)R;');
  });

  it('parses a single leaf', () => {
    const project = parseNewick('A;');
    expect(project.nodes[project.rootId].label).toBe('A');
  });

  it('routes a numeric internal label to support and round-trips it', () => {
    const project = parseNewick('((A,B)95,C)R;');
    const inner = Object.values(project.nodes).find(
      (n) => n.childrenIds.length > 0 && n.label === '',
    );
    expect(inner?.support).toBe(95);
    expect(serializeNewick(project)).toBe('((A,B)95,C)R;');
  });

  it('preserves a bracket comment on its node across a round-trip', () => {
    const nwk = '(A[&NHX:S=Human],B)R;';
    const project = parseNewick(nwk);
    const a = Object.values(project.nodes).find((n) => n.label === 'A');
    expect(firstComment(a)).toBe('&NHX:S=Human');
    expect(serializeNewick(project)).toBe(nwk);
  });

  it('parses multiple ";"-separated trees', () => {
    const projects = parseNewickMulti('(A,B);(C,D);');
    expect(projects).toHaveLength(2);
    expect(Object.values(projects[0].nodes).map((n) => n.label)).toContain('A');
    expect(Object.values(projects[1].nodes).map((n) => n.label)).toContain('D');
  });

  it('rejects a string with no terminating semicolon', () => {
    expect(() => parseNewick('(A,B')).toThrow();
  });

  it('rejects a stray "]" instead of looping forever', () => {
    // The label scanner terminates on ']', so a stray closing bracket would
    // consume nothing and spin forever (infinite loop / UI freeze) unless the
    // tokenizer rejects it by throwing.
    expect(() => parseNewick('(A,B]C;')).toThrow(/\]/);
  });

  it('round-trips safely when a comment contains "]"', () => {
    // Serialising a comment that contains ']' must not emit a stray bracket that
    // would hang a subsequent parse.
    const project = parseNewick('(A,B)R;');
    const a = Object.values(project.nodes).find((n) => n.label === 'A');
    if (a) a.meta = { comment: 'note]with]brackets' };
    const out = serializeNewick(project);
    expect(() => parseNewick(out)).not.toThrow();
  });

  it('drops a negative branch length but reports it (no silent loss)', () => {
    // A negative length cannot be drawn on a phylogram, so it must not reach
    // `branchLength`; silently discarding the user's data is what this guards.
    const { projects, issues } = parseNewickTrees('(A:-5,B:2)R:3;');
    const project = projects[0];
    const a = Object.values(project.nodes).find((n) => n.label === 'A');
    expect(a?.branchLength).toBeUndefined();
    const b = Object.values(project.nodes).find((n) => n.label === 'B');
    expect(b?.branchLength).toBe(2);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/-5/);
    expect(issues[0]).toMatch(/A/);
    // parseNewick is the thin wrapper that simply omits the notes.
    expect(parseNewick('(A:-5,B:2)R:3;').nodes).toBeTruthy();
  });

  it('reports a non-numeric branch length instead of swallowing it', () => {
    const { issues } = parseNewickTrees('(A:abc,B:2)R;');
    expect(issues.join(' ')).toMatch(/abc/);
  });

  it('round-trips an internal node that has BOTH a name and a support value', () => {
    // Newick has a single label slot, so a named clade and its support value
    // cannot both be written bare: the name goes in the slot, the support travels
    // in a `[&support=…]` comment.
    const project = parseNewick('((A,B)Neoceti,C)Pelagiceti;');
    const inner = Object.values(project.nodes).find((n) => n.label === 'Neoceti');
    expect(inner).toBeTruthy();
    inner!.support = 95;
    const out = serializeNewick(project);
    expect(out).toContain('Neoceti');
    expect(out).toContain('[&support=95]');
    const again = parseNewick(out);
    const back = Object.values(again.nodes).find((n) => n.label === 'Neoceti');
    expect(back?.support).toBe(95);
    // Byte-stable from there on.
    expect(serializeNewick(again)).toBe(out);
  });

  it('keeps a quoted numeric label as a NAME, never as support', () => {
    const project = parseNewick("((A,B)'0.95',C)R;");
    const inner = Object.values(project.nodes).find((n) => n.childrenIds.length === 2 && n.parentId);
    expect(inner?.label).toBe('0.95');
    expect(inner?.support).toBeUndefined();
    const out = serializeNewick(project);
    // Written quoted again, so re-parsing cannot turn it into a support value.
    // Double quotes are the convention external readers (ape) strip; single
    // quotes come back as part of the label.
    expect(out).toContain('"0.95"');
    const again = parseNewick(out);
    expect(Object.values(again.nodes).some((n) => n.label === '0.95')).toBe(true);
    // A name containing spaces must survive with no quote characters attached,
    // or every downstream tool sees a taxon literally named "'Tobacco mosaic virus'".
    const spaced = parseNewick("((A,B),(C,D))'Tobacco mosaic virus';");
    const spacedOut = serializeNewick(spaced);
    expect(spacedOut).toContain('"Tobacco mosaic virus"');
    expect(spacedOut).not.toMatch(/'[^']*virus[^']*'/);
    const reparsed = parseNewick(spacedOut);
    expect(Object.values(reparsed.nodes).some((n) => n.label === 'Tobacco mosaic virus')).toBe(true);
    expect(Object.values(reparsed.nodes).some((n) => n.label?.startsWith("'"))).toBe(false);
  });

  it('never emits an empty tip label (illegal in most readers)', () => {
    const project = parseNewick('(A,B)R;');
    const a = Object.values(project.nodes).find((n) => n.label === 'A');
    if (a) a.label = '';
    const out = serializeNewick(project);
    expect(out).not.toContain('(,');
    expect(out).not.toContain(',)');
    // The stand-in must be deterministic and obviously synthetic. The old
    // fallback used the node id, which is a random nanoid — so every export
    // invented a DIFFERENT fake taxon name.
    expect(out).toContain('unnamed_1');
    expect(out).not.toContain(a!.id);
    expect(serializeNewick(project)).toBe(out); // stable across repeated exports
    expect(() => parseNewick(out)).not.toThrow();
  });

  it('reads back a labelled node whose support comment sits beside an NHX comment', () => {
    const project = parseNewick('((A,B)X[&support=88][&&NHX:S=Species1],C)R;');
    const x = Object.values(project.nodes).find((n) => n.label === 'X');
    expect(x?.support).toBe(88);
    expect(firstComment(x)).toBe('&&NHX:S=Species1');
  });

  it('guards the parse entry point against empty / runaway input', () => {
    expect(() => parseNewickTrees('')).toThrow(/empty/i);
    expect(() => parseNewickTrees('   \n ')).toThrow(/empty/i);
    // The ceiling is far above any real tree (10 000 tips ≈ 250 kB) but finite.
    expect(MAX_TREE_CHARS).toBeGreaterThan(1024 * 1024);
  });

  describe('rootedness', () => {
    it('reads a trifurcate root as an unrooted tree and says so', () => {
      // IQ-TREE / RAxML / MrBayes write unrooted topologies as a trifurcation at
      // an arbitrary node. That has to be recorded as rooted=false: a NEXUS export
      // claiming `[&R]` instead makes PAUP polarise the characters wrongly.
      const { projects, issues } = parseNewickTrees('((A,B),(C,D),(E,F))R;');
      const project = projects[0];
      expect(project.nodes[project.rootId].meta?.rooted).toBe(false);
      expect(issues.join(' ')).toMatch(/三歧|trifurcate/i);
    });

    it('keeps a binary root without a marker silent (CladeForge convention: rooted)', () => {
      const { projects, issues } = parseNewickTrees('((A,B),C)R;');
      const project = projects[0];
      expect(project.nodes[project.rootId].meta?.rooted).toBeUndefined();
      expect(issues).toHaveLength(0);
    });

    it('lets an explicit [&R] beat the trifurcate-root inference', () => {
      // A declared root wins over the shape heuristic — and the declaration is
      // consumed, so it cannot round-trip as node metadata.
      const { projects } = parseNewickTrees('((A,B),(C,D),(E,F))R[&R];');
      const project = projects[0];
      expect(project.nodes[project.rootId].meta?.rooted).toBe(true);
      expect(project.nodes[project.rootId].meta?.comments).toBeUndefined();
      expect(serializeNexus(project)).toContain('TREE tree1 = [&R]');
    });

    it('consumes an explicit [&U] comment and keeps it through a re-export', () => {
      const { projects, issues } = parseNewickTrees('((A,B),(C,D))X[&U];');
      const project = projects[0];
      const root = project.nodes[project.rootId];
      expect(root.meta?.rooted).toBe(false);
      // Consumed, so it cannot round-trip twice (the same reason nexus.ts strips
      // the statement-level marker).
      expect(root.meta?.comments).toBeUndefined();
      expect(issues.join(' ')).toMatch(/\[&U\]/);
      const out = serializeNewick(project, { rootedMarker: true });
      expect(out).toBe('((A,B),(C,D))X[&U];');
      const again = parseNewickTrees(out).projects[0];
      expect(again.nodes[again.rootId].meta?.rooted).toBe(false);
    });

    it('annotates only unrooted documents when asked to', () => {
      const rooted = parseNewick('((A,B),C)R;');
      expect(serializeNewick(rooted, { rootedMarker: true })).toBe('((A,B),C)R;');
      // The default stays unmarked (nexus.ts writes its own statement-level
      // marker and must not get a second one).
      expect(serializeNewick(rooted)).toBe('((A,B),C)R;');
    });

    it('does not emit [&R] for a trifurcate-root import on the NEXUS exit', () => {
      const project = parseNewick('((A,B),(C,D),(E,F))R;', 't');
      const nex = serializeNexus(project);
      expect(nex).toContain('TREE tree1 = [&U]');
      expect(nex).not.toContain('[&R]');
    });
  });
});
