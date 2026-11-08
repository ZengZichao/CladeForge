// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Export the current project to publication-ready formats.
// The SVG is generated from scratch (not by cloning the live DOM) so it is
// tightly cropped, free of editing chrome, and reuses the exact same path /
// label logic as the canvas for WYSIWYG output. PNG and PDF are derived from
// that SVG. When ExportOptions are supplied the semantic layer (character
// colouring, state transitions, event badges + causal chains, the time axis,
// and an auto legend) is rendered too, matching what is on screen.

import { tr } from '../ui/strings';
import { computeLayout } from '../layout/autoLayout';
import {
  ERA_LANE_HEIGHT,
  planEraOverlay,
  type EraLevel,
} from '../layout/timescale';
import { branchMidpointOn, branchPath, curveMidpoint, curvedPath, straightPath } from '../canvas/paths';
import { unmeasuredNodeIds } from '../canvas/branchFlags';
import {
  HYPOTHESIS_NOTE_PAD,
  hypothesisNoteFontSize,
  hypothesisNotePlacement,
  hypothesisNoteText,
  labelAngleOf,
  labelPlacement,
} from '../canvas/labels';
import { labelAngleFor, labelBoxForNode, estimateLabelWidth, type Box } from '../canvas/labelBounds';
import {
  MAX_COLLISION_PLAN_NODES,
  planEventAnchors,
  planLabelNudges,
  timeAxisTextBoxes,
  translateBox,
} from '../canvas/eventBadgeLayout';
import { markerPath } from '../canvas/markerGeometry';
import {
  branchCaps,
  branchColorFor,
  dashArray,
  resolveBranchStyle,
  resolveNodeStyle,
  type CharacterColorTarget,
  type EventMarkerShape,
  type NodeId,
  type NodeStyle,
  type Point,
  type Project,
  type TreeNode,
} from '../model/types';
import {
  characterValueColor,
  continuousRange,
  detectTransitions,
  findCharacter,
  nodeCharacterColor,
} from '../model/characters';
import { normalizeSupport as normalizeSupportTyped, supportPercent } from '../model/treeOps';
import {
  eventBadgeFontSize,
  eventBadgeText,
  eventMarkerColor,
  eventMarkerShape,
  eventMarkerSize,
  findEventType,
} from '../model/events';
import { eventMarkerPath } from '../canvas/markerGeometry';
import type { AsrResult } from '../model/asr';
import {
  C_UNKNOWN,
  C_TRANSITION_TO,
  FIG_AXIS,
  FIG_TICK,
  FIG_LEGEND,
  FIG_ERA,
  FIG_ENV,
  FIG_CAUSAL,
  FIG_LEGEND_BORDER,
  FIG_ASR_STROKE,
} from '../canvas/colors';

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** Exported for the drift guard in `exportImage.test.ts`, which compares this
 *  literal with `--font` in `styles/app.css`. Not for use in the UI. */
export const FONT_FAMILY_FOR_TEST = FONT_FAMILY;

export interface ExportOptions {
  activeCharacterId?: string | null;
  showTransitions?: boolean;
  /** Paint the active character on node markers or on branches (default node). */
  characterColorTarget?: CharacterColorTarget;
  showEvents?: boolean;
  showEras?: boolean;
  /** Which geological rank to draw when `showEras` is on (default: both). */
  eraLevel?: EraLevel;
  /** Transient ancestral-state reconstruction to overlay as posterior pies. */
  asr?: AsrResult | null;
  /**
   * Print support values as figure text. The canvas shows support only as
   * tooltips/ARIA, so the exporter used to add numbers the author never saw;
   * now the author decides, and the default follows the canvas (off).
   */
  showSupportValues?: boolean;
  /** Include the auto-generated legend (default true; large legends can be turned off). */
  includeLegend?: boolean;
  /** Draw a scale bar for branch-length trees (default true). */
  includeScaleBar?: boolean;
  /** Grayscale-friendly rendering: desaturated fills, shape+text always on badges. */
  grayscale?: boolean;
  /** Soft margin (px) added around the content; 0 = the historical tight crop. */
  marginPx?: number;
  /**
   * Support threshold (0–100) below which branches are drawn dashed/lighter —
   * the SAME rule the canvas applies through `supportPercent`, so the figure
   * and the screen finally agree. Undefined = no thresholding.
   */
  supportThreshold?: number;
  /**
   * Explicit background colour. When absent the project's canvas background is
   * used as-is (never the CSS variable the LIVE canvas falls back to in dark
   * mode — the exported figure is always explicit).
   */
  background?: string;
  /** SVG/PDF metadata: method fingerprint, version, timestamp. */
  metadata?: { method?: string; version?: string; generatedAt?: string };
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Colour strings reach the scene from user-authored project JSON (canvas
 * background, state colours, branch and edge styles, era and event colours).
 * `escXml` guards element text, but an attribute value containing a `"` closes
 * the attribute early, so a background of `" onload="…` injected script into the
 * exported SVG — and every other malformed value simply broke the figure.
 * Accept only the colour syntaxes SVG understands and fall back otherwise.
 */
const SAFE_COLOUR =
  /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\(\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*){2,3}\)|transparent|currentColor)$/;
function safeColour(v: unknown, fallback = '#000000'): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  return t !== '' && SAFE_COLOUR.test(t) ? t : fallback;
}

/** A finite number as SVG text; anything else becomes the fallback, so a stray
 *  NaN/Infinity can never emit `stroke-width="NaN"` (an invalid arc). */
function num(v: unknown, fallback = 0): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : String(fallback);
}

/**
 * Put a support value on the 0–100 scale, honouring the node's DECLARED scale
 * when it has one and falling back to the shared model-level heuristic
 * otherwise. This used to be a second, diverging copy of the heuristic in
 * treeOps.ts (it even differed on negative/invalid values), so the same tree
 * could dim differently on screen and in the exported figure; both consumers
 * now go through one implementation.
 */
export function normalizeSupport(
  v: number,
  scale?: 'fraction' | 'percent',
): number {
  if (!Number.isFinite(v)) return 0;
  const converted = scale ? normalizeSupportTyped(v, scale) : supportPercent({ support: v });
  return converted ?? 0;
}


function markerSVG(pos: Point, style: NodeStyle, fill: string, stroke: string, dashed: boolean): string {
  if (style.shape === 'none') return '';
  const dash = dashed ? ' stroke-dasharray="2 2"' : '';
  return `<path d="${markerPath(style.shape, pos.x, pos.y, style.size)}" fill="${safeColour(fill)}" stroke="${safeColour(stroke, 'none')}" stroke-width="${num(style.strokeWidth, 1)}"${dash}/>`;
}

export interface BuiltSVG {
  svg: string;
  width: number;
  height: number;
}

/**
 * Union of every labelled node's box AT ITS DRAWN (staggered) position. The
 * viewBox grows from this rather than from the un-staggered union, so a label
 * pushed up/down by the collision planner is still inside the cropped figure.
 */
