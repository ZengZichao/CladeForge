// "已映射尖端" must not double-count label hits and hypothesis hits:
// `suggestLcaScenario` records a `speciesNode` assumption for the very tips it
// mapped by label, so summing the two sources lets the panel read "240/120".

import { describe, it, expect } from 'vitest';
import { countMappedTips, geneTreeRows } from './reconStats';
import { makeGeneTreeEntry } from '../model/geneTrees';
import { mapTipsByLabel, suggestLcaScenario } from '../model/reconciliation';
import { parseNewick } from '../io/newick';
import type { NodeId, Project } from '../model/types';

const tipIdOf = (p: Project, label: string): NodeId => {
  const id = Object.keys(p.nodes).find((k) => p.nodes[k].label === label);
  if (!id) throw new Error(`no tip ${label}`);
  return id;
};

function species(): Project {
  return parseNewick('((A,B),(C,D));', 'species');
}

/** Embed `newick` as a gene tree of a fresh species document. */
function withGene(geneNewick: string, applySuggestion = false) {
  const p = species();
  const entry = makeGeneTreeEntry(parseNewick(geneNewick, 'gene'), 'g1');
  p.geneTrees = [entry];
  const mappings = mapTipsByLabel(p, entry.doc).mappings;
  if (applySuggestion) {
    entry.assumptions = suggestLcaScenario(p, entry.doc, mappings, entry.assumptions);
  }
  return { p, entry, mappings };
}

describe('geneTreeRows — mapped-tip counting', () => {
  it('an LCA suggestion over 4 label-matched tips reports 4/4, not 8/4', () => {
    const { p, entry, mappings } = withGene('((A,B),(C,D));', true);
    // What the suggestion writes: every tip carries BOTH a label mapping and an
    // assumption, so adding the two counts would give 8.
    const tipIds = Object.keys(entry.doc.nodes).filter(
      (k) => entry.doc.nodes[k].childrenIds.length === 0,
    );
    const labelHits = tipIds.filter((k) => mappings[k]).length;
    const assumedTips = tipIds.filter((k) => entry.assumptions[k]?.speciesNode).length;
    expect(labelHits).toBe(4);
    expect(assumedTips).toBe(4);
    expect(labelHits + assumedTips).toBe(8); // the bug, spelled out

    const row = geneTreeRows(p)[0];
    expect(row.tips).toBe(4);
    expect(row.mappedTips).toBe(4);
    expect(row.unmappedTips).toBe(0);
    expect(countMappedTips(entry, mappings)).toBe(4);
  });

  it('unmatched gene tips stay unmapped and the count never exceeds the tips', () => {
    const { p, entry, mappings } = withGene('((A,B),(X,Y));', true);
    const row = geneTreeRows(p)[0];
    expect(row.tips).toBe(4);
    expect(row.mappedTips).toBe(2); // A and B only
    expect(row.unmappedTips).toBe(2);
    expect(row.mappedTips).toBeLessThanOrEqual(row.tips);
    expect(row.unmatchedLabels.sort()).toEqual(['X', 'Y']);
  });

  it('a hand-made assumption counts even when the label matches nothing', () => {
    const { p, entry, mappings } = withGene('((A,B),(X,Y));');
    entry.assumptions[tipIdOf(entry.doc, 'X')] = { speciesNode: tipIdOf(p, 'C') };
    const row = geneTreeRows(p)[0];
    expect(row.mappedTips).toBe(3); // A, B by label; X by hypothesis
    expect(row.unmappedTips).toBe(1);
  });

  it('empty assumptions and a gene tree with no matching labels count zero', () => {
    const { p, entry, mappings } = withGene('((P,Q),(R,S));');
    expect(geneTreeRows(p)[0].mappedTips).toBe(0);
    expect(countMappedTips(entry, mappings)).toBe(0);
  });

  it('rows exist for every embedded gene tree, with its own summary', () => {
    const { p, entry } = withGene('((A,B),(C,D));', true);
    p.geneTrees = [entry, makeGeneTreeEntry(parseNewick('(A,B);', 'g2'), 'g2')];
    const rows = geneTreeRows(p);
    expect(rows.map((r) => r.name)).toEqual(['g1', 'g2']);
    expect(rows[1].tips).toBe(2);
    expect(rows[1].mappedTips).toBe(2); // label hits alone
    expect(rows[0].summary.totalInternal).toBeGreaterThan(0);
  });
});
