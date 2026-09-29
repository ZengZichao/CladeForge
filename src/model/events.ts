// Evolutionary-event catalogue + pure helpers.
//
// Events annotate WHAT happened on a node or branch (speciation mode,
// extinction, key innovation, adaptive radiation, bottleneck, gene flow …) and
// optionally form a causal chain ("key innovation → adaptive radiation"). Each
// event may carry a confidence level and supporting / opposing evidence.
// Nothing here is inferred — events are asserted by the user.

import type { EvolutionaryEvent, EventId, NodeId, Project } from './types';
import { newId } from './treeOps';
import { tr } from '../ui/strings';

/**
 * How an event type is marked on a badge: a two-letter uppercase ASCII **code**
 * derived from the English type name, drawn inside a colour-ringed badge.
 *
 * Events are marked with a code rather than a pictographic glyph. Emoji are out
 * of the question for a figure-generating app: they render through an emoji font
 * the export pipeline does not embed, so a badge would come out in colour on
 * screen and as a missing-glyph box in SVG/PDF; they differ across
 * platforms; and they cannot be read aloud or grepped. Two letters are plain
 * text everywhere — canvas, legend, export and Markdown — stay identical on
 * every platform, and survive greyscale printing. The colour ring still carries
 * the group, and the full localised name sits beside the badge in the legend,
 * the inspector and the tooltip.
 */
export interface EventTypeDef {
  id: string;
  label: string;
  /** English label — picked at display time when the UI language is EN. */
  labelEn: string;
  group: string;
  groupEn: string;
  /** Two-letter code shown inside the badge (see the note above). */
  code: string;
  color: string;
  /** Where this event most naturally attaches (drives the default target). */
  target: 'node' | 'branch' | 'both';
}

/** Badge geometry shared by the canvas layer and the SVG exporter. */
export const EVENT_BADGE_RADIUS = 8;
/** Two uppercase letters need a smaller size than a single pictograph did. */
export const EVENT_CODE_FONT_SIZE = 7.5;

export const EVENT_TYPES: EventTypeDef[] = [
  // 物种形成
  { id: 'speciation-allopatric', label: '异域成种', labelEn: 'Allopatric speciation', group: '物种形成', groupEn: 'Speciation', code: 'AL', color: '#0e9f6e', target: 'node' },
  { id: 'speciation-sympatric', label: '同域成种', labelEn: 'Sympatric speciation', group: '物种形成', groupEn: 'Speciation', code: 'SY', color: '#0ea5a3', target: 'node' },
  { id: 'speciation-parapatric', label: '邻域成种', labelEn: 'Parapatric speciation', group: '物种形成', groupEn: 'Speciation', code: 'PA', color: '#14b8a6', target: 'node' },
  { id: 'speciation-polyploidy', label: '多倍化成种', labelEn: 'Polyploid speciation', group: '物种形成', groupEn: 'Speciation', code: 'PO', color: '#22c55e', target: 'node' },
  // 灭绝
  { id: 'extinction-local', label: '本地灭绝', labelEn: 'Local extinction', group: '灭绝', groupEn: 'Extinction', code: 'LX', color: '#ef4444', target: 'both' },
  { id: 'extinction-mass', label: '大规模灭绝', labelEn: 'Mass extinction', group: '灭绝', groupEn: 'Extinction', code: 'MX', color: '#b91c1c', target: 'node' },
  // 关键演化
  { id: 'key-innovation', label: '关键创新', labelEn: 'Key innovation', group: '关键演化', groupEn: 'Key evolution', code: 'KI', color: '#8b5cf6', target: 'branch' },
  { id: 'adaptive-radiation', label: '适应辐射', labelEn: 'Adaptive radiation', group: '关键演化', groupEn: 'Key evolution', code: 'AR', color: '#f59e0b', target: 'node' },
  { id: 'bottleneck', label: '瓶颈效应', labelEn: 'Bottleneck', group: '关键演化', groupEn: 'Key evolution', code: 'BN', color: '#6366f1', target: 'branch' },
  // 基因流
  { id: 'hgt', label: '水平基因转移', labelEn: 'Horizontal gene transfer', group: '基因流', groupEn: 'Gene flow', code: 'HG', color: '#ec4899', target: 'both' },
  { id: 'hybridization', label: '杂交', labelEn: 'Hybridization', group: '基因流', groupEn: 'Gene flow', code: 'HY', color: '#d946ef', target: 'node' },
  // 生物地理
  { id: 'biogeo-dispersal', label: '扩散', labelEn: 'Dispersal', group: '生物地理', groupEn: 'Biogeography', code: 'DI', color: '#0284c7', target: 'branch' },
  { id: 'biogeo-vicariance', label: '隔离分化', labelEn: 'Vicariance', group: '生物地理', groupEn: 'Biogeography', code: 'VI', color: '#0d9488', target: 'node' },
  { id: 'biogeo-extirpation', label: '区域灭绝', labelEn: 'Regional extirpation', group: '生物地理', groupEn: 'Biogeography', code: 'RE', color: '#dc2626', target: 'branch' },
  // 通用
  { id: 'custom', label: '自定义事件', labelEn: 'Custom event', group: '通用', groupEn: 'General', code: 'CU', color: '#787774', target: 'both' },
];

