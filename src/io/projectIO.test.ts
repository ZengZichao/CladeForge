import { describe, it, expect } from 'vitest';
import { createEmptyProject } from '../model/sampleTree';
import { addChildren, renameNode } from '../model/treeOps';
import { readProjectFile, serializeProject, parseProject } from './projectIO';
describe('project IO — DTL reconciliation fields', () => {
  it('round-trips embedded gene trees and assumptions', () => {
    const p = createEmptyProject('sp');
    const [a] = addChildren(p, p.rootId, 1);
    renameNode(p, a, 'A');
    const gene = createEmptyProject('g');
    const [t] = addChildren(gene, gene.rootId, 1);
    renameNode(gene, t, 'a');
    p.geneTrees = [
      {
        id: 'gt_1',
        name: 'Gene family X',
        doc: gene,
        assumptions: { [gene.rootId]: { speciesNode: p.rootId, event: 'speciation' } },
      },
    ];
    p.reconCosts = { dup: 2, transfer: 3, loss: 4 };

    const text = serializeProject(p);
    const { project: back, issues } = readProjectFile(text);
    expect(issues).toEqual([]);
    expect(back.geneTrees).toHaveLength(1);
    const entry = back.geneTrees![0];
    expect(entry.name).toBe('Gene family X');
    expect(entry.doc.nodes[t].label).toBe('a');
    // Nested docs never carry their own gene trees.
    expect(entry.doc.geneTrees).toBeUndefined();
    expect(entry.assumptions[gene.rootId]).toEqual({
      speciesNode: p.rootId,
      event: 'speciation',
    });
    expect(back.reconCosts).toEqual({ dup: 2, transfer: 3, loss: 4 });
    // Saved version stamps the current schema.
    expect(back.version).toBe('0.1.0');
  });

  it('opens a file with an unrecognised version stamp best-effort, backfilling reconciliation', () => {
    const legacy = createEmptyProject('old');
    legacy.version = '1.0' as typeof legacy.version;
    const wrapped = JSON.stringify({
      app: 'CladeForge',
      version: '1.0',
      project: JSON.parse(JSON.stringify(legacy)),
    });

    const { project, issues } = readProjectFile(wrapped);
    expect(project.geneTrees).toEqual([]);
    expect(project.reconCosts).toEqual({ dup: 1, transfer: 2, loss: 1 });
    // `0.1.0` is the schema baseline and the migration registry is empty: a file
    // declaring any other version is announced as a best-effort open instead of
    // silently upgraded.
    expect(issues.join(' ')).toMatch(/0\.1\.0/);
    // The declared version is kept, not silently upgraded in the document.
    expect(project.version).toBe('1.0');

    // parseProject convenience wrapper tolerates the same input.
    expect(parseProject(wrapped).name).toBe('old');
  });

  it('repairs malformed reconCosts to defaults AND says so', () => {
    const p = createEmptyProject('costs');
    (p as unknown as Record<string, unknown>).reconCosts = { dup: 'x', transfer: -5 };
    const { project, issues } = readProjectFile(serializeProject(p));
    expect(project.reconCosts).toEqual({ dup: 1, transfer: 2, loss: 1 });
    // The repair must be visible: a backfill that replaces junk silently leaves
    // the user no way to know their costs were not the ones applied.
    expect(issues.filter((i) => /dup|transfer/.test(i))).toHaveLength(2);
  });

  describe('hand-edited cost fields', () => {
    const costsOf = (reconCosts: unknown) => {
      const p = createEmptyProject('c');
      (p as unknown as Record<string, unknown>).reconCosts = reconCosts;
      return readProjectFile(serializeProject(p));
    };

    it('rejects null / empty string / missing instead of reading them as 0', () => {
      // `Number(null) === 0` and `Number('') === 0`: coercing a hand-edited
      // `"dup": null` to 0 would make duplication FREE, which the DP exploits.
      for (const bad of [{ dup: null }, { dup: '' }, { loss: null }, { transfer: [] }, { dup: true }]) {
        const { project, issues } = costsOf({ ...bad });
        const key = Object.keys(bad)[0] as 'dup' | 'loss' | 'transfer';
        expect(project.reconCosts![key]).not.toBe(0);
        expect(issues.join(' ')).toMatch(new RegExp(key));
      }
    });

    it('accepts real numbers, including an explicit 0', () => {
      const { project, issues } = costsOf({ dup: 0, transfer: 4.5, loss: 0 });
      expect(project.reconCosts).toEqual({ dup: 0, transfer: 4.5, loss: 0 });
      expect(issues).toEqual([]);
    });

    it('leaves a file with no cost block alone (silent backfill)', () => {
      const { project, issues } = costsOf(undefined);
      expect(project.reconCosts).toEqual({ dup: 1, transfer: 2, loss: 1 });
      expect(issues).toEqual([]);
    });
  });

  describe('unknown fields and version stamps', () => {
    it('preserves top-level fields this build does not know, verbatim', () => {
      const p = createEmptyProject('future');
      const wrapped = JSON.stringify({
        app: 'CladeForge',
        version: '0.1.0',
        project: {
          ...JSON.parse(JSON.stringify(p)),
          myAnnotation: { curatedBy: 'someone', notes: ['keep me'] },
          tipCoordinates: [1, 2, 3],
        },
      });
      const { project, issues } = readProjectFile(wrapped);
      const extras = project as unknown as Record<string, unknown>;
      expect(extras.myAnnotation).toEqual({ curatedBy: 'someone', notes: ['keep me'] });
      expect(extras.tipCoordinates).toEqual([1, 2, 3]);
      // And it is *told* that these were carried along.
      expect(issues.join(' ')).toMatch(/myAnnotation/);
      // Saving writes them back where they came from.
      const again = readProjectFile(serializeProject(project));
      const back = again.project as unknown as Record<string, unknown>;
      expect(back.myAnnotation).toEqual({ curatedBy: 'someone', notes: ['keep me'] });
    });

    it('keeps the version the file declared instead of re-stamping it', () => {
      const p = createEmptyProject('v12');
      const raw = JSON.parse(JSON.stringify(p));
      raw.version = '1.2';
      const wrapped = JSON.stringify({ app: 'CladeForge', version: '1.2', project: raw });
      const { project, issues } = readProjectFile(wrapped);
      expect(project.version).toBe('1.2');
      expect(serializeProject(project)).toContain('"version": "1.2"');
      // A best-effort open of a newer schema must be announced.
      expect(issues.join(' ')).toMatch(/1\.2/);
    });

    it('stamps the current version only when the file never declared one', () => {
      const p = createEmptyProject('noversion');
      const raw = JSON.parse(JSON.stringify(p));
      delete raw.version;
      const { project } = readProjectFile(JSON.stringify(raw));
      expect(project.version).toBe('0.1.0');
    });
  });
});
