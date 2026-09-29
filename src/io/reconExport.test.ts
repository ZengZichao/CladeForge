import { describe, it, expect } from 'vitest';
import { buildReconciliationReport } from './reconExport';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';
import type { GeneTreeEntry } from '../model/types';

// ── the report is Markdown, and its own table syntax is data ────────────────
//
// Every string in the placement table comes from a user document: gene-node
// labels (often imported Newick), species labels, the gene-tree name, the project
// name. A `|` in any of them splits a row into extra columns, and a line break
// ends the row mid-cell — so the table silently stops describing what it claims.

function scenario(opts: {
  projectName?: string;
  geneName?: string;
  geneLabels?: [string, string];
} = {}) {
  const project = createEmptyProject(opts.projectName ?? 'Species tree');
  const [spA, spB] = addChildren(project, project.rootId, 2);
  project.nodes[spA].label = 'Species A';
  project.nodes[spB].label = 'Species B';

  const doc = createEmptyProject('gene doc');
  const [g1, g2] = addChildren(doc, doc.rootId, 2);
  doc.nodes[g1].label = opts.geneLabels?.[0] ?? 'T4|phage';
  doc.nodes[g2].label = opts.geneLabels?.[1] ?? 'copy\n2';

  const gene: GeneTreeEntry = {
    id: 'gene-1',
    name: opts.geneName ?? 'Adh|family',
    doc,
    assumptions: {
      [g1]: { speciesNode: spA },
      [g2]: { speciesNode: spB },
    },
  };
  project.geneTrees = [gene];
  return project;
}

/** Unescaped pipes are the only ones a Markdown renderer treats as cells. */
const cells = (line: string): number => (line.match(/(?<!\\)\|/g) ?? []).length;
const tableLines = (md: string): string[] =>
  md.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('| --- '));

describe('buildReconciliationReport — Markdown safety', () => {
  it('keeps a pipe in a gene-node label inside its cell', () => {
    const md = buildReconciliationReport(scenario());
    const rows = tableLines(md);
    expect(rows.length).toBeGreaterThanOrEqual(3); // header + separator + ≥ 2 rows
    const widths = new Set(rows.map(cells));
    expect([...widths], `every table line must have the same cell count, got ${[...widths]}`).toEqual([5]);
    expect(md).toContain('T4\\|phage');
  });

  it('never lets a label arrive as live markup outside the fenced Newick', () => {
    const md = buildReconciliationReport(
      scenario({
        geneLabels: ['<img src=x onerror=alert(1)>', 'ok'],
        geneName: '<script>evil</script>',
        projectName: '<a href="javascript:x">project</a>',
      }),
    );
    // The gene tree is emitted as Newick inside a ```newick fence, where `<` is
    // legitimate label content and Markdown renders the block verbatim and inert.
    // Everything OUTSIDE that fence is prose or a table cell, and must not carry
    // live markup.
    let fenced = false;
    const outside = md
      .split('\n')
      .filter((line) => {
        if (/^\s*```/.test(line)) {
          fenced = !fenced;
          return false;
        }
        return !fenced;
      })
      .join('\n');
    expect(outside).not.toMatch(/<(img|script|a)\b/i);
    expect(outside).toContain('&lt;a href'); // the project name in the heading
    expect(outside).toContain('&lt;script&gt;'); // the gene-tree section title
    // Table integrity survives the escaping: every row keeps its five cells.
    expect(new Set(tableLines(md).map(cells))).toEqual(new Set([5]));
    // And the Newick really is fenced, which is what makes the exception safe.
    expect(md).toMatch(/```newick\n[\s\S]*?<img[\s\S]*?\n```/);
  });

  it('keeps a line break in a label from ending the row', () => {
    const md = buildReconciliationReport(scenario());
    for (const line of md.split('\n')) {
      if (line.startsWith('|') && !line.startsWith('| --- ')) {
        expect(line.endsWith('|'), `row lost its closing delimiter: ${JSON.stringify(line)}`).toBe(true);
      }
    }
    // the label survived, just without the newline that would have broken the row
    expect(md).toContain('copy 2');
  });

  it('escapes the delimiter in the heading and the species column too', () => {
    const md = buildReconciliationReport(scenario({ geneName: 'Adh|family' }));
    expect(md).toContain('## Adh\\|family');
    const project = scenario();
    // rename a species tip with a pipe and re-render
    const sp = Object.values(project.nodes).find((n) => n.label === 'Species A');
    expect(sp).toBeDefined();
    sp!.label = 'Species|A';
    const md2 = buildReconciliationReport(project);
    const widths = new Set(tableLines(md2).map(cells));
    expect([...widths]).toEqual([5]);
  });

  it('does not put Newick quoting into a Markdown title', () => {
    // A report heading is prose, not a Newick label: `— "My Project"` would be a
    // label-quoting convention escaping into the title.
    const md = buildReconciliationReport(scenario({ projectName: 'My Project' }));
    expect(md.split('\n')[0]).toContain('— My Project');
    expect(md.split('\n')[0]).not.toContain('"My Project"');
  });

  it('leaves ordinary names untouched', () => {
    const md = buildReconciliationReport(
      scenario({ geneLabels: ['Adh1', 'Adh2'], geneName: 'Adh family' }),
    );
    expect(md).toContain('| Adh1 |');
    expect(md).toContain('| Adh2 |');
    expect(md).toContain('## Adh family');
  });
});
