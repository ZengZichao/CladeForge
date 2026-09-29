// Hypothesis layers — alternative ancestral-state hypotheses over one topology.
//
// A layer is a named alternative overlay on the SHARED topology. Only the
// *hypothesis* data is layered — internal-node ancestral states, their
// confidence/evidence, and the event set. Tip (observed) states and everything
// structural stay shared across layers.
//
// The active layer's data lives directly on the nodes / project.events (so all
// rendering and editing code is oblivious to layering). Non-active layers are
// kept as snapshots in `project.layerStore`. Switching saves the current live
// hypotheses into the outgoing layer's slot and loads the incoming one.

import { tr } from '../ui/strings';
import type {
  EvolutionaryEvent,
  HypothesisLayer,
  HypothesisMeta,
  Project,
  StoredLayer,
} from './types';
import { newId } from './treeOps';

/** Initial single-layer set for a fresh project. */
export function defaultLayers(): Pick<Project, 'layers' | 'activeLayerId' | 'layerStore'> {
  const id = newId();
  return { layers: [{ id, name: tr('假说 1', 'Hypothesis 1') }], activeLayerId: id, layerStore: {} };
}

function copyMeta(m: Record<string, HypothesisMeta>): Record<string, HypothesisMeta> {
  const out: Record<string, HypothesisMeta> = {};
  for (const [k, v] of Object.entries(m)) out[k] = { ...v };
  return out;
}

function copyEvents(events: EvolutionaryEvent[]): EvolutionaryEvent[] {
  return events.map((e) => ({ ...e, triggers: [...e.triggers] }));
}

/** Snapshot the current live hypotheses (internal-node states/meta + events). */
export function captureLayer(project: Project): StoredLayer {
  const states: StoredLayer['states'] = {};
  const meta: StoredLayer['meta'] = {};
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length === 0) continue; // internal nodes only
    if (n.charStates && Object.keys(n.charStates).length) states[n.id] = { ...n.charStates };
    if (n.charMeta && Object.keys(n.charMeta).length) meta[n.id] = copyMeta(n.charMeta);
  }
  return { states, meta, events: copyEvents(project.events) };
}

/** Replace the live internal-node hypotheses + events with a stored snapshot. */
export function applyLayer(project: Project, stored: StoredLayer): void {
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length === 0) continue; // keep tips (shared observations)
    if (n.charStates) delete n.charStates;
    if (n.charMeta) delete n.charMeta;
  }
  for (const [nid, cs] of Object.entries(stored.states)) {
    const n = project.nodes[nid];
    if (n && n.childrenIds.length > 0) n.charStates = { ...cs };
  }
  for (const [nid, m] of Object.entries(stored.meta)) {
    const n = project.nodes[nid];
    if (n && n.childrenIds.length > 0) n.charMeta = copyMeta(m);
  }
  project.events = copyEvents(stored.events);
}

/** Switch the active layer, saving the current one and loading the target. */
export function switchLayer(project: Project, targetId: string): void {
  if (targetId === project.activeLayerId) return;
  if (!project.layers.some((l) => l.id === targetId)) return;
  project.layerStore[project.activeLayerId] = captureLayer(project);
  applyLayer(project, project.layerStore[targetId] ?? { states: {}, meta: {}, events: [] });
  // The target now owns the live data, so drop its (now redundant) snapshot.
  delete project.layerStore[targetId];
  project.activeLayerId = targetId;
}

/** Add a blank hypothesis layer (empty internal states + no events). Returns its id. */
export function addBlankLayer(project: Project, name: string): string {
  const id = newId();
  project.layers.push({ id, name });
  project.layerStore[id] = { states: {}, meta: {}, events: [] };
  return id;
}

/** Add a layer that duplicates the current live hypotheses. Returns its id. */
export function duplicateActiveLayer(project: Project, name: string): string {
  const id = newId();
  project.layers.push({ id, name });
  project.layerStore[id] = captureLayer(project);
  return id;
}

export function renameLayer(project: Project, id: string, name: string): void {
  const l = project.layers.find((x) => x.id === id);
  if (l) l.name = name;
}

/** Remove a layer (never the last one); if it is active, switch away first. */
export function removeLayer(project: Project, id: string): void {
  if (project.layers.length <= 1) return;
  if (project.activeLayerId === id) {
    const other = project.layers.find((l) => l.id !== id);
    if (other) switchLayer(project, other.id);
  }
  project.layers = project.layers.filter((l) => l.id !== id);
  delete project.layerStore[id];
}

/**
 * Drop stored layer data that can no longer be applied: records on nodes that no
 * longer exist, events on such nodes, causal links to dropped events — and
 * assignments / evidence for characters that have been deleted. An orphan
 * character key in `layerStore` stays invisible until the user switches layers,
 * when it comes back long after the trait itself is gone.
 */
export function pruneLayerStore(project: Project): boolean {
  let changed = false;
  const characterIds = new Set(project.characters.map((c) => c.id));
  for (const stored of Object.values(project.layerStore)) {
    for (const nid of Object.keys(stored.states)) {
      if (!project.nodes[nid]) {
        delete stored.states[nid];
        changed = true;
      }
    }
    for (const nid of Object.keys(stored.meta)) {
      if (!project.nodes[nid]) {
        delete stored.meta[nid];
        changed = true;
      }
    }
    for (const bucket of [stored.states, stored.meta] as const) {
      for (const nid of Object.keys(bucket)) {
        const rec = bucket[nid] as Record<string, unknown>;
        for (const cid of Object.keys(rec)) {
          if (!characterIds.has(cid)) {
            delete rec[cid];
            changed = true;
          }
        }
        if (Object.keys(rec).length === 0) delete bucket[nid];
      }
    }
    const validEvents = stored.events.filter((e) => project.nodes[e.nodeId]);
    if (validEvents.length !== stored.events.length) {
      stored.events = validEvents;
      changed = true;
    }
    const ids = new Set(stored.events.map((e) => e.id));
    for (const e of stored.events) {
      const clean = (Array.isArray(e.triggers) ? e.triggers : []).filter(
        (t) => t !== e.id && ids.has(t),
      );
      if (!Array.isArray(e.triggers) || clean.length !== e.triggers.length) {
        e.triggers = clean;
        changed = true;
      }
    }
  }
  return changed;
}
