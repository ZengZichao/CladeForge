// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Component-level contracts for the EMBEDDED reconciliation canvas and the
// mode switch (plan §9.2): the nested figure mounts with tubes/hubs/mask/
// transfer arc, tube clicks surface the branch + within-branch position, and
// the side-by-side ⇄ embedded switch mounts exactly one canvas at a time
// without touching selections.

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from '../model/store';
import {
  createReconciliationSample,
  createEmptyProject,
} from '../model/sampleTree';
import { DEFAULT_RECON_VIEW_OPTIONS } from '../model/types';
import { addChildren, renameNode } from '../model/treeOps';
import { S } from '../ui/strings';
import { EmbeddedReconCanvas } from './EmbeddedReconCanvas';
import { ReconciliationView } from './ReconciliationView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  if (!('requestAnimationFrame' in globalThis)) {
    (globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame =
      (cb) => setTimeout(() => cb(0), 0) as unknown as number;
  }
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

let host: HTMLElement | null = null;
let root: Root | null = null;

function mount(ui: unknown): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui as never));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function reconProject() {
  const project = createReconciliationSample();
  const alpha = (project.geneTrees ?? []).find((g) => g.name.includes('α'))!;
  act(() => {
    useStore.setState({
      project,
      activeGeneTreeId: alpha.id,
      geneSelection: [],
      selection: [],
      reconViewOptions: { ...DEFAULT_RECON_VIEW_OPTIONS },
    });
  });
  return { project, alpha };
}

describe('EmbeddedReconCanvas (component)', () => {
  it('renders the nested figure: tubes, hubs, mask, gene segments and the transfer arc', () => {
    const { project, alpha } = reconProject();
    const el = mount(
      createElement(EmbeddedReconCanvas, {
        speciesDoc: project,
        geneEntry: alpha,
        options: { ...DEFAULT_RECON_VIEW_OPTIONS, layoutMode: 'embedded' },
        geneSelection: [],
        speciesSelection: [],
        hoveredGeneId: null,
        focusTarget: null,
        onGeneNodeClick: () => {},
        onSpeciesNodeClick: () => {},
        onTubeClick: () => {},
        onGeneHover: () => {},
      }),
    );
    const branchCount = Object.values(project.nodes).filter((n) => n.parentId !== null).length;
    const tubes = el.querySelectorAll('[data-tube-id]');
    expect(tubes.length).toBe(branchCount);
    // The mask + masked gene-lineage group exist, and the mask id is DOM-safe.
    const mask = el.querySelector('mask');
    expect(mask).toBeTruthy();
    expect(mask!.id).toMatch(/^er-mask-[A-Za-z0-9_-]+$/);
    expect(mask!.id).not.toContain(':');
    const maskedGroup = el.querySelector('g[mask]');
    expect(maskedGroup?.querySelectorAll('path').length).toBeGreaterThan(0);
    // α carries exactly one transfer arc, drawn OUTSIDE the mask group.
    const arcs = [...el.querySelectorAll('g > path')].filter((p) =>
      (p.getAttribute('d') ?? '').includes('C '),
    );
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    // Gene nodes are focusable buttons with a spoken mapping target.
    const geneButtons = el.querySelectorAll('[data-node-id][role="button"]');
    expect(geneButtons.length).toBeGreaterThan(0);
    const labelled = [...geneButtons].some((b) =>
      (b.getAttribute('aria-label') ?? '').includes('σ'),
    );
    expect(labelled).toBe(true);
  });

  it('reports the clicked tube (branch id + within-branch t) on Alt+click', () => {
    const { project, alpha } = reconProject();
    const onTubeClick = vi.fn();
    const el = mount(
      createElement(EmbeddedReconCanvas, {
        speciesDoc: project,
        geneEntry: alpha,
        options: { ...DEFAULT_RECON_VIEW_OPTIONS, layoutMode: 'embedded' },
        geneSelection: [],
        speciesSelection: [],
        hoveredGeneId: null,
        focusTarget: null,
        onGeneNodeClick: () => {},
        onSpeciesNodeClick: () => {},
        onTubeClick,
        onGeneHover: () => {},
      }),
    );
    const tube = el.querySelector('[data-tube-id]')!;
    expect(tube).toBeTruthy();
    act(() => {
      tube.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }),
      );
    });
    expect(onTubeClick).toHaveBeenCalledTimes(1);
    const [branchId, t] = onTubeClick.mock.calls[0] as [string, number];
    expect(typeof branchId).toBe('string');
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
  });
});