function staggeredLabelBoxes(
  project: Project,
  positions: Map<NodeId, Point>,
  visible: Set<NodeId>,
  nudges: ReadonlyMap<NodeId, number>,
): Box | null {
  let box: Box | null = null;
  const add = (b: Box) => {
    if (!box) {
      box = { ...b };
      return;
    }
    box.minX = Math.min(box.minX, b.minX);
    box.minY = Math.min(box.minY, b.minY);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.maxY = Math.max(box.maxY, b.maxY);
  };
  for (const id of visible) {
    const node = project.nodes[id];
    if (!node) continue;
    const b = labelBoxForNode(project, positions, node);
    if (!b) continue;
    add(translateBox(b, 0, nudges.get(id) ?? 0));
  }
  return box;
}


export function buildSVG(project: Project, opts: ExportOptions = {}): BuiltSVG {
  const axisOverlay = { showEras: !!opts.showEras, eraLevel: opts.eraLevel ?? 'both' };
  // Keep the whole layout: the annotation planner also needs `visible`,
  // `positions`, `bounds` and `timeAxis` to place badges/labels exactly like the
  // canvas does.
  const layout = computeLayout(project, axisOverlay);
  const { positions, visible, bounds, depths, maxDepth, timeAxis, unknownDepth, unknownAge } = layout;
  // The SAME unknown-branch set the canvas draws from (computeLayout propagates
  // an unmeasured branch to its whole downstream). The export used to run its
  // own `branchLength === undefined` test instead, which disagreed with the
  // layout in every mode where a branch needs no length to be drawn: a
  // cladogram or a fully dated time tree would export dashed "unmeasured"
  // branches the screen shows solid, and the downstream of an unknown branch
  // lost its marker.
  const unmeasuredSet = unmeasuredNodeIds(unknownDepth, unknownAge);
  const orientation = project.layout.orientation;
  const activeCharacter = findCharacter(project, opts.activeCharacterId);
  const colorTarget = opts.characterColorTarget ?? 'node';
  const charRange =
    activeCharacter?.type === 'continuous' ? continuousRange(project, activeCharacter) : undefined;

  const pad = 48;
  // Labels use the same collision-aware stagger as the on-screen NodeView, so a
  // short phylogram / time-calibrated branch cannot overlap the child's label in
  // the figure while the screen separates them (WYSIWYG). Above the canvas size
  // gate the canvas deliberately keeps the old placement (a second layout pass
  // would cost tens of ms on 10k-tip trees), so the export mirrors that too.
  const canPlan = Object.keys(project.nodes).length <= MAX_COLLISION_PLAN_NODES;
  const axisBoxes = canPlan ? timeAxisTextBoxes(project, layout, axisOverlay) : [];
  const labelNudges = canPlan
    ? planLabelNudges(project, positions, visible, axisBoxes)
    : new Map<NodeId, number>();
  // `pad` is measured around the node coordinates, so a long taxon name running
  // past the outermost node would fall outside the viewBox and be cropped — in
  // SVG, PNG and PDF alike. Grow the canvas by whatever the labels actually need
  // AT THEIR DRAWN POSITION (a nudged top-row label must not be cut either).
  const boxes = staggeredLabelBoxes(project, positions, visible, labelNudges);
  const roomLeft = boxes ? Math.max(0, bounds.minX - boxes.minX) : 0;
  const roomRight = boxes ? Math.max(0, boxes.maxX - bounds.maxX) : 0;
  const roomTop = boxes ? Math.max(0, bounds.minY - boxes.minY) : 0;
  const roomBottom = boxes ? Math.max(0, boxes.maxY - bounds.maxY) : 0;
  const minX = bounds.minX - pad - roomLeft;
  const minY = bounds.minY - pad - roomTop;
  let width = Math.max(1, bounds.maxX - bounds.minX) + pad * 2 + roomLeft + roomRight;
  const treeH = Math.max(1, bounds.maxY - bounds.minY) + pad * 2 + roomTop + roomBottom;

  // --- legend entries (character states + event types actually used) ----------
  interface LegendRow {
    kind: 'title' | 'state' | 'stateBranch' | 'event' | 'transition' | 'needsData';
    label: string;
    color?: string;
    color2?: string;
    /** Event marker outline shape, for kind === 'event'. */
    shape?: EventMarkerShape;
    /** Inner event-badge text; empty when the badge carries no text. */
    code?: string;
  }
  const legendRows: LegendRow[] = [];
  // The transition marks are detected ONCE, here, so the tally printed in
  // the legend is the tally drawn on the branches — and so the two classes
  // (real change vs. missing data) can never be conflated.
  const transitionMarks =
    opts.showTransitions && activeCharacter
      ? detectTransitions(project, activeCharacter, visible)
      : [];
  if (activeCharacter) {
    legendRows.push({ kind: 'title', label: tr(`性状：${activeCharacter.name}`, `Character: ${activeCharacter.name}`) });
    const stateKind = colorTarget === 'branch' ? ('stateBranch' as const) : ('state' as const);
    if (activeCharacter.type === 'discrete') {
      for (const s of activeCharacter.states) legendRows.push({ kind: stateKind, label: s.label, color: s.color });
    } else {
      legendRows.push({ kind: stateKind, label: tr('低值', 'Low'), color: activeCharacter.lowColor ?? '#dbeafe' });
      legendRows.push({ kind: stateKind, label: tr('高值', 'High'), color: activeCharacter.highColor ?? '#1e3a8a' });
    }
    if (opts.showTransitions && transitionMarks.length > 0) {
      const realMarks = transitionMarks.filter((t) => !t.involvesUnknown);
      const real = realMarks.length;
      const unknown = transitionMarks.length - real;
      const sample = realMarks[0];
      const continuous = activeCharacter.type === 'continuous';
      legendRows.push({
        kind: 'title',
        label: continuous ? tr('数值变化', 'Value changes') : tr('状态转变', 'State transitions'),
      });
      legendRows.push({
        kind: 'transition',
        label: continuous
          ? tr(`两端均有值（${real} 处）`, `both endpoints assigned (${real})`)
          : tr(`已知 ↔ 已知（${real} 处）`, `known ↔ known (${real})`),
        color: sample
          ? characterValueColor(activeCharacter, sample.from, charRange)
          : activeCharacter.states[0]?.color,
        color2: sample
          ? characterValueColor(activeCharacter, sample.to, charRange)
          : activeCharacter.states[1]?.color,
      });
      if (unknown > 0) {
        legendRows.push({
          kind: 'needsData',
          label: tr(
            `待补数据：端点未赋值（${unknown} 枝，不计入变化）`,
            `needs data: endpoint unassigned (${unknown} branch${unknown === 1 ? '' : 'es'}, not counted as changes)`,
          ),
        });
      }
    }
  }
  if (opts.showEvents && project.events.length) {
    // One row per visual identity, not per type: an event with a custom
    // shape / colour / text must be explained by the swatch it actually draws.
    const seen = new Set<string>();
    const rows: LegendRow[] = [];
    for (const e of project.events) {
      const color = eventMarkerColor(e);
      const shape = eventMarkerShape(e);
      const code = eventBadgeText(e);
      const id = `${e.typeId}|${color}|${shape}|${code}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = findEventType(e.typeId);
      rows.push({
        kind: 'event',
        label: t ? tr(t.label, t.labelEn) : tr('事件', 'Event'),
        color,
        shape,
        code,
      });
    }
    if (rows.length) {
      legendRows.push({ kind: 'title', label: tr('事件', 'Events') });
      legendRows.push(...rows);
    }
  }
  const legendEnabled = opts.includeLegend ?? true;
  if (!legendEnabled) legendRows.length = 0;
  const legendHeight = legendRows.length ? legendRows.length * 18 + 18 : 0;
  // The legend is laid out from `minX + 12` with no wrap and no measurement, so a
  // long caption runs past the right edge of the viewBox and is cropped — in SVG,
  // PNG and PDF alike, since all three are built from this one string.
  // The "needs data" row and a full event-type name are the usual offenders, and
  // a cropped legend also breaks the claim that exports carry auto-generated
  // legends. Widen the canvas to whatever the widest row needs.
  if (legendRows.length) {
    const textLeft = 12 + 18; // lx offset, then the marker column
    const widest = Math.max(
      ...legendRows.map((r) => estimateLabelWidth(r.label, 12) * 1.05),
    );
    width = Math.max(width, textLeft + widest + pad * 2);
  }
  const height = treeH + legendHeight;

  const parts: string[] = [];
  const defs: string[] = [];

  parts.push(
    // EXPLICIT colour, never the live canvas's CSS variable: in dark mode the
    // on-screen background resolves from the theme while `project.canvas.background`
    // still says light, and the figure must state its own ground truth.
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${safeColour(opts.background ?? project.canvas.background, '#ffffff')}"/>`,
  );

  // --- time axis (era bands + ticks + environmental events) -------------------
  if (timeAxis) {
    const b0 = timeAxis.breadthMin - 24;
    const b1 = timeAxis.breadthMax + 24;
    // Same collision-free label plan as the on-canvas overlay, so exported
    // figures never show overlapping era/event text either.
    const plan = planEraOverlay(
      timeAxis,
      { showEras: !!opts.showEras, eraLevel: opts.eraLevel ?? 'both' },
      project.environmentalEvents,
    );
    if (opts.showEras) {
      for (const e of plan.bands) {
        if (timeAxis.horizontal) {
          parts.push(`<rect x="${e.lo}" y="${b0}" width="${e.hi - e.lo}" height="${b1 - b0}" fill="${safeColour(e.color)}" opacity="0.45"/>`);
        } else {
          parts.push(`<rect x="${b0}" y="${e.lo}" width="${b1 - b0}" height="${e.hi - e.lo}" fill="${safeColour(e.color)}" opacity="0.45"/>`);
        }
      }
      for (const l of plan.labels) {
        if (timeAxis.horizontal) {
          if (l.rotated) {
            parts.push(`<text x="${l.center}" y="${b0 + 5}" text-anchor="end" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_ERA}" transform="rotate(-90 ${l.center} ${b0 + 5})">${escXml(l.label)}</text>`);
          } else {
            const y = b0 - 6 - l.lane * ERA_LANE_HEIGHT;
            if (l.lane > l.baseLane) {
              parts.push(`<line x1="${l.center}" y1="${b0 - 3}" x2="${l.center}" y2="${y + 4}" stroke="${FIG_TICK}" stroke-width="1" stroke-dasharray="2 2"/>`);
            }
            parts.push(`<text x="${l.center}" y="${y}" text-anchor="middle" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_ERA}">${escXml(l.label)}</text>`);
          }
        } else if (l.rotated) {
          parts.push(`<text x="${b0 + 11}" y="${l.center}" text-anchor="middle" dominant-baseline="central" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_ERA}" transform="rotate(-90 ${b0 + 11} ${l.center})">${escXml(l.label)}</text>`);
        } else {
          const x = b0 - 6 - l.lane * ERA_LANE_HEIGHT;
          parts.push(`<text x="${x}" y="${l.center}" text-anchor="end" dominant-baseline="central" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_ERA}">${escXml(l.label)}</text>`);
        }
      }
    }
    for (const t of timeAxis.ticks) {
      const label = t.age === 0 ? tr('现今', 'Present') : String(t.age);
      if (timeAxis.horizontal) {
        parts.push(`<line x1="${t.coord}" y1="${b0}" x2="${t.coord}" y2="${b1}" stroke="${FIG_TICK}" stroke-width="1" stroke-dasharray="3 3"/>`);
        parts.push(`<text x="${t.coord}" y="${b1 + 13}" text-anchor="middle" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_AXIS}">${escXml(label)}</text>`);
      } else {
        parts.push(`<line x1="${b0}" y1="${t.coord}" x2="${b1}" y2="${t.coord}" stroke="${FIG_TICK}" stroke-width="1" stroke-dasharray="3 3"/>`);
        parts.push(`<text x="${b1 + 4}" y="${t.coord}" text-anchor="start" dominant-baseline="central" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_AXIS}">${escXml(label)}</text>`);
      }
    }
    const envById = new Map(plan.env.map((e) => [e.id, e]));
    for (const ev of project.environmentalEvents) {
      const a = timeAxis.ageToCoord(ev.from);
      const b = timeAxis.ageToCoord(ev.to);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const pointEv = Math.abs(hi - lo) < 0.5;
      const placed = envById.get(ev.id);
      const lane = placed?.lane ?? 0;
      const center = placed?.center ?? (lo + hi) / 2;
      if (timeAxis.horizontal) {
        parts.push(
          pointEv
            ? `<line x1="${lo}" y1="${b0}" x2="${lo}" y2="${b1}" stroke="${safeColour(ev.color)}" stroke-width="2"/>`
            : `<rect x="${lo}" y="${b0}" width="${hi - lo}" height="${b1 - b0}" fill="${safeColour(ev.color)}" opacity="0.18" stroke="${safeColour(ev.color)}" stroke-dasharray="4 3"/>`,
        );
        const y = b0 - 6 - lane * ERA_LANE_HEIGHT;
        parts.push(`<text x="${center}" y="${y}" text-anchor="middle" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_ENV}">${escXml(ev.label)}</text>`);
      } else {
        parts.push(
          pointEv
            ? `<line x1="${b0}" y1="${lo}" x2="${b1}" y2="${lo}" stroke="${safeColour(ev.color)}" stroke-width="2"/>`
            : `<rect x="${b0}" y="${lo}" width="${b1 - b0}" height="${hi - lo}" fill="${safeColour(ev.color)}" opacity="0.18" stroke="${safeColour(ev.color)}" stroke-dasharray="4 3"/>`,
        );
        const x = b0 - 6 - lane * ERA_LANE_HEIGHT;
        parts.push(`<text x="${x}" y="${center}" text-anchor="end" font-size="11" font-family="${FONT_FAMILY}" fill="${FIG_ENV}">${escXml(ev.label)}</text>`);
      }
    }
  }

  // --- tree branches ----------------------------------------------------------
  for (const id of visible) {
    const node = project.nodes[id];
    if (!node?.parentId || !visible.has(node.parentId)) continue;
    const from = positions.get(node.parentId);
    const to = positions.get(id);
    if (!from || !to) continue;
    const bs = resolveBranchStyle(node, project);
    const charColor =
      activeCharacter && colorTarget === 'branch'
        ? nodeCharacterColor(activeCharacter, node, charRange)
        : undefined;
    const color = charColor ?? branchColorFor(node, project, depths.get(id) ?? 0, maxDepth);
    const caps = branchCaps(bs.shape);
    const d = branchPath(from, to, orientation, project.layout.type, bs.shape);
    const dash = dashArray(bs.dash, bs.width);
    // An UNMEASURED branch must never export as a solid line — the screen marks
    // it (branchFlags) and hiding "no measurement" as "has length" in the
    // published figure is the single most misleading export defect. Same dash
    // language as the canvas, from the SAME source: the layout's unknown sets,
    // not a local branch-length guess.
    const unmeasured = unmeasuredSet.has(id);
    const effDash = unmeasured ? '4 3' : dash;
    const effColor = unmeasured ? FIG_AXIS : safeColour(color);
    parts.push(
      `<path d="${d}" fill="none" stroke="${effColor}" stroke-width="${num(bs.width, 1)}" ${effDash ? `stroke-dasharray="${effDash}"` : ''} stroke-linejoin="${caps.linejoin}" stroke-linecap="${caps.linecap}"/>`,
    );
    // Render branch support value near the midpoint — OPT-IN. The canvas shows
    // support only as tooltips/ARIA, so printing numbers the author never saw
    // let a reviewer ask "why is this number in my figure?"; the author now
    // decides, and the default matches the screen (off).
    if (
      (opts.showSupportValues ?? false) &&
      typeof node.support === 'number' &&
      Number.isFinite(node.support) &&
      node.childrenIds.length > 0
    ) {
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      // The dimming threshold is the explicit option, else the project's own
      // `supportThreshold` (documented 0–100) — the same rule the canvas
      // applies, so the figure and the screen finally agree.
      const rawThreshold = opts.supportThreshold ?? project.layout.supportThreshold;
      const threshold =
        typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) ? rawThreshold : 70;
      // The `typeof support === 'number' && isFinite` guard above also makes
      // supportPercent(total) finite here, so the comparison is safe.
      const supportColor = (supportPercent(node) ?? 0) < threshold ? FIG_AXIS : '#1d1d1f';
      const sm = branchMidpointOn(from, to, orientation, project.layout.type, bs.shape === 'curved');
      parts.push(
        `<text x="${sm.x}" y="${sm.y - 3}" text-anchor="middle" font-size="10" font-family="${FONT_FAMILY}" fill="${supportColor}">${escXml(String(node.support))}</text>`,
      );
    }
  }

  // --- custom (reticulation) edges -------------------------------------------
  for (const edge of project.customEdges) {
    const from = positions.get(edge.sourceId);
    const to = positions.get(edge.targetId);
    if (!from || !to) continue;
    const st = edge.style;
    const d = curvedPath(from, to, st.curvature);
    const dash = dashArray(st.dash, st.width);
    let markerAttr = '';
    if (st.arrow) {
      const mid = `ex-arrow-${edge.id}`;
      defs.push(
        `<marker id="${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${st.color}"/></marker>`,
      );
      markerAttr = `marker-end="url(#${mid})"`;
    }
    parts.push(
      `<path d="${d}" fill="none" stroke="${safeColour(st.color)}" stroke-width="${num(st.width, 1)}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linecap="round" ${markerAttr}/>`,
    );
    if (edge.label) {
      const m = curveMidpoint(from, to, st.curvature);
      parts.push(
        `<text x="${m.x}" y="${m.y - 4}" text-anchor="middle" font-size="12" font-family="${FONT_FAMILY}" fill="${safeColour(st.color)}">${escXml(edge.label)}</text>`,
      );
    }
  }

  // --- state-transition markers ----------------------------------------------
  // Two visual classes. `known ↔ known` is an evolutionary change; a branch
  // with an UNKNOWN endpoint is a prompt to score data and must not be readable
  // as a change in the figure (missing data adds no homoplasy). `transitionMarks`
  // is detected once above, so the legend and the markers can never disagree.
  if (opts.showTransitions && activeCharacter) {
    for (const t of transitionMarks) {
      const from = positions.get(t.parentId);
      const to = positions.get(t.nodeId);
      if (!from || !to) continue;
      // Anchor the marker ON the drawn branch (the canvas uses the same
      // `branchMidpointOn`): for an elbow branch the bounding-box midpoint
      // hangs in empty air beside the polyline.
      const m = branchMidpointOn(from, to, orientation, project.layout.type, false);
      const mx = m.x;
      const my = m.y;
      if (t.involvesUnknown) {
        parts.push(
          `<circle cx="${mx}" cy="${my}" r="5.5" fill="#ffffff" stroke="${C_UNKNOWN}" stroke-width="1.6" stroke-dasharray="2.4 1.8"/>`,
        );
        parts.push(
          `<text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="8" font-weight="700" font-family="${FONT_FAMILY}" fill="${C_UNKNOWN}">?</text>`,
        );
        continue;
      }
      const fromColor =
        characterValueColor(activeCharacter, t.from, charRange) ?? C_UNKNOWN;
      const toColor = characterValueColor(activeCharacter, t.to, charRange) ?? C_TRANSITION_TO;
      parts.push(`<circle cx="${mx}" cy="${my}" r="5.5" fill="#ffffff" stroke="${safeColour(fromColor)}" stroke-width="2"/>`);
      parts.push(`<circle cx="${mx}" cy="${my}" r="3" fill="${safeColour(toColor)}"/>`);
    }
  }

  // --- nodes + labels ---------------------------------------------------------
  // A COLLAPSED clade exports as a short stub in the figure; without a "+N"
  // badge a reader cannot tell a collapsed clade from a two-tips clade. The
  // canvas draws the same badge (NodeView), so the figure says it too.
  const collapsedTips = (() => {
    // Iterative post-order: a recursive count overflowed the call stack on a
    // 6000-level unifurcate tree even when the root was collapsed and the
    // layout marked it invisible — the SVG build is shared by all three export
    // formats, so layout-stack safety does not transfer for free.
    const map = new Map<NodeId, number>();
    const order: NodeId[] = [];
    const seen = new Set<NodeId>();
    const stack: NodeId[] = [...visible];
    while (stack.length) {
      const id = stack.pop() as NodeId;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      const n = project.nodes[id];
      if (n) for (const c of n.childrenIds) if (!seen.has(c)) stack.push(c);
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const n = project.nodes[order[i]];
      if (!n) continue;
      let total = 0;
      for (const c of n.childrenIds) {
        const cn = project.nodes[c];
        if (!cn) continue;
        total += cn.childrenIds.length === 0 ? 1 : map.get(c) ?? 0;
      }
      map.set(n.id, total);
    }
    return map;
  })();
  for (const id of visible) {
    const node = project.nodes[id];
    const pos = positions.get(id);
    if (!node || !pos) continue;
    const style = resolveNodeStyle(node, project);
    let fill = style.fill;
    let stroke = style.stroke;
    let dashed = false;
    if (activeCharacter && colorTarget === 'node') {
      const c = nodeCharacterColor(activeCharacter, node, charRange);
      if (c) fill = c;
      else {
        fill = '#ffffff';
        stroke = C_UNKNOWN;
        dashed = true;
      }
    }
    const marker = markerSVG(pos, style, fill, stroke, dashed);
    if (marker) parts.push(marker);
    if (node.collapsed) {
      // Same "+N hidden tips" disclosure the canvas shows: a triangle on the
      // branch plus the count. Without it the figure misrepresents sampling.
      const hidden = collapsedTips.get(id) ?? 0;
      const bx = orientation === 'LR' ? pos.x + style.size + 4 : orientation === 'RL' ? pos.x - style.size - 4 : pos.x;
      const by = orientation === 'TB' ? pos.y + style.size + 4 : orientation === 'BT' ? pos.y - style.size - 4 : pos.y;
      parts.push(
        `<path d="M ${bx} ${by - 4} L ${bx + 7} ${by} L ${bx} ${by + 4} Z" fill="#ffffff" stroke="#6b7280" stroke-width="1"/>`,
      );
      if (hidden > 0) {
        parts.push(
          `<text x="${bx + 9}" y="${by + 3}" font-size="9" font-family="${FONT_FAMILY}" fill="#6b7280">+${hidden}</text>`,
        );
      }
    }
    const note = node.hypothesisNote?.trim();
    const showLabel = style.showLabel && !!node.label;
    if (showLabel || note) {
      const place = labelPlacement(
        orientation,
        node.childrenIds.length === 0,
        style.size,
        style.labelPosition,
        style.labelOffsetX,
        style.labelOffsetY,
        labelAngleFor(project, positions, node),
      );
      const nudge = labelNudges.get(id) ?? 0;
      if (showLabel) {
        const lx = pos.x + place.dx;
        // Same vertical stagger as the canvas; the rotation ORIGIN moves with the
        // label, otherwise a rotated label would swing around its old position.
        const ly = pos.y + place.dy + nudge;
        const rot = style.labelRotation ? ` transform="rotate(${num(style.labelRotation, 0)} ${lx} ${ly})"` : '';
        parts.push(
          `<text x="${lx}" y="${ly}" text-anchor="${place.anchor}" dominant-baseline="${place.baseline}" font-size="${num(style.fontSize, 12)}" font-style="${style.fontStyle === 'italic' ? 'italic' : 'normal'}" font-weight="${num(Number(style.fontWeight), 400)}"${rot} font-family="${FONT_FAMILY}" fill="${safeColour(style.labelColor)}">${escXml(node.label)}</text>`,
        );
      }
      if (note) {
        const nPlace = hypothesisNotePlacement(place, style.fontSize);
        const nFont = hypothesisNoteFontSize(style.fontSize);
        const nText = hypothesisNoteText(note);
        const nW = estimateLabelWidth(nText, nFont);
        const nx = pos.x + nPlace.dx;
        const ny = pos.y + nPlace.dy + nudge;
        const left =
          nPlace.anchor === 'start' ? nx : nPlace.anchor === 'middle' ? nx - nW / 2 : nx - nW;
        parts.push(
          `<rect x="${(left - HYPOTHESIS_NOTE_PAD).toFixed(2)}" y="${(ny - HYPOTHESIS_NOTE_PAD).toFixed(2)}" width="${(nW + HYPOTHESIS_NOTE_PAD * 2).toFixed(2)}" height="${(nFont + HYPOTHESIS_NOTE_PAD * 2).toFixed(2)}" rx="3" fill="#ffffff" opacity="0.9"/>`,
        );
        parts.push(
          `<text x="${nx}" y="${ny}" text-anchor="${nPlace.anchor}" dominant-baseline="${nPlace.baseline}" font-size="${num(nFont, 10)}" font-style="italic" font-family="${FONT_FAMILY}" fill="${FIG_AXIS}">${escXml(nText)}<title>${escXml(note)}</title></text>`,
        );
      }
    }
  }

  // --- event badges + causal-chain arrows ------------------------------------
  // Same planner as the canvas (BUG-4): badges avoid every label bbox, node
  // marker, time-axis text and already-placed badge, and a displaced stack gets
  // the same thin leader line back to its branch. Keeps the figure WYSIWYG.
  if (opts.showEvents && project.events.length) {
    const anchorPlan = planEventAnchors({
      project,
      events: project.events,
      positions,
      nodes: project.nodes,
      culled: visible,
      orientation,
      layoutType: project.layout.type,
      labelNudges,
      axisBoxes,
    });
    const anchors = anchorPlan.anchors;
    if (project.events.some((e) => e.triggers.length)) {
      defs.push(
        `<marker id="ex-causal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${FIG_CAUSAL}"/></marker>`,
      );
    }
    // Leader lines first, under the arrows/badges (matches the canvas z-order).
    for (const l of anchorPlan.leaders) {
      parts.push(
        `<line x1="${l.from.x}" y1="${l.from.y}" x2="${l.to.x}" y2="${l.to.y}" stroke="${FIG_CAUSAL}" stroke-width="1" opacity="0.7"/>`,
      );
      parts.push(`<circle cx="${l.to.x}" cy="${l.to.y}" r="1.6" fill="${FIG_CAUSAL}"/>`);
    }
    for (const e of project.events) {
      const a = anchors.get(e.id);
      if (!a) continue;
      for (const tid of e.triggers) {
        const b = anchors.get(tid);
        if (b) {
          parts.push(
            `<path d="${curvedPath(a, b, 0.25)}" fill="none" stroke="${FIG_CAUSAL}" stroke-width="1.25" stroke-dasharray="4 3" marker-end="url(#ex-causal)" opacity="0.85"/>`,
          );
        }
      }
    }
    for (const e of project.events) {
      const a = anchors.get(e.id);
      if (!a) continue;
      // Same per-event style resolution as the canvas EventLayer (shape / size /
      // colour / inner text with catalogue defaults), so exported figures cannot
      // disagree with the screen about how a badge is drawn.
      const r = eventMarkerSize(e);
      const color = eventMarkerColor(e);
      const sw = e.confidence === 'high' ? 2.5 : 2;
      const cdash = e.confidence === 'low' ? ' stroke-dasharray="2 2"' : '';
      const join = ' stroke-linejoin="round"';
      parts.push(
        `<path d="${eventMarkerPath(eventMarkerShape(e), a.x, a.y, r)}" fill="#ffffff" stroke="${safeColour(color)}" stroke-width="${sw}"${cdash}${join}/>`,
      );
      // Text is optional: markers draw shape + colour only unless the event
      // explicitly shows text. When shown, centre it with the same ~0.34 em
      // baseline shift the canvas uses.
      const badgeText = eventBadgeText(e);
      if (badgeText) {
        const fs = eventBadgeFontSize(e);
        parts.push(
          `<text x="${a.x}" y="${(a.y + fs * 0.34).toFixed(2)}" text-anchor="middle" font-size="${fs.toFixed(2)}" font-weight="700" font-family="${FONT_FAMILY}" fill="#111111">${escXml(badgeText)}</text>`,
        );
      }
    }
  }

  // --- ancestral-state posterior pies (Mk reconstruction overlay) ------------
  // Mirrors canvas/AsrPieLayer: one pie per on-screen INTERNAL node, wedges are
  // the posterior state probabilities. Drawn on top of nodes/events to match the
  // canvas z-order. Only rendered when an ASR result for the active character is
  // supplied (i.e. the user has run the reconstruction).
  if (opts.asr && activeCharacter && opts.asr.characterId === activeCharacter.id) {
    const R = 9;
    // Same display rule as canvas/AsrPieLayer.asrWedgePlan — states below
    // the reconstruction's own threshold are not drawn, and a state holding at
    // least 1 − threshold fills the pie (every other state is then under the
    // cut-off, so the split would be a hairline arc rather than information).
    const t = Number.isFinite(opts.asr.threshold) ? Math.min(1, Math.max(0, opts.asr.threshold)) : 0;
    for (const [id, p] of opts.asr.probs) {
      const node = project.nodes[id];
      if (!node || node.childrenIds.length === 0) continue; // internal nodes only
      if (p.length !== activeCharacter.states.length) continue; // dimension mismatch guard
      if (!visible.has(id)) continue;
      const pos = positions.get(id);
      if (!pos) continue;
      const shown: number[] = [];
      let solidIndex = -1;
      for (let i = 0; i < p.length; i += 1) {
        if (!(p[i] > 0) || p[i] < t) continue;
        shown.push(i);
        if (p[i] >= 1 - t) solidIndex = i;
      }
      if (shown.length === 0) continue;
      let a = -Math.PI / 2;
      for (const i of shown) {
        const frac = p[i];
        const color = activeCharacter.states[i]?.color ?? C_UNKNOWN;
        if (i === solidIndex) {
          parts.push(`<circle cx="${pos.x}" cy="${pos.y}" r="${R}" fill="${safeColour(color)}"/>`);
          break;
        }
        const a1 = a + frac * Math.PI * 2;
        const x0 = pos.x + R * Math.cos(a);
        const y0 = pos.y + R * Math.sin(a);
        const x1 = pos.x + R * Math.cos(a1);
        const y1 = pos.y + R * Math.sin(a1);
        const large = frac > 0.5 ? 1 : 0;
        parts.push(
          `<path d="M ${pos.x} ${pos.y} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z" fill="${safeColour(color)}"/>`,
        );
        a = a1;
      }
      parts.push(`<circle cx="${pos.x}" cy="${pos.y}" r="${R}" fill="none" stroke="${FIG_ASR_STROKE}" stroke-width="0.75"/>`);
    }
  }


  // --- branch-length scale bar -------------------------------------------------
  // A figure of a tree with measured branch lengths needs a scale bar; reviewers
  // ask for it first. Time-calibrated trees already carry the time axis, so the
  // bar is drawn only for phylograms. Screen-space placement: bottom-left.
  if ((opts.includeScaleBar ?? true) && project.layout.type === 'rectangular-phylogram') {
    // The scale is the LAYOUT's own depthScale — the same number the on-screen
    // ScaleBar reads. Re-estimating px/unit from the drawn positions made a
    // single pinned (manually dragged) node change the bar from 75px/0.5 to
    // 65px/0.1, and placeholder distances downstream of an unmeasured ancestor
    // participated in the estimate. depthScale is undefined exactly when the
    // phylogram degraded to a cladogram, in which case there is nothing to
    // measure and no bar is drawn.
    const pxPerUnit = layout.depthScale ?? 0;
    if (pxPerUnit > 0) {
      const targetPx = 120;
      const rawUnit = targetPx / pxPerUnit;
      const mag = Math.pow(10, Math.floor(Math.log10(rawUnit)));
      const nice = [1, 2, 5, 10].map((m) => m * mag).filter((v) => v >= rawUnit * 0.5)[0] ?? 10 * mag;
      const barPx = nice * pxPerUnit;
      const bx = minX + 12;
      // Bottom of the TREE box, above the reserved legend strip — the old
      // `minY + height` put the bar inside the legend's band, where its caps
      // collided with the last legend row's descenders.
      const by = minY + treeH - 14;
      // Branch lengths on a phylogram are substitutions per site, not time —
      // labelling the bar with the project's time unit claimed a Ma scale for
      // a substitutions figure (the canvas bar says subst./site too).
      const unit = tr('substitutions/site', 'subst./site');
      parts.push(
        `<line x1="${bx}" y1="${by}" x2="${bx + barPx}" y2="${by}" stroke="#1d1d1f" stroke-width="2"/>`,
      );
      parts.push(
        `<line x1="${bx}" y1="${by - 4}" x2="${bx}" y2="${by + 4}" stroke="#1d1d1f" stroke-width="2"/>`,
      );
      parts.push(
        `<line x1="${bx + barPx}" y1="${by - 4}" x2="${bx + barPx}" y2="${by + 4}" stroke="#1d1d1f" stroke-width="2"/>`,
      );
      parts.push(
        `<text x="${bx + barPx + 6}" y="${by + 4}" font-size="11" font-family="${FONT_FAMILY}" fill="#1d1d1f">${escXml(`${nice}${unit ? ' ' + unit : ''}`)}</text>`,
      );
    }
  }

  // --- legend -----------------------------------------------------------------
  if (legendRows.length) {
    const lx = minX + 12;
    let ly = bounds.maxY + roomBottom + pad + 18;
    for (const r of legendRows) {
      if (r.kind === 'title') {
        parts.push(`<text x="${lx}" y="${ly}" font-size="12" font-weight="700" font-family="${FONT_FAMILY}" fill="${FIG_LEGEND}">${escXml(r.label)}</text>`);
      } else if (r.kind === 'state') {
        parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${safeColour(r.color)}" stroke="${FIG_LEGEND_BORDER}"/>`);
        parts.push(`<text x="${lx + 18}" y="${ly}" font-size="12" font-family="${FONT_FAMILY}" fill="${FIG_LEGEND}">${escXml(r.label)}</text>`);
      } else if (r.kind === 'stateBranch') {
        parts.push(`<path d="M ${lx} ${ly - 4} L ${lx + 12} ${ly - 4}" fill="none" stroke="${safeColour(r.color, FIG_LEGEND_BORDER)}" stroke-width="2.6" stroke-linecap="round"/>`);
        parts.push(`<text x="${lx + 18}" y="${ly}" font-size="12" font-family="${FONT_FAMILY}" fill="${FIG_LEGEND}">${escXml(r.label)}</text>`);
      } else if (r.kind === 'transition') {
        // The two-colour dot used on the branches that really changed state.
        parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="7" fill="#ffffff" stroke="${safeColour(r.color, FIG_LEGEND_BORDER)}" stroke-width="2"/>`);
        parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="3.4" fill="${safeColour(r.color2, FIG_LEGEND)}"/>`);
        parts.push(`<text x="${lx + 18}" y="${ly}" font-size="12" font-family="${FONT_FAMILY}" fill="${FIG_LEGEND}">${escXml(r.label)}</text>`);
      } else if (r.kind === 'needsData') {
        // The dashed grey "?" marker for a branch with an unassigned endpoint —
        // deliberately not a two-colour dot, which would claim a real change.
        parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="7" fill="#ffffff" stroke="${C_UNKNOWN}" stroke-width="1.6" stroke-dasharray="2.4 1.8"/>`);
        parts.push(`<text x="${lx + 6}" y="${ly - 1}" text-anchor="middle" font-size="9" font-weight="700" font-family="${FONT_FAMILY}" fill="${C_UNKNOWN}">?</text>`);
        parts.push(`<text x="${lx + 18}" y="${ly}" font-size="12" font-family="${FONT_FAMILY}" fill="${FIG_LEGEND}">${escXml(r.label)}</text>`);
      } else {
        parts.push(`<path d="${eventMarkerPath(r.shape ?? 'circle', lx + 6, ly - 4, 6.6)}" fill="#ffffff" stroke="${safeColour(r.color, FIG_LEGEND_BORDER)}" stroke-width="2" stroke-linejoin="round"/>`);
        if (r.code) {
          parts.push(`<text x="${lx + 6}" y="${ly - 1.3}" text-anchor="middle" font-size="${r.code.length > 2 ? 4.5 : 6.5}" font-weight="700" font-family="${FONT_FAMILY}" fill="#111111">${escXml(r.code)}</text>`);
        }
        parts.push(`<text x="${lx + 18}" y="${ly}" font-size="12" font-family="${FONT_FAMILY}" fill="${FIG_LEGEND}">${escXml(r.label)}</text>`);
      }
      ly += 18;
    }
  }

  const metaBits: string[] = [];
  if (opts.metadata?.method) metaBits.push(`method: ${opts.metadata.method}`);
  if (opts.metadata?.version) metaBits.push(`CladeForge ${opts.metadata.version}`);
  if (opts.metadata?.generatedAt) metaBits.push(`generated ${opts.metadata.generatedAt}`);
  // Grayscale-friendly mode (PM-67/F6): a document-level luminance filter —
  // the branch/state colours lose hue but keep their relative lightness, and
  // the badge shape+code channels (on by default) carry the identity. Applied
  // as one filter over the figure instead of per-element recolouring, so the
  // geometry path stays identical.
  const grayscaleFilter = opts.grayscale
    ? '  <filter id="cf-grayscale"><feColorMatrix type="saturate" values="0"/></filter>'
    : '';
  const grayscaleAttr = opts.grayscale ? ' filter="url(#cf-grayscale)"' : '';
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">`,
    metaBits.length
      ? `  <metadata>${escXml(metaBits.join(' · '))}</metadata>`
      : '',
    defs.length || grayscaleFilter ? `<defs>${grayscaleFilter}${defs.join('')}</defs>` : '',
    opts.grayscale ? `<g${grayscaleAttr}>\n${parts.join('\n')}\n</g>` : parts.join('\n'),
    '</svg>',
  ].join('\n');

  return { svg, width, height };
}

export function exportSVGString(project: Project, opts: ExportOptions = {}): string {
  return buildSVG(project, opts).svg;
}

/**
 * Rasterise the project SVG to a PNG blob at the given pixel scale.
 * `onClamp` is called when the browser's canvas budgets forced the scale down —
 * the caller MUST surface it (a silently lowered DPI is how a "300 dpi"
 * figure arrives at 90 dpi and fails review).
 *
 * The PNG also carries a pHYs chunk stating the figure's real pixel density
 * (CSS px are treated as 96 dpi, so the chunk reports `scale × 96`): without
 * it a "300 dpi" figure opens at 96 dpi in every layout program regardless of
 * how many pixels it holds.
 */
export async function toPngBlob(
  project: Project,
  scale = 2,
  opts: ExportOptions = {},
  onClamp?: (requested: number, effective: number) => void,
): Promise<Blob> {
  const { svg, width, height } = buildSVG(project, opts);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to render SVG for PNG export'));
    img.src = url;
  });
  // Browsers cap canvas dimensions (~16k px per side) AND total bitmap area; a
  // very large tree at the requested scale would silently fail in toBlob. Clamp
  // the scale to the largest value that still fits both budgets, keeping aspect
  // ratio and never upscaling. The area budget matters as much as the side
  // length: 16384² px is ~1 GB of RGBA, well past what WKWebView allocates,
  // while 67 Mpx ≈ 268 MB still allows an 8192² figure at full scale.
  const MAX_CANVAS = 16384;
  const MAX_CANVAS_PIXELS = 67_108_864; // 8192 × 8192
  let s = scale;
  const w = Math.ceil(width * s);
  const h = Math.ceil(height * s);
  const fit = Math.min(
    MAX_CANVAS / w,
    MAX_CANVAS / h,
    Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, w * h)),
  );
  if (fit < 1) {
    s = s * fit;
    onClamp?.(scale, s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * s);
  canvas.height = Math.ceil(height * s);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(s, s);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
  const dpi = Math.round(s * 96);
  if (dpi !== 96) {
    try {
      return await withPngDpi(blob, dpi);
    } catch {
      return blob; // metadata is best-effort; the pixels are already correct
    }
  }
  return blob;
}

