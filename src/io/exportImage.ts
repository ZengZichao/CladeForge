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
import { curveMidpoint, circularPath, curvedPath, elbowPath, straightPath } from '../canvas/paths';
import { labelAngleOf, labelPlacement } from '../canvas/labels';
import { labelAngleFor, labelBoxes, estimateLabelWidth, type Box } from '../canvas/labelBounds';
import { markerPath } from '../canvas/markerGeometry';
import {
  branchCaps,
  branchColorFor,
  dashArray,
  resolveBranchStyle,
  resolveNodeStyle,
  type NodeId,
  type NodeStyle,
  type Point,
  type Project,
  type TreeNode,
} from '../model/types';
import { continuousRange, detectTransitions, findCharacter, nodeCharacterColor } from '../model/characters';
import {
  EVENT_BADGE_RADIUS,
  EVENT_CODE_FONT_SIZE,
  eventCode,
  eventColor,
  findEventType,
} from '../model/events';
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
  showEvents?: boolean;
  showEras?: boolean;
  /** Which geological rank to draw when `showEras` is on (default: both). */
  eraLevel?: EraLevel;
  /** Transient ancestral-state reconstruction to overlay as posterior pies. */
  asr?: AsrResult | null;
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
 * Put a support value on the 0–100 scale. `newick.ts` stores whatever the file
 * held: RAxML/PHYLUM write 95, MrBayes/BEAST write 0.95, and comparing a 0–1
 * posterior against a 70 % threshold dimmed EVERY branch of a Bayesian tree in
 * the exported figure while still printing "0.95" next to it.
 * Values ≤ 1 are read as fractions, which is the convention in both tool families.
 */