const EVENT_TYPE_MAP = new Map(EVENT_TYPES.map((t) => [t.id, t]));

export function findEventType(typeId: string): EventTypeDef | undefined {
  return EVENT_TYPE_MAP.get(typeId);
}

export function eventColor(event: EvolutionaryEvent): string {
  return findEventType(event.typeId)?.color ?? '#787774';
}

/** The code drawn inside an event badge; '?' for a type the catalogue lacks. */
export function eventCode(event: EvolutionaryEvent): string {
  return findEventType(event.typeId)?.code ?? '?';
}

export function eventTypeLabel(t: EventTypeDef): string {
  return tr(t.label, t.labelEn);
}

export function eventTypeGroup(t: EventTypeDef): string {
  return tr(t.group, t.groupEn);
}

export function eventDisplayLabel(event: EvolutionaryEvent): string {
  const t = findEventType(event.typeId);
  return event.label || (t ? eventTypeLabel(t) : tr('事件', 'Event'));
}

export function newEvent(typeId: string, target: 'node' | 'branch', nodeId: NodeId): EvolutionaryEvent {
  return { id: newId(), typeId, target, nodeId, triggers: [] };
}

/** All events attached to a node (whether on the node itself or its branch). */
export function eventsForNode(project: Project, nodeId: NodeId): EvolutionaryEvent[] {
  return project.events.filter((e) => e.nodeId === nodeId);
}

export interface CausalPair {
  from: EvolutionaryEvent;
  to: EvolutionaryEvent;
}

/** Resolve every trigger link to an existing (cause → effect) event pair. */
export function causalPairs(project: Project): CausalPair[] {
  const byId = new Map<EventId, EvolutionaryEvent>(project.events.map((e) => [e.id, e]));
  const out: CausalPair[] = [];
  for (const from of project.events) {
    for (const targetId of from.triggers) {
      const to = byId.get(targetId);
      if (to) out.push({ from, to });
    }
  }
  return out;
}

/**
 * Find a causal cycle — a chain of trigger links that returns to its own event
 * (A → B → A, or a longer loop, or a self-loop).
 *
 * The interactive editor cannot create one (`treeOps.toggleEventTrigger` checks
 * reachability before adding a link), but the causal chain is presented as a DAG,
 * and a DAG property must be verified rather than assumed: files edited by hand,
 * imported from another tool, or merged from another
 * project can carry a loop, which would make every "what caused what" traversal
 * run forever. Returns the cycle as the list of event ids along it (last id
 * repeats the first), or null when the graph is acyclic.
 */
export function findEventCycle(events: EvolutionaryEvent[]): EventId[] | null {
  const byId = new Map<EventId, EvolutionaryEvent>(events.map((e) => [e.id, e]));
  const done = new Set<EventId>();
  for (const start of events) {
    if (done.has(start.id)) continue;
    // Iterative depth-first search with an explicit "on current path" set, so a
    // back edge is caught the moment it appears.
    const path: EventId[] = [start.id];
    const onPath = new Set<EventId>([start.id]);
    const frames: { id: EventId; i: number }[] = [{ id: start.id, i: 0 }];
    while (frames.length) {
      const top = frames[frames.length - 1];
      const triggers = byId.get(top.id)?.triggers ?? [];
      if (top.i >= triggers.length) {
        frames.pop();
        path.pop();
        onPath.delete(top.id);
        done.add(top.id);
        continue;
      }
      // Take the link AT the cursor, then advance. Reading the slot AFTER the
      // increment (`triggers[top.i += 1]`) would skip the FIRST trigger of every
      // event — self-loops, A⇄B pairs and any longer cycle whose closing edge
      // sits at index 0 would all go undetected, and `validateProject` would
      // never cut a loop.
      const next = triggers[top.i];
      top.i += 1;
      if (next === top.id) return [top.id, top.id]; // self-loop
      if (!byId.has(next)) continue; // dangling reference: not a cycle
      if (onPath.has(next)) {
        const at = path.indexOf(next);
        return path.slice(at).concat(next);
      }
      if (done.has(next)) continue; // proven acyclic already
      frames.push({ id: next, i: 0 });
      path.push(next);
      onPath.add(next);
    }
  }
  return null;
}

/** True when the trigger graph of `project.events` contains a cycle. */
export function hasEventCycle(project: Project): boolean {
  return findEventCycle(project.events) !== null;
}
