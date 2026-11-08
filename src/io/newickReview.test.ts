// Regression tests for the Newick review findings (S3/M5/M6/M7 + parse strictness).
import { describe, it, expect } from 'vitest';
import { parseNewick, parseNewickTrees, serializeNewick } from './newick';

const rootOf = (p: ReturnType<typeof parseNewick>) => p.nodes[p.rootId];

describe('review: support-scale inference (S3)', () => {
  it('a branch length above 1 does not classify the file as percent', () => {
    const r = parseNewickTrees('(A:0.5,B:12)0.9;');
    const root = rootOf(r.projects[0]);
    expect(root.support).toBe(0.9);
    expect(root.supportScale).toBe('fraction'); // the intended posterior reading
  });

  it('numeric tip names do not enter the inference', () => {
    const r = parseNewickTrees('(1:0.5,2:0.8)0.9;');
    expect(rootOf(r.projects[0]).supportScale).toBe('fraction');
  });

  it('a genuine bare percent support is still percent', () => {
    const r = parseNewickTrees('((A,B)95,C);');
    const internal = Object.values(r.projects[0].nodes).find((n) => n.support === 95)!;
    expect(internal.supportScale).toBe('percent');
  });

  it('an explicit convention wins over the inference', () => {
    const r = parseNewickTrees('(A:0.5,B:0.8)0.9;', 't', undefined, { supportConvention: 'percent' });
    expect(rootOf(r.projects[0]).supportScale).toBe('percent');
  });
});

describe('review: structured comments (M5)', () => {
  it('a BEAST HPD interval is parsed even with a brace-set value', () => {
    const p = parseNewick('(A[&height=10,height_95%_HPD={8,12}]:1,B:2);');
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    expect(a.age).toBe(10);
    expect(a.ageMin).toBe(8);
    expect(a.ageMax).toBe(12);
  });

  it('NHX fields separated by colons stay separate', () => {
    const p = parseNewick('(A[&&NHX:S=human:D=Y]:1,B:2);');
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    expect((a.meta?.nhx as Record<string, string>).S).toBe('human');
    expect((a.meta?.nhx as Record<string, string>).D).toBe('Y');
  });
});

describe('review: nested comments and rootedness (M6/M7)', () => {
  it('a NEXUS-style nested bracket comment parses', () => {
    expect(() => parseNewick('(A[a[b]c],B);')).not.toThrow();
    const p = parseNewick('(A[a[b]c],B);');
    const a = Object.values(p.nodes).find((n) => n.label === 'A')!;
    expect((a.meta?.comments as string[]).length).toBe(1);
  });

  it('an explicitly rooted trifurcation round-trips as rooted', () => {
    const p = parseNewick('(A,B,C)[&R];');
    expect(rootOf(p).meta?.rooted).toBe(true);
    const out = serializeNewick(p, { rootedMarker: true });
    expect(out).toContain('[&R]');
    const back = parseNewick(out);
    expect(rootOf(back).meta?.rooted).toBe(true);
  });
});

describe('review: branch-length token strictness', () => {
  it('a trailing-garbage branch length is reported, not truncated', () => {
    const r = parseNewickTrees('(A:1.5abc,B:1);');
    expect(r.issues.join(' ')).toMatch(/1\.5abc/);
    const a = Object.values(r.projects[0].nodes).find((n) => n.label === 'A')!;
    expect(a.branchLength).toBeUndefined();
  });

  it('an unterminated quote is an error, not a silent half label', () => {
    expect(() => parseNewick('("A,B);')).toThrow();
  });
});