/**
 * Insert a pHYs chunk (pixels per metre, one DPI statement per axis) after the
 * IHDR of an encoded PNG. Pure byte surgery — the image data is untouched.
 */
async function withPngDpi(blob: Blob, dpi: number): Promise<Blob> {
  const ppm = Math.round(dpi / 0.0254);
  const src = new Uint8Array(await blob.arrayBuffer());
  // IHDR: 8-byte signature, then len(4) type(4) data(13) crc(4).
  const ihdrDataLen = new DataView(src.buffer, src.byteOffset + 8, 4).getUint32(0);
  const insertAt = 8 + 12 + ihdrDataLen;
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, insertAt), 0);
  const view = new DataView(out.buffer, insertAt);
  view.setUint32(0, 9); // data length
  out[insertAt + 4] = 0x70; // 'p'
  out[insertAt + 5] = 0x48; // 'H'
  out[insertAt + 6] = 0x59; // 'Y'
  out[insertAt + 7] = 0x73; // 's'
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  out[insertAt + 16] = 1; // unit: metre
  view.setUint32(17, pngCrc(out.subarray(insertAt + 4, insertAt + 17)));
  out.set(src.subarray(insertAt), insertAt + 21);
  return new Blob([out], { type: 'image/png' });
}

/** CRC-32 (ISO 3309 / ITU-T V.42), the checksum PNG chunk framing requires. */
function pngCrc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Convert a colour string to its luminance grey (Rec. 601: the same weighting
 * the SVG saturate filter applies). svg2pdf.js ignores SVG filters, so the
 * PDF path cannot lean on `<feColorMatrix type="saturate" values="0"/>` — the
 * grey must be WRITTEN into the colours. Unknown formats pass through.
 */
