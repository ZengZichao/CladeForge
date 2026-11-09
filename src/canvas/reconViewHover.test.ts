// @vitest-environment jsdom
// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
/**
 * End-to-end hover path of the reconciliation canvas after the 2026-11-08
 * performance split: pointerenter → store.reconHoverGeneId → world-space
 * anchors → per-line projection → exactly ONE emphasised bridge line (and the
 * rest muted). Also pins that a hover re-render reuses the untouched rows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReconciliationView } from './ReconciliationView';
import { useStore } from '../model/store';
import { parseNewick } from '../io/newick';
import { makeGeneTreeEntry } from '../model/geneTrees';
import { mapTipsByLabel, suggestLcaScenario } from '../model/reconciliation';
import type { Project } from '../model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// jsdom has no layout engine: give every element the pane host's real
// dimensions so the ResizeObserver-driven measurement sees a usable box.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 800,
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: () => 600,
});

let host: HTMLElement | null = null;
let root: Root | null = null;

function cleanup(): void {
  const mounted = root;
  const box = host;
  root = null;
  host = null;
  if (mounted) act(() => mounted.unmount());
  box?.remove();
}

/** A species tree with a mapped gene tree (label-matched tips). */
function reconciledProject(): { project: Project; geneId: string; tipId: string } {
  const species = parseNewick('((A,B),(C,D));', 'species');
  const geneDoc = parseNewick('((A,B),(C,D));', 'gene');
  const entry = makeGeneTreeEntry(geneDoc, 'g1');
  entry.assumptions = suggestLcaScenario(
    species,
    geneDoc,
    mapTipsByLabel(species, geneDoc).mappings,
    entry.assumptions,
  );
  species.geneTrees = [entry];
  const tip = Object.values(geneDoc.nodes).find((n) => n.childrenIds.length === 0)!;
  return { project: species, geneId: entry.id, tipId: tip.id };
}

function mount(): { box: HTMLElement; tipId: string } {
  cleanup();
  const { project, geneId, tipId } = reconciledProject();
  act(() => {
    useStore.getState().loadProject(project);
    useStore.getState().setActiveGeneTree(geneId);
    useStore.getState().setReconHoverGene(null);
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(ReconciliationView, {
        onBuildGeneTree: () => {},
        onCopySpeciesTree: () => {},
      }),
    ),
  );
  return { box: host, tipId };
}

/** React derives pointerenter/leave from delegated pointerover/pointerout. */
function hover(target: EventTarget, type: 'pointerover' | 'pointerout'): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget: document.body }),
    );
  });
}

const bridgePaths = (box: HTMLElement) => [...box.querySelectorAll('.recon-bridge-layer path')];

beforeEach(() => {
  useStore.getState().setReconMode(false);
});
afterEach(cleanup);

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe('reconciliation canvas hover integration', () => {
  it('emphasises exactly the hovered node\'s bridge line and mutes the rest', async () => {
    const { box, tipId } = mount();
    await flushFrame(); // let the first-paint Fit settle
    const genePane = box.querySelector('.recon-pane--gene');
    expect(genePane).not.toBeNull();
    const lines = bridgePaths(box);
    // Label-matched tips are the default (tips-only) scope: four bridge lines.
    expect(lines.length).toBe(4);
    expect(lines.filter((l) => l.classList.contains('recon-map-muted')).length).toBe(0);

    const tipRow = genePane!.querySelector(`[data-node-id="${tipId}"]`);
    expect(tipRow).not.toBeNull();
    const others = [...genePane!.querySelectorAll('[data-node-id]')].filter(
      (el) => el.getAttribute('data-node-id') !== tipId,
    );

    hover(tipRow!, 'pointerover');
    expect(useStore.getState().reconHoverGeneId).toBe(tipId);
    const after = bridgePaths(box);
    expect(after.filter((l) => l.classList.contains('recon-map-hovered')).length).toBe(1);
    expect(after.filter((l) => l.classList.contains('recon-map-muted')).length).toBe(3);
    // The untouched node rows are the same DOM nodes: the memoised rows bailed.
    expect(genePane!.querySelector(`[data-node-id="${tipId}"]`)).toBe(tipRow);
    for (const el of others) {
      expect(genePane!.querySelector(`[data-node-id="${el.getAttribute('data-node-id')}"]`)).toBe(el);
    }

    hover(tipRow!, 'pointerout');
    expect(useStore.getState().reconHoverGeneId).toBeNull();
    const reset = bridgePaths(box);
    expect(reset.filter((l) => l.classList.contains('recon-map-hovered')).length).toBe(0);
    expect(reset.filter((l) => l.classList.contains('recon-map-muted')).length).toBe(0);
  });
});
