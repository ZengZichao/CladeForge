// Regression tests for project persistence (S6/M9).
import { describe, it, expect } from 'vitest';
import { parseNewick } from './newick';
import { serializeProject, readProjectFile } from './projectIO';

describe('review: known-but-optional fields survive a save/load cycle (S6)', () => {
  it('customEventTypes and analysisResults round-trip', () => {
    const p = parseNewick('(A,B)R;') as ReturnType<typeof parseNewick> & {
      customEventTypes?: unknown[];
      analysisResults?: unknown[];
      reconOptions?: unknown;
      sampleId?: string;
      provenance?: unknown;
    };
    p.customEventTypes = [
      {
        id: 'custom',
        label: 'Loss',
        labelEn: 'Loss',
        group: 'Custom',
        groupEn: 'Custom',
        code: 'GL',
        color: '#64748b',
        target: 'both',
      },
    ];
    p.analysisResults = [
      { id: 'run1', kind: 'parsimony', fingerprint: 'f1', method: 'Sankoff parsimony', params: { a: 1 }, payload: { cost: 3 }, version: '0.2.0', createdAt: '2026-11-07' },
    ];
    p.reconOptions = { freeRoot: true };
    p.sampleId = 'sample-1';
    p.provenance = { methodsNote: 'x' };
    const rt = readProjectFile(serializeProject(p)).project as typeof p;
    expect(rt.customEventTypes).toEqual(p.customEventTypes);
    expect(rt.analysisResults).toEqual(p.analysisResults);
    expect(rt.reconOptions).toEqual({ freeRoot: true });
    expect(rt.sampleId).toBe('sample-1');
    expect(rt.provenance).toEqual({ methodsNote: 'x' });
  });
});

describe('review: migration version stamping (M9)', () => {
  it('a migrated document is re-stamped to the schema it migrated to', () => {
    const raw = {
      app: 'CladeForge',
      version: '0.1.0',
      project: {
        version: '0.1.0',
        nodes: {
          r: { id: 'r', label: 'R', parentId: null, childrenIds: ['a', 'b'] },
          a: { id: 'a', label: 'A', parentId: 'r', childrenIds: [] },
          b: { id: 'b', label: 'B', parentId: 'r', childrenIds: [] },
        },
        rootId: 'r',
      },
    };
    const { project } = readProjectFile(JSON.stringify(raw));
    expect(project.version).toBe('0.2.0');
    const envelope = JSON.parse(serializeProject(project));
    expect(envelope.version).toBe('0.2.0');
  });

  it('a newer schema version is never silently re-stamped', () => {
    const raw = {
      app: 'CladeForge',
      version: '9.0.0',
      project: {
        version: '9.0.0',
        nodes: {
          r: { id: 'r', label: 'R', parentId: null, childrenIds: ['a', 'b'] },
          a: { id: 'a', label: 'A', parentId: 'r', childrenIds: [] },
          b: { id: 'b', label: 'B', parentId: 'r', childrenIds: [] },
        },
        rootId: 'r',
      },
    };
    const { project } = readProjectFile(JSON.stringify(raw));
    expect(project.version).toBe('9.0.0');
  });
});