function toGrayscaleColor(color: string): string {
  const t = color.trim();
  const hex6 = /^#([0-9a-fA-F]{6})$/.exec(t);
  if (hex6) {
    const v = parseInt(hex6[1], 16);
    const r = (v >> 16) & 0xff;
    const g = (v >> 8) & 0xff;
    const b = v & 0xff;
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    return `#${((y << 16) | (y << 8) | y).toString(16).padStart(6, '0')}`;
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(t);
  if (fn) {
    const parts = fn[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if ([r, g, b].every((x) => Number.isFinite(x))) {
        const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        return `rgb(${y},${y},${y})`;
      }
    }
  }
  return color;
}

/** Luminance-grey every colour in the SVG string (hex and rgb() forms). */
function grayscaleSvg(svg: string): string {
  return svg
    .replace(/#[0-9a-fA-F]{6}\b/g, (h) => toGrayscaleColor(h))
    .replace(/rgba?\(\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*){2,3}\)/gi, (m) => toGrayscaleColor(m));
}

/**
 * jsPDF's standard-14 fonts are WinAnsi-encoded: text outside Latin-1 came out
 * of the PDF as garbage glyphs (`pdftotext` read CJK labels as noise) because
 * no CJK font is embedded. Labels that need such characters are rendered by
 * the BROWSER's own font engine into a high-resolution transparent image and
 * embedded at their drawn position — legible CJK at the correct size, while
 * Latin text stays real vector text. (These glyph images are not selectable;
 * that is the documented trade of this export path.)
 */
const NEEDS_GLYPH_IMAGE = /[\u0100-\uFFFF]/;

async function rasteriseExoticText(svg: string): Promise<string> {
  if (!NEEDS_GLYPH_IMAGE.test(svg.replace(/<[^>]*>/g, ''))) return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const svgEl = doc.documentElement;
  const texts = Array.from(svgEl.querySelectorAll('text'));
  if (texts.length === 0) return svg;
  const NS = 'http://www.w3.org/2000/svg';
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  for (const t of texts) {
    const content = t.textContent ?? '';
    if (!content || !NEEDS_GLYPH_IMAGE.test(content)) continue;
    // An ancestor transform would shift the drawn image away from the text's
    // own coordinates; leave such text to the (imperfect) default path rather
    // than misplace it.
    let transformed = false;
    for (let el: Element | null = t; el; el = el.parentElement) {
      if (el.getAttribute && el.getAttribute('transform')) transformed = true;
    }
    if (transformed) continue;
    const sizeAttr = t.getAttribute('font-size');
    const fontSize = sizeAttr ? parseFloat(sizeAttr) || 11 : 11;
    const family = t.getAttribute('font-family') || 'sans-serif';
    const weight = t.getAttribute('font-weight') || '400';
    const fill = t.getAttribute('fill') || '#000000';
    const anchor = t.getAttribute('text-anchor') || 'start';
    const x = parseFloat(t.getAttribute('x') ?? '0') || 0;
    const y = parseFloat(t.getAttribute('y') ?? '0') || 0;
    if (!canvas || !ctx) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d');
      if (!ctx) return svg;
    }
    const font = `${weight} ${fontSize}px ${family}`;
    ctx.font = font;
    const metrics = ctx.measureText(content);
    const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
    const w = Math.max(1, metrics.width);
    const h = Math.max(1, ascent + descent);
    const SCALE = 4; // supersample so the embedded glyphs stay crisp in print
    canvas.width = Math.ceil(w * SCALE);
    canvas.height = Math.ceil(h * SCALE);
    // Resizing a canvas resets its state but the context object stays valid.
    ctx.scale(SCALE, SCALE);
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(content, 0, ascent);
    const href = canvas.toDataURL('image/png');
    const img = doc.createElementNS(NS, 'image');
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    img.setAttribute('x', String(x0));
    img.setAttribute('y', String(y - ascent));
    img.setAttribute('width', String(w));
    img.setAttribute('height', String(h));
    img.setAttribute('href', href);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
    img.setAttribute('preserveAspectRatio', 'none');
    t.replaceWith(img);
  }
  return new XMLSerializer().serializeToString(svgEl);
}