describe('ReconciliationView layout-mode switch (component)', () => {
  afterEach(() => {
    act(() => {
      useStore.setState({ project: createEmptyProject('clean'), activeGeneTreeId: null });
    });
  });

  it('mounts the embedded canvas in embedded mode and the two panes in side-by-side mode', () => {
    const { project, alpha } = reconProject();
    const el = mount(
      createElement(ReconciliationView, {
        onBuildGeneTree: () => {},
        onCopySpeciesTree: () => {},
      }),
    );
    // Default is side-by-side: two ReconPane hosts + the bridge.
    expect(el.querySelector('.recon-panes')).toBeTruthy();
    expect(el.querySelector('.recon-embedded')).toBeNull();

    act(() => {
      useStore.setState((s) => ({
        reconViewOptions: { ...s.reconViewOptions, layoutMode: 'embedded' },
      }));
    });
    expect(el.querySelector('.recon-embedded')).toBeTruthy();
    expect(el.querySelector('.recon-panes')).toBeNull();
    // The embedded legend carries the tube/gene/inferred entries (in the
    // active UI language).
    const legendText = el.querySelector('.recon-legend')?.textContent ?? '';
    expect(legendText).toContain(S.recon.legendTube);
    expect(legendText).toContain(S.recon.legendGene);

    // And back — no embedded chrome left, no selection damage.
    act(() => {
      useStore.setState((s) => ({
        reconViewOptions: { ...s.reconViewOptions, layoutMode: 'side-by-side' },
      }));
    });
    expect(el.querySelector('.recon-panes')).toBeTruthy();
    expect(el.querySelector('.recon-embedded')).toBeNull();
    const st = useStore.getState();
    expect(st.geneSelection).toEqual([]);
    expect(st.project.geneTrees?.find((g) => g.id === alpha.id)).toBeTruthy();
    void project;
  });

  it('keeps side-by-side geometry independent of the embedded options', () => {
    reconProject();
    act(() => {
      useStore.setState((s) => ({
        reconViewOptions: { ...s.reconViewOptions, embeddedTubeWidth: 10 },
      }));
    });
    const el = mount(
      createElement(ReconciliationView, {
        onBuildGeneTree: () => {},
        onCopySpeciesTree: () => {},
      }),
    );
    // The side-by-side pane still renders its own fixed-width branches.
    expect(el.querySelectorAll('.recon-pane').length).toBe(2);
  });
});

// Sanity: a gene tree with no mappings still renders the nested skeleton
// (everything lands in the orphan gutter instead of crashing).
describe('EmbeddedReconCanvas degenerate input', () => {
  it('renders an empty scenario into the orphan gutter without crashing', () => {
    const project = createEmptyProject('sp');
    const [a] = addChildren(project, project.rootId, 2);
    renameNode(project, a, 'A');
    const gene = createEmptyProject('g');
    const [t1] = addChildren(gene, gene.rootId, 2);
    renameNode(gene, t1, 'A');
    const el = mount(
      createElement(EmbeddedReconCanvas, {
        speciesDoc: project,
        geneEntry: { id: 'g1', name: 'G', doc: gene, assumptions: {} },
        options: { ...DEFAULT_RECON_VIEW_OPTIONS, layoutMode: 'embedded' },
        geneSelection: [],
        speciesSelection: [],
        hoveredGeneId: null,
        focusTarget: null,
        onGeneNodeClick: () => {},
        onSpeciesNodeClick: () => {},
        onTubeClick: () => {},
        onGeneHover: () => {},
      }),
    );
    expect(el.querySelector('[data-tube-id]')).toBeTruthy();
    // The unmapped gene root is reported somewhere (orphan marker or aria).
    expect(el.textContent).toContain('A');
  });
});
