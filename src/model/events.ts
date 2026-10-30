// Evolutionary-event catalogue + pure helpers.
//
// Events annotate WHAT happened on a node or branch (speciation mode,
// extinction, key innovation, adaptive radiation, bottleneck, gene flow …) and
// optionally form a causal chain ("key innovation → adaptive radiation"). Each
// event may carry a confidence level and supporting / opposing evidence.
// Nothing here is inferred — events are asserted by the user.

import type { EventMarkerShape, EvolutionaryEvent, EventId, NodeId, Project } from './types';
import { newId } from './treeOps';
import { tr } from '../ui/strings';

/**
 * How an event type is identified: a two-letter uppercase ASCII **code**
 * derived from the English type name. The code is the default text a badge can
 * show, but badges draw NO letters unless the user explicitly turns text on —
 * shape and colour identify the event on the tree. This keeps figures clean
 * and avoids every evolutionary event turning into an acronym.
 *
 * When text IS requested, it is plain text rather than a pictographic glyph.
 * Emoji are out of the question for a figure-generating app: they render
 * through an emoji font the export pipeline does not embed, so a badge would
 * come out in colour on screen and as a missing-glyph box in SVG/PDF; they
 * differ across platforms; and they cannot be read aloud or grepped. The
 * colour ring still carries the group, and the full localised name sits beside
 * the badge in the legend, the inspector and the tooltip.
 */
export interface EventTypeDef {
  id: string;
  label: string;
  /** English label — picked at display time when the UI language is EN. */
  labelEn: string;
  group: string;
  groupEn: string;
  /** Two-letter code used as the badge's default text when text is shown. */
  code: string;
  color: string;
  /** Where this event most naturally attaches (drives the default target). */
  target: 'node' | 'branch' | 'both';
}

/** Badge geometry shared by the canvas layer and the SVG exporter. */
export const EVENT_BADGE_RADIUS = 8;
/** Two uppercase letters need a smaller size than a single pictograph did. */
export const EVENT_CODE_FONT_SIZE = 7.5;
/** Longest inner badge text kept on use; the badge is a marker, not a label. */
export const EVENT_BADGE_TEXT_MAX = 4;

/**
 * Badge shapes the event editor offers, with display labels. `circle` is the
 * default (the historical look); the rest exist so neighbouring events stay
 * distinguishable — including in greyscale print, where shape outlives colour.
 */
export const EVENT_MARKER_SHAPES: { id: EventMarkerShape; label: string; labelEn: string }[] = [
  { id: 'circle', label: '圆形', labelEn: 'Circle' },
  { id: 'square', label: '方形', labelEn: 'Square' },
  { id: 'diamond', label: '菱形', labelEn: 'Diamond' },
  { id: 'triangle', label: '三角形', labelEn: 'Triangle' },
  { id: 'star', label: '星形', labelEn: 'Star' },
  { id: 'hexagon', label: '六边形', labelEn: 'Hexagon' },
];

/** Bounds of the per-event size override; the editor clamps to the same range. */
export const EVENT_MARKER_SIZE_MIN = 5;
export const EVENT_MARKER_SIZE_MAX = 24;

/** Clamp a user-entered badge size into the usable range. */
export function clampEventMarkerSize(size: number): number {
  if (!Number.isFinite(size)) return EVENT_BADGE_RADIUS;
  return Math.min(EVENT_MARKER_SIZE_MAX, Math.max(EVENT_MARKER_SIZE_MIN, size));
}

/** The badge outline shape; an absent/unknown override falls back to a circle. */
export function eventMarkerShape(event: EvolutionaryEvent): EventMarkerShape {
  return EVENT_MARKER_SHAPES.some((s) => s.id === event.markerShape)
    ? (event.markerShape as EventMarkerShape)
    : 'circle';
}

/** The badge radius, with the size override clamped on use. */
export function eventMarkerSize(event: EvolutionaryEvent): number {
  return event.markerSize === undefined ? EVENT_BADGE_RADIUS : clampEventMarkerSize(event.markerSize);
}

/** The badge outline colour: the per-event override, else the type colour. */
export function eventMarkerColor(event: EvolutionaryEvent): string {
  return event.markerColor || eventColor(event);
}

/**
 * Whether the badge draws inner text. Markers are text-free by default: the
 * event is carried by the ring colour and the shape, so a figure does not
 * become a field of two-letter acronyms. The user opts in per event; a custom
 * `markerText` written by an older document also counts as opting in.
 */
export function eventMarkerTextVisible(event: EvolutionaryEvent): boolean {
  if (event.markerShowText !== undefined) return event.markerShowText;
  return !!event.markerText?.trim();
}

/**
 * The text drawn inside the badge, or '' when text is hidden. Shown text is
 * the per-event override, else the type's catalogue code. Long text is
 * truncated — the badge is a marker, not a label, and collision planning
 * sizes boxes off the radius.
 */
export function eventBadgeText(event: EvolutionaryEvent): string {
  if (!eventMarkerTextVisible(event)) return '';
  const text = event.markerText?.trim();
  if (text) return text.slice(0, EVENT_BADGE_TEXT_MAX);
  return eventCode(event);
}

/**
 * Approximate text width in em: full-width (CJK) glyphs are 1 em, Latin and
 * digits about 0.62 em. Used to shrink custom text so it stays inside the
 * marker outline.
 */
function badgeTextWidth(text: string): number {
  let units = 0;
  for (const ch of text) {
    units += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 1 : 0.62;
  }
  return Math.max(units, 0.62);
}

/**
 * Font size for the inner badge text, scaled with the badge radius and the
 * text width so a short custom label (e.g. two CJK characters) still fits
 * inside the outline. Returns 0 when the badge carries no text.
 */
export function eventBadgeFontSize(event: EvolutionaryEvent): number {
  const text = eventBadgeText(event);
  if (!text) return 0;
  const r = eventMarkerSize(event);
  const fit = (r * 1.32) / badgeTextWidth(text);
  return Math.min(11, Math.max(3.5, fit));
}

/**
 * Largest distance the badge's outline reaches from its centre — the radius for
 * shapes drawn inside it, and a shape factor beyond it for triangle / diamond
 * (whose vertices overshoot). This is what collision planning must clear, so
 * canvas and exporter stay in agreement about how much room a badge takes.
 */
export function eventBadgeExtent(event: EvolutionaryEvent): number {
  const r = eventMarkerSize(event);
  switch (eventMarkerShape(event)) {
    case 'triangle':
      return r * 1.18;
    case 'diamond':
      return r * 1.12;
    default:
      return r;
  }
}

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