/** Produce a vector PDF blob using jsPDF + svg2pdf.js (lazy-loaded). */
export async function toPdfBlob(project: Project, opts: ExportOptions = {}): Promise<Blob> {
  let { svg, width, height } = buildSVG(project, opts);
  // The PDF cannot lean on the SVG saturate filter (svg2pdf ignores filters):
  // the grey is computed into every colour explicitly.
  if (opts.grayscale) svg = grayscaleSvg(svg);
  svg = await rasteriseExoticText(svg);
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');
  // jsPDF caps a MediaBox at 14400 units per side; a 250-tip figure at the
  // default spacing is taller than that. Scale the PAGE down (aspect kept) so
  // the figure always fits instead of emitting a clipped/overflowing box —
  // svg2pdf renders the content at the requested size either way.
  const MAX_PDF_UNITS = 14400;
  const fit = Math.min(
    1,
    MAX_PDF_UNITS / Math.max(1, width),
    MAX_PDF_UNITS / Math.max(1, height),
  );
  const pageW = width * fit;
  const pageH = height * fit;
  const doc = new jsPDF({
    orientation: pageW >= pageH ? 'landscape' : 'portrait',
    // Use px units so the SVG's pixel geometry maps 1:1 into the PDF page;
    // 'pt' would treat each SVG px as a point and inflate the output ~1.33x.
    unit: 'px',
    format: [pageW, pageH],
  });
  if (opts.metadata?.method || opts.metadata?.version) {
    doc.setProperties({
      creator: `CladeForge${opts.metadata.version ? ' ' + opts.metadata.version : ''}`,
      subject: opts.metadata.method ?? '',
    });
  }
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml')
    .documentElement as unknown as SVGSVGElement;
  // svg2pdf augments jsPDF with `.svg()`.
  await (doc as unknown as { svg: (n: Element, o: object) => Promise<unknown> }).svg(el, {
    x: 0,
    y: 0,
    width: pageW,
    height: pageH,
  });
  return doc.output('blob');
}
