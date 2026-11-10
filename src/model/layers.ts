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
  HypothesisMeta,
  NodeId,
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

/** Snapshot the current live hypotheses (internal-node states/meta + notes + events). */
export function captureLayer(project: Project): StoredLayer {
  const states: StoredLayer['states'] = {};
  const meta: StoredLayer['meta'] = {};
  const notes: Record<string, string> = {};
  for (const n of Object.values(project.nodes)) {
    if (n.hypothesisNote?.trim()) notes[n.id] = n.hypothesisNote;
    if (n.childrenIds.length === 0) continue; // internal-node state hypotheses only
    if (n.charStates && Object.keys(n.charStates).length) states[n.id] = { ...n.charStates };
    if (n.charMeta && Object.keys(n.charMeta).length) meta[n.id] = copyMeta(n.charMeta);
  }
  return { states, meta, notes, events: copyEvents(project.events) };
}

/** Replace the live internal-node hypotheses + notes + events with a stored snapshot. */
export function applyLayer(project: Project, stored: StoredLayer): void {
  for (const n of Object.values(project.nodes)) {
    delete n.hypothesisNote;
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
  for (const [nid, note] of Object.entries(stored.notes ?? {})) {
    const n = project.nodes[nid];
    if (n && note.trim()) n.hypothesisNote = note;
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
  project.layerStore[id] = { states: {}, meta: {}, notes: {}, events: [] };
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
 *
 * Nothing is dropped silently any more: the returned summary names how many
 * records of each kind were removed, and callers must surface it (the loader
 * folds the counts into the load report; see io/projectIO.ts).
 */
export interface LayerPruneSummary {
  /** State assignments removed. */
  states: number;
  /** Confidence/evidence records removed. */
  meta: number;
  /** Hypothesis notes removed. */
  notes: number;
  /** Stored events removed. */
  events: number;
  /** True when anything at all was pruned. */
  changed: boolean;
}

export function pruneLayerStore(project: Project): LayerPruneSummary {
  const summary: LayerPruneSummary = { states: 0, meta: 0, notes: 0, events: 0, changed: false };
  const characterIds = new Set(project.characters.map((c) => c.id));
  for (const stored of Object.values(project.layerStore)) {
    for (const nid of Object.keys(stored.states)) {
      if (!project.nodes[nid]) {
        delete stored.states[nid];
        summary.states += 1;
      }
    }
    for (const nid of Object.keys(stored.meta)) {
      if (!project.nodes[nid]) {
        delete stored.meta[nid];
        summary.meta += 1;
      }
    }
    for (const bucket of [stored.states, stored.meta] as const) {
      for (const nid of Object.keys(bucket)) {
        const rec = bucket[nid] as Record<string, unknown>;
        for (const cid of Object.keys(rec)) {
          if (!characterIds.has(cid)) {
            delete rec[cid];
            if (bucket === stored.states) summary.states += 1;
            else summary.meta += 1;
          }
        }
        if (Object.keys(rec).length === 0) delete bucket[nid];
      }
    }
    if (stored.notes) {
      for (const nid of Object.keys(stored.notes)) {
        if (!project.nodes[nid]) {
          delete stored.notes[nid];
          summary.notes += 1;
        }
      }
    }
    const validEvents = stored.events.filter((e) => project.nodes[e.nodeId]);
    if (validEvents.length !== stored.events.length) {
      summary.events += stored.events.length - validEvents.length;
      stored.events = validEvents;
    }
    const ids = new Set(stored.events.map((e) => e.id));
    for (const e of stored.events) {
      const clean = (Array.isArray(e.triggers) ? e.triggers : []).filter(
        (t) => t !== e.id && ids.has(t),
      );
      if (!Array.isArray(e.triggers) || clean.length !== e.triggers.length) {
        e.triggers = clean;
      }
    }
  }
  summary.changed = summary.states + summary.meta + summary.notes + summary.events > 0;
  return summary;
}

// --- per-layer statistics and cross-layer comparison --------------------------
// "Compare competing hypotheses" is the product's core claim, so the numbers a
// comparison needs (record counts, parsimony cost of a layer) and the node-level
// diff between two layers live here, computed from data that already exists.

export interface LayerRecordCounts {
  /** Internal nodes carrying ancestral-state hypotheses. */
  states: number;
  /** Internal nodes carrying confidence/evidence. */
  meta: number;
  /** Nodes carrying a hypothesis note. */
  notes: number;
  /** Events owned by the layer. */
  events: number;
}

/**
 * Record counts for one layer. The ACTIVE layer's data lives on the nodes /
 * project.events; every other layer reads its snapshot from `layerStore`.
 */
export function layerRecordCounts(project: Project, layerId: string): LayerRecordCounts {
  if (layerId === project.activeLayerId) {
    let states = 0;
    let meta = 0;
    let notes = 0;
    for (const n of Object.values(project.nodes)) {
      if (n.childrenIds.length === 0) continue;
      if (n.charStates && Object.keys(n.charStates).length) states += 1;
      if (n.charMeta && Object.keys(n.charMeta).length) meta += 1;
      if (n.hypothesisNote?.trim()) notes += 1;
    }
    return { states, meta, notes, events: project.events.length };
  }
  const stored = project.layerStore[layerId];
  if (!stored) return { states: 0, meta: 0, notes: 0, events: 0 };
  return {
    states: Object.keys(stored.states).length,
    meta: Object.keys(stored.meta).length,
    notes: Object.keys(stored.notes ?? {}).length,
    events: stored.events.length,
  };
}

/** One node where the two layers disagree. */
export interface LayerDiffEntry {
  nodeId: NodeId;
  characterId: string;
  /** The character's display name, resolved for the report. */
  characterName: string;
  /** Layer A's assignment, display-formatted (polymorphic sets joined with '/'). */
  a?: string;
  /** Layer B's assignment. */
  b?: string;
}

/** Result of comparing two hypothesis layers. */
export interface LayerDiff {
  aId: string;
  bId: string;
  /** Nodes whose ancestral-state assignment differs, sorted by node id. */
  stateDiffs: LayerDiffEntry[];
  /** Events present only in layer A / only in layer B. */
  eventsOnlyA: EvolutionaryEvent[];
  eventsOnlyB: EvolutionaryEvent[];
}

/** Format one assignment for a diff table cell. */
function formatAssignment(v: string | number | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.join('/');
  return String(v);
}

/**
 * Compare two layers' ancestral states and event sets without mutating the
 * document: the active layer is read from the live nodes, the other from its
 * snapshot. Only nodes present in BOTH layers' topologies are compared — a node
 * that exists only on one side is a topology edit the layer predates.
 */
export function layerDiff(project: Project, aId: string, bId: string): LayerDiff {
  const readStates = (layerId: string): Record<string, Record<string, string | number | string[]>> => {
    if (layerId === project.activeLayerId) {
      const out: Record<string, Record<string, string | number | string[]>> = {};
      for (const n of Object.values(project.nodes)) {
        if (n.childrenIds.length === 0) continue;
        if (n.charStates && Object.keys(n.charStates).length) out[n.id] = { ...n.charStates };
      }
      return out;
    }
    return project.layerStore[layerId]?.states ?? {};
  };
  const readEvents = (layerId: string): EvolutionaryEvent[] =>
    layerId === project.activeLayerId
      ? project.events
      : (project.layerStore[layerId]?.events ?? []);

  const aStates = readStates(aId);
  const bStates = readStates(bId);
  const characterName = new Map(project.characters.map((c) => [c.id, c.name]));
  const stateDiffs: LayerDiffEntry[] = [];
  const nodeIds = new Set([...Object.keys(aStates), ...Object.keys(bStates)]);
  for (const nid of nodeIds) {
    if (!project.nodes[nid]) continue;
    const recA = aStates[nid] ?? {};
    const recB = bStates[nid] ?? {};
    const cids = new Set([...Object.keys(recA), ...Object.keys(recB)]);
    for (const cid of cids) {
      const va = recA[cid];
      const vb = recB[cid];
      if (JSON.stringify(va) === JSON.stringify(vb)) continue;
      stateDiffs.push({
        nodeId: nid,
        characterId: cid,
        characterName: characterName.get(cid) ?? cid,
        a: formatAssignment(va),
        b: formatAssignment(vb),
      });
    }
  }
  stateDiffs.sort((x, y) => x.nodeId.localeCompare(y.nodeId) || x.characterId.localeCompare(y.characterId));

  const keyOf = (e: EvolutionaryEvent): string => `${e.typeId}|${e.nodeId}|${e.target}|${e.label ?? ''}`;
  const aKeys = new Set(readEvents(aId).map(keyOf));
  const bKeys = new Set(readEvents(bId).map(keyOf));
  const eventsOnlyA = readEvents(aId).filter((e) => !bKeys.has(keyOf(e)));
  const eventsOnlyB = readEvents(bId).filter((e) => !aKeys.has(keyOf(e)));
  return { aId, bId, stateDiffs, eventsOnlyA, eventsOnlyB };
}