export function normalizeSupport(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v >= 0 && v <= 1 ? v * 100 : v;
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


export function buildSVG(project: Project, opts: ExportOptions = {}): BuiltSVG {
  const { positions, visible, bounds, depths, maxDepth, timeAxis } = computeLayout(project, {
    showEras: !!opts.showEras,
    eraLevel: opts.eraLevel ?? 'both',
  });
  const orientation = project.layout.orientation;
  const activeCharacter = findCharacter(project, opts.activeCharacterId);
  const charRange =
    activeCharacter?.type === 'continuous' ? continuousRange(project, activeCharacter) : undefined;

  const pad = 48;
  // `pad` is measured around the node coordinates, so a long taxon name running
  // past the outermost node would fall outside the viewBox and be cropped — in
  // SVG, PNG and PDF alike. Grow the canvas by whatever the labels actually need.
  const boxes = labelBoxes(project, positions, visible);
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
    kind: 'title' | 'state' | 'event' | 'transition' | 'needsData';
    label: string;
    color?: string;
    color2?: string;
    /** Two-letter code drawn inside an event swatch. */
    code?: string;
  }
  const legendRows: LegendRow[] = [];
  // The transition marks are detected ONCE, here, so the tally printed in
  // the legend is the tally drawn on the branches — and so the two classes
  // (real change vs. missing data) can never be conflated.
  const transitionMarks =
    opts.showTransitions && activeCharacter && activeCharacter.type === 'discrete'
      ? detectTransitions(project, activeCharacter, visible)
      : [];
  if (activeCharacter) {
    legendRows.push({ kind: 'title', label: tr(`性状：${activeCharacter.name}`, `Character: ${activeCharacter.name}`) });
    if (activeCharacter.type === 'discrete') {
      for (const s of activeCharacter.states) legendRows.push({ kind: 'state', label: s.label, color: s.color });
    } else {
      legendRows.push({ kind: 'state', label: tr('低值', 'Low'), color: activeCharacter.lowColor ?? '#dbeafe' });
      legendRows.push({ kind: 'state', label: tr('高值', 'High'), color: activeCharacter.highColor ?? '#1e3a8a' });
    }
    if (opts.showTransitions && activeCharacter.type === 'discrete' && transitionMarks.length > 0) {
      const real = transitionMarks.filter((t) => !t.involvesUnknown).length;
      const unknown = transitionMarks.length - real;
      legendRows.push({ kind: 'title', label: tr('状态转变', 'State transitions') });
      legendRows.push({
        kind: 'transition',
        label: tr(`已知 ↔ 已知（${real} 处）`, `known ↔ known (${real})`),
        color: activeCharacter.states[0]?.color,
        color2: activeCharacter.states[1]?.color,
      });
      if (unknown > 0) {
        legendRows.push({
          kind: 'needsData',
          label: tr(
            `待补数据：端点未赋值（${unknown} 枝，不计入演化转变）`,
            `needs data: endpoint unassigned (${unknown} branch(es), not counted as changes)`,
          ),
        });
      }
    }
  }
  if (opts.showEvents) {
    const used = [...new Set(project.events.map((e) => e.typeId))];
    if (used.length) {
      legendRows.push({ kind: 'title', label: tr('事件', 'Events') });
      for (const tid of used) {
        const t = findEventType(tid);
        if (t) legendRows.push({ kind: 'event', label: t.label, color: t.color, code: t.code });
      }
    }
  }
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
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${safeColour(project.canvas.background, '#ffffff')}"/>`,
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
    const color = branchColorFor(node, project, depths.get(id) ?? 0, maxDepth);
    const caps = branchCaps(bs.shape);
    const d =
      project.layout.type === 'circular'
        ? circularPath(from, to)
        : elbowPath(from, to, orientation);
    const dash = dashArray(bs.dash, bs.width);
    parts.push(
      `<path d="${d}" fill="none" stroke="${safeColour(color)}" stroke-width="${num(bs.width, 1)}" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="${caps.linejoin}" stroke-linecap="${caps.linecap}"/>`,
    );
    // Render branch support value (bootstrap / posterior) near the midpoint.
    if (
      typeof node.support === 'number' &&
      Number.isFinite(node.support) &&
      node.childrenIds.length > 0
    ) {
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      // The dimming threshold is the project's own `supportThreshold` (documented
      // 0–100), so the layout control carries the same documented meaning in the
      // exported figure as it has on the canvas.
      // The stored support is normalised to 0–100 first, so a 0–1 posterior is
      // not judged against a percentage.
      const rawThreshold = project.layout.supportThreshold;
      const threshold =
        typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) ? rawThreshold : 70;
      const supportColor = normalizeSupport(node.support) < threshold ? FIG_AXIS : '#1d1d1f';
      parts.push(
        `<text x="${mx}" y="${my - 3}" text-anchor="middle" font-size="10" font-family="${FONT_FAMILY}" fill="${supportColor}">${escXml(String(node.support))}</text>`,
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
  if (opts.showTransitions && activeCharacter && activeCharacter.type === 'discrete') {
    for (const t of transitionMarks) {
      const from = positions.get(t.parentId);
      const to = positions.get(t.nodeId);
      if (!from || !to) continue;
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      if (t.involvesUnknown) {
        parts.push(
          `<circle cx="${mx}" cy="${my}" r="5.5" fill="#ffffff" stroke="${C_UNKNOWN}" stroke-width="1.6" stroke-dasharray="2.4 1.8"/>`,
        );
        parts.push(
          `<text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="8" font-weight="700" font-family="${FONT_FAMILY}" fill="${C_UNKNOWN}">?</text>`,
        );
        continue;
      }
      const fromColor = activeCharacter.states.find((s) => s.id === t.from)?.color ?? C_UNKNOWN;
      const toColor = activeCharacter.states.find((s) => s.id === t.to)?.color ?? C_TRANSITION_TO;
      parts.push(`<circle cx="${mx}" cy="${my}" r="5.5" fill="#ffffff" stroke="${safeColour(fromColor)}" stroke-width="2"/>`);
      parts.push(`<circle cx="${mx}" cy="${my}" r="3" fill="${safeColour(toColor)}"/>`);
    }
  }

  // --- nodes + labels ---------------------------------------------------------
  for (const id of visible) {
    const node = project.nodes[id];
    const pos = positions.get(id);
    if (!node || !pos) continue;
    const style = resolveNodeStyle(node, project);
    let fill = style.fill;
    let stroke = style.stroke;
    let dashed = false;
    if (activeCharacter) {
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
    if (style.showLabel && node.label) {
      const place = labelPlacement(
        orientation,
        node.childrenIds.length === 0,
        style.size,
        style.labelPosition,
        style.labelOffsetX,
        style.labelOffsetY,
        labelAngleFor(project, positions, node),
      );
      const lx = pos.x + place.dx;
      const ly = pos.y + place.dy;
      const rot = style.labelRotation ? ` transform="rotate(${num(style.labelRotation, 0)} ${lx} ${ly})"` : '';
      parts.push(
        `<text x="${lx}" y="${ly}" text-anchor="${place.anchor}" dominant-baseline="${place.baseline}" font-size="${num(style.fontSize, 12)}" font-style="${style.fontStyle === 'italic' ? 'italic' : 'normal'}" font-weight="${num(Number(style.fontWeight), 400)}"${rot} font-family="${FONT_FAMILY}" fill="${safeColour(style.labelColor)}">${escXml(node.label)}</text>`,
      );
    }
  }

  // --- event badges + causal-chain arrows ------------------------------------
  if (opts.showEvents && project.events.length) {
    const anchors = new Map<string, Point>();
    const groupIdx = new Map<string, number>();
    for (const e of project.events) {
      const p = positions.get(e.nodeId);
      if (!p) continue;
      const key = `${e.nodeId}:${e.target}`;
      const idx = groupIdx.get(key) ?? 0;
      groupIdx.set(key, idx + 1);
      if (e.target === 'branch') {
        const pid = project.nodes[e.nodeId]?.parentId ?? null;
        const pp = pid ? positions.get(pid) : undefined;
        const bx = pp ? (pp.x + p.x) / 2 : p.x;
        const by = pp ? (pp.y + p.y) / 2 : p.y;
        anchors.set(e.id, { x: bx, y: by - 16 - idx * 16 });
      } else {
        // target === 'node': mirror the canvas anchor (EventLayer) — sit on the
        // branch entering the node, offset perpendicular so it stays inside the
        // tree instead of floating beside an internal node's elbow corner.
        const pid = project.nodes[e.nodeId]?.parentId ?? null;
        const pp = pid ? positions.get(pid) : undefined;
        if (pp) {
          const bx = (pp.x + p.x) / 2;
          const by = (pp.y + p.y) / 2;
          const horizontal = orientation === 'LR' || orientation === 'RL';
          const tx = bx + (p.x - bx) * 0.6;
          const ty = by + (p.y - by) * 0.6;
          if (horizontal) anchors.set(e.id, { x: tx, y: ty + 13 + idx * 4 });
          else anchors.set(e.id, { x: tx + 13 + idx * 4, y: ty });
        } else {
          anchors.set(e.id, { x: p.x + 14 + idx * 16, y: p.y + 16 });
        }
      }
    }
    if (project.events.some((e) => e.triggers.length)) {
      defs.push(
        `<marker id="ex-causal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 0 0 L 10 5 L 0 10 z" fill="${FIG_CAUSAL}"/></marker>`,
      );
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
      const color = eventColor(e);
      const sw = e.confidence === 'high' ? 2.5 : 2;
      const cdash = e.confidence === 'low' ? ' stroke-dasharray="2 2"' : '';
      parts.push(
        `<circle cx="${a.x}" cy="${a.y}" r="${EVENT_BADGE_RADIUS}" fill="#ffffff" stroke="${safeColour(color)}" stroke-width="${sw}"${cdash}/>`,
      );
      parts.push(
        `<text x="${a.x}" y="${a.y + 2.7}" text-anchor="middle" font-size="${EVENT_CODE_FONT_SIZE}" font-weight="700" font-family="${FONT_FAMILY}" fill="#111111">${escXml(eventCode(e))}</text>`,
      );
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
        parts.push(`<circle cx="${lx + 6}" cy="${ly - 4}" r="7" fill="#ffffff" stroke="${safeColour(r.color, FIG_LEGEND_BORDER)}" stroke-width="2"/>`);
        parts.push(`<text x="${lx + 6}" y="${ly - 1.3}" text-anchor="middle" font-size="6.5" font-weight="700" font-family="${FONT_FAMILY}" fill="#111111">${escXml(r.code ?? '')}</text>`);
        parts.push(`<text x="${lx + 18}" y="${ly}" font-size="12" font-family="${FONT_FAMILY}" fill="${FIG_LEGEND}">${escXml(r.label)}</text>`);
      }
      ly += 18;
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    parts.join('\n'),
    '</svg>',
  ].join('\n');

  return { svg, width, height };
}

export function exportSVGString(project: Project, opts: ExportOptions = {}): string {
  return buildSVG(project, opts).svg;
}

/** Rasterise the project SVG to a PNG blob at the given pixel scale. */
export async function toPngBlob(project: Project, scale = 2, opts: ExportOptions = {}): Promise<Blob> {
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
  if (fit < 1) s = s * fit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * s);
  canvas.height = Math.ceil(height * s);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.scale(s, s);
  ctx.drawImage(img, 0, 0, width, height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

/** Produce a vector PDF blob using jsPDF + svg2pdf.js (lazy-loaded). */
export async function toPdfBlob(project: Project, opts: ExportOptions = {}): Promise<Blob> {
  const { svg, width, height } = buildSVG(project, opts);
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');
  const doc = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    // Use px units so the SVG's pixel geometry maps 1:1 into the PDF page;
    // 'pt' would treat each SVG px as a point and inflate the output ~1.33x.
    unit: 'px',
    format: [width, height],
  });
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml')
    .documentElement as unknown as SVGSVGElement;
  // svg2pdf augments jsPDF with `.svg()`.
  await (doc as unknown as { svg: (n: Element, o: object) => Promise<unknown> }).svg(el, {
    x: 0,
    y: 0,
    width,
    height,
  });
  return doc.output('blob');
}
