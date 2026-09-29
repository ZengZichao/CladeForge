// Geological time scale + time-axis geometry for the geological time chart
// (time-calibrated layout).
//
// Ages are "time before present" in the project's time unit. Present = 0, older
// = larger. The axis renders numeric ticks always, and optionally the
// geological time scale as coloured bands (meaningful when ages are entered in
// Ma): eons (宙), periods (纪) or both, per the Time panel's display level.

import type { Orientation } from '../model/types';
import { tr } from '../ui/strings';

export interface GeoInterval {
  label: string;
  /** English label — picked at display time when the UI language is EN. */
  labelEn: string;
  /** Start (younger edge) in Ma before present. */
  start: number;
  /** End (older edge) in Ma before present. */
  end: number;
  color: string;
}

/** Which rank(s) of the geological time scale to draw behind the tree. */
export type EraLevel = 'eon' | 'period' | 'both';

/** ICS eons (宙), Ma before present, youngest first. */
export const GEO_EONS: GeoInterval[] = [
  { label: '显生宙', labelEn: 'Phanerozoic', start: 0, end: 538.8, color: '#bbf7d0' },
  { label: '元古宙', labelEn: 'Proterozoic', start: 538.8, end: 2500, color: '#fbcfe8' },
  { label: '太古宙', labelEn: 'Archean', start: 2500, end: 4000, color: '#ddd6fe' },
  { label: '冥古宙', labelEn: 'Hadean', start: 4000, end: 4600, color: '#fecaca' },
];

/**
 * ICS geological periods (纪), Ma before present, youngest first. Complete
 * formal list: the twelve Phanerozoic periods plus the Precambrian periods
 * (Neoproterozoic: Ediacaran / Cryogenian / Tonian; Mesoproterozoic: Stenian /
 * Ectasian / Calymmian; Paleoproterozoic: Statherian / Orosirian / Rhyacian /
 * Siderian). The Archean and Hadean eons have no formal periods — those spans
 * are covered by the eon layer.
 */
export const GEO_PERIODS: GeoInterval[] = [
  { label: '第四纪', labelEn: 'Quaternary', start: 0, end: 2.58, color: '#fef9c3' },
  { label: '新近纪', labelEn: 'Neogene', start: 2.58, end: 23.03, color: '#fde68a' },
  { label: '古近纪', labelEn: 'Paleogene', start: 23.03, end: 66, color: '#fdba74' },
  { label: '白垩纪', labelEn: 'Cretaceous', start: 66, end: 145, color: '#bbf7d0' },
  { label: '侏罗纪', labelEn: 'Jurassic', start: 145, end: 201.4, color: '#a7f3d0' },
  { label: '三叠纪', labelEn: 'Triassic', start: 201.4, end: 251.9, color: '#c7d2fe' },
  { label: '二叠纪', labelEn: 'Permian', start: 251.9, end: 298.9, color: '#fbcfe8' },
  { label: '石炭纪', labelEn: 'Carboniferous', start: 298.9, end: 358.9, color: '#d9f99d' },
  { label: '泥盆纪', labelEn: 'Devonian', start: 358.9, end: 419.2, color: '#bae6fd' },
  { label: '志留纪', labelEn: 'Silurian', start: 419.2, end: 443.8, color: '#ddd6fe' },
  { label: '奥陶纪', labelEn: 'Ordovician', start: 443.8, end: 485.4, color: '#99f6e4' },
  { label: '寒武纪', labelEn: 'Cambrian', start: 485.4, end: 538.8, color: '#fecaca' },
  { label: '埃迪卡拉纪', labelEn: 'Ediacaran', start: 538.8, end: 635, color: '#fed7aa' },
  { label: '成冰纪', labelEn: 'Cryogenian', start: 635, end: 720, color: '#a5f3fc' },
  { label: '拉伸纪', labelEn: 'Tonian', start: 720, end: 1000, color: '#f5d0fe' },
  { label: '狭带纪', labelEn: 'Stenian', start: 1000, end: 1200, color: '#c4b5fd' },
  { label: '延展纪', labelEn: 'Ectasian', start: 1200, end: 1400, color: '#a5b4fc' },
  { label: '盖层纪', labelEn: 'Calymmian', start: 1400, end: 1600, color: '#93c5fd' },
  { label: '稳化纪', labelEn: 'Statherian', start: 1600, end: 1800, color: '#fda4af' },
  { label: '造山纪', labelEn: 'Orosirian', start: 1800, end: 2050, color: '#f9a8d4' },
  { label: '层侵纪', labelEn: 'Rhyacian', start: 2050, end: 2300, color: '#d8b4fe' },
  { label: '成铁纪', labelEn: 'Siderian', start: 2300, end: 2500, color: '#d6d3d1' },
];

/**
 * Tick ages over [0, max]. "Nice" here means a round step — NOT a step that is
 * allowed to run past the data: a loop condition like `t <= max + step/2` would
 * emit a final tick up to half a step BEYOND the oldest node, so a 4 600-unit
 * tree could be labelled up to 5 000, a tick claiming an age no node has.
 * Ticks stop at or below `max`; the band edge still marks the real maximum.
 */
export function niceTicks(max: number, count = 6): number[] {
  // Guard non-finite / non-positive input: an Infinity here would make `step`
  // Infinity and the tick loop never terminate.
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rawStep = max / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = mag * (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10);
  if (!Number.isFinite(step) || step <= 0) return [0];
  const ticks: number[] = [];
  // A relative epsilon only: it must never let a tick land past `max`.
  const eps = Math.max(1e-9, Math.abs(max) * Number.EPSILON * 4);
  let prev = Number.NaN;
  for (let t = 0; t <= max + eps; t += step) {
    const v = Math.min(max, Math.round(t * 1000) / 1000);
    if (v === prev) continue; // sub-milliunit domains collapse when rounded
    ticks.push(v);
    prev = v;
  }
  return ticks.length ? ticks : [0];
}

export interface TimeAxisInfo {
  /** true when the depth axis is horizontal (LR / RL). */
  horizontal: boolean;
  unit: string;
  /** Oldest age represented on the axis. */
  maxAge: number;
  /**
   * Multiplier from `unit` to Ma (so `age * maFactor` is a Ma age), or null when
   * the project's time unit is not a recognised geological one.
   */
  maFactor: number | null;
  /**
   * False when the geological bands would be meaningless: an unknown unit, or
   * ages that do not reach the Phanerozoic. The renderer must not paint eon /
   * period bands over an axis it cannot place them on.
   */
  bandsMeaningful: boolean;
  /** Map any age to its world coordinate along the depth axis. */
  ageToCoord: (age: number) => number;
  /** Numeric ticks: age + world coordinate along the depth axis. */
  ticks: { age: number; coord: number }[];
  /** Eon bands (宙) clipped to the axis range, as world coordinates. */
  eons: { label: string; color: string; a: number; b: number }[];
  /** Period bands (纪) clipped to the axis range, as world coordinates. */
  periods: { label: string; color: string; a: number; b: number }[];
  /** Extent perpendicular to the depth axis (for drawing full-span lines/bands). */
  breadthMin: number;
  breadthMax: number;
}

/**
 * Recognised age units and their size in Ma. `GEO_EONS` / `GEO_PERIODS` are
 * defined in Ma (types of the ICS chart), so any other unit has to be converted
 * before a boundary can be placed on the axis — otherwise a tree labelled in ka
 * or Ga gets Phanerozoic bands off by a factor of 10³ in each direction.
 */
export const TIME_UNIT_TO_MA: Record<string, number> = {
  ma: 1,
  myr: 1,
  mya: 1,
  ka: 1e-3,
  kyr: 1e-3,
  kya: 1e-3,
  ga: 1e3,
  gyr: 1e3,
  gya: 1e3,
  yr: 1e-6,
  year: 1e-6,
  years: 1e-6,
};

/** Factor from `unit` to Ma, or null for an unrecognised label. */
export function timeUnitToMa(unit: string | undefined): number | null {
  if (typeof unit !== 'string') return null;
  const key = unit.trim().toLowerCase().replace(/\s+/g, '');
  return Object.prototype.hasOwnProperty.call(TIME_UNIT_TO_MA, key)
    ? TIME_UNIT_TO_MA[key]
    : null;
}

/**
 * Build the time-axis geometry. `ageToCoord` maps an age to its world coordinate
 * along the depth axis (already including the layout normalisation shift).
 *
 * The ICS boundaries are stored in Ma; the project may label its axis in ka / Ga
 * / anything else, so each boundary is converted into the project's unit before
 * being clipped to `[0, maxAge]`. An unrecognised unit gets no bands at all
 * rather than bands placed on a guess.
 */
export function buildTimeAxis(
  maxAge: number,
  ageToCoord: (age: number) => number,
  orientation: Orientation,
  unit: string,
  breadthMin: number,
  breadthMax: number,
): TimeAxisInfo {
  const horizontal = orientation === 'LR' || orientation === 'RL';
  const ticks = niceTicks(maxAge).map((age) => ({ age, coord: ageToCoord(age) }));
  const maFactor = timeUnitToMa(unit);
  // Divide a Ma boundary by the factor to express it in the project's unit.
  const toUnit = (ma: number): number => (maFactor ? ma / maFactor : ma);
  const clip = (list: GeoInterval[]): TimeAxisInfo['eons'] => {
    const out: TimeAxisInfo['eons'] = [];
    if (maFactor === null) return out; // unknown unit: nothing can be placed
    for (const p of list) {
      const from = Math.max(0, toUnit(p.start));
      const to = Math.min(maxAge, toUnit(p.end));
      if (to <= from) continue;
      out.push({
        label: tr(p.label, p.labelEn),
        color: p.color,
        a: ageToCoord(from),
        b: ageToCoord(to),
      });
    }
    return out;
  };
  const eons = clip(GEO_EONS);
  const periods = clip(GEO_PERIODS);
  return {
    horizontal,
    unit,
    maxAge,
    maFactor,
    bandsMeaningful: maFactor !== null && eons.length + periods.length > 0,
    ageToCoord,
    ticks,
    eons,
    periods,
    breadthMin,
    breadthMax,
  };
}

// --- collision-free label placement -------------------------------------------
//
// Era / event labels are stacked in LANES running outward from the axis edge
// (the top edge for LR/RL trees, the left edge for TB/BT). A band wide enough
// for its label keeps the label inside the band, centred; a narrow band
// ROTATES its label to run along the band, so it can never touch its
// neighbours. Anything that still doesn't fit falls through to lane packing,
// which stacks it into the first lane with free space (the renderer draws a
// thin leader line down to the band). This is what keeps the dozen-odd period
// labels of the Phanerozoic readable when the axis spans 4600 Ma.

/** Vertical distance (world px) between consecutive label lanes. */
export const ERA_LANE_HEIGHT = 14;
/** Horizontal breathing room (world px) between neighbouring labels. */
export const ERA_LABEL_GAP = 6;
/** Minimum band width (world px) for a rotated in-band label to be readable:
 *  one column of fontSize-11 glyphs (ascent + descent ≈ 13 px). */
export const ERA_ROT_MIN = 13;

/**
 * The shared glyph-width rule lives in `canvas/labelBounds`, which is the light
 * metric module both this axis planner and the figure bounds can import without
 * pulling the UI string table into the canvas render path. Re-exported here so
 * call sites and tests keep one import path.
 */
export { estimateLabelWidth } from '../canvas/labelBounds';
import { estimateLabelWidth } from '../canvas/labelBounds';

export interface BandLabelInput {
  key: string;
  /** Band extent along the depth axis (world coordinates, any order). */
  lo: number;
  hi: number;
  label: string;
  /** Estimated rendered label width at its font size. */
  width: number;
  /** First lane this label may occupy (later ranks start further out). */
  baseLane: number;
  /** Allow rotating into a too-narrow band (era labels; event labels aren't). */
  rotatable?: boolean;
}

export interface PlacedBandLabel {
  key: string;
  /** Lane index from the axis edge; -1 marks a rotated in-band label. */
  lane: number;
  rotated: boolean;
  /** Label centre along the depth axis (world coordinates). */
  center: number;
}

export function placeBandLabels(
  items: BandLabelInput[],
  clampTo?: { min: number; max: number },
): PlacedBandLabel[] {
  const lanes: { center: number; width: number }[][] = [];
  const out: PlacedBandLabel[] = [];
  for (const it of items) {
    const lo = Math.min(it.lo, it.hi);
    const hi = Math.max(it.lo, it.hi);
    const extent = hi - lo;
    const mid = (lo + hi) / 2;
    // A rotatable label in a band too narrow for horizontal text rotates to
    // run along the band instead — it stays inside its own band, so it cannot
    // collide with anything and consumes no lane.
    if (it.rotatable && extent < it.width + ERA_LABEL_GAP && extent >= ERA_ROT_MIN) {
      out.push({ key: it.key, lane: -1, rotated: true, center: mid });
      continue;
    }
    const center = clampTo
      ? Math.min(clampTo.max, Math.max(clampTo.min, mid))
      : mid;
    let lane = it.baseLane;
    for (;;) {
      const bucket = lanes[lane] ?? [];
      const clash = bucket.some(
        (p) => Math.abs(p.center - center) < (p.width + it.width) / 2 + ERA_LABEL_GAP,
      );
      if (!clash) break;
      lane += 1;
    }
    (lanes[lane] ??= []).push({ center, width: it.width });
    out.push({ key: it.key, lane, rotated: false, center });
  }
  return out;
}

// --- shared overlay plan (canvas + exporters) ---------------------------------

export interface PlacedAxisLabel extends PlacedBandLabel {
  label: string;
  baseLane: number;
  bandLo: number;
  bandHi: number;
}

export interface EraOverlayPlan {
  /** Era bands in draw order (eons first, then periods). */
  bands: { key: string; color: string; lo: number; hi: number }[];
  /** Placed era labels; `lane: -1` marks rotated in-band labels. */
  labels: PlacedAxisLabel[];
  /** Placed environmental-event labels (always horizontal, lane-packed). */
  env: { id: string; label: string; lane: number; center: number }[];
}

/**
 * Compose everything drawn at the axis edge — era bands, era labels and
 * environmental-event labels — with collision-free label placement. Shared by
 * the on-canvas TimeAxis overlay and the SVG/PNG/PDF exporters so exported
 * figures match the screen.
 *
 * Zones keep the groups apart by construction: era and environmental-event
 * labels are stacked OUTWARD from the band edge (above it for LR/RL trees,
 * left of it for TB/BT), clear of the tree's own node labels which sit just
 * inside the edge; event labels are packed into lanes beyond the era rows.
 * Lanes within the zone are packed so labels never overlap, and bands too
 * narrow for horizontal text rotate their label to run along the band
 * instead.
 */
export function planEraOverlay(
  info: TimeAxisInfo,
  opts: { showEras: boolean; eraLevel: EraLevel },
  envEvents: { id: string; label: string; from: number; to: number }[],
  fontSize = 11,
): EraOverlayPlan {
  const showEons = opts.showEras && opts.eraLevel !== 'period';
  const showPeriods = opts.showEras && opts.eraLevel !== 'eon';

  const bands: EraOverlayPlan['bands'] = [];
  const inputs: BandLabelInput[] = [];
  const meta = new Map<string, { label: string; lo: number; hi: number }>();
  const addRank = (list: TimeAxisInfo['eons'], prefix: string, baseLane: number) => {
    for (const b of list) {
      const lo = Math.min(b.a, b.b);
      const hi = Math.max(b.a, b.b);
      const key = `${prefix}:${b.label}`;
      bands.push({ key, color: b.color, lo, hi });
      meta.set(key, { label: b.label, lo, hi });
      inputs.push({
        key,
        lo,
        hi,
        label: b.label,
        width: estimateLabelWidth(b.label, fontSize),
        baseLane,
        rotatable: true,
      });
    }
  };
  // With both ranks shown, eons take the row closest to the band and periods
  // the row beyond it.
  if (showEons) addRank(info.eons, 'eon', 0);
  if (showPeriods) addRank(info.periods, 'period', showEons ? 1 : 0);

  // Clamp horizontal label centres into the drawn axis extent (tick span) so
  // edge bands keep their labels visible.
  let clampTo: { min: number; max: number } | undefined;
  if (info.ticks.length > 1) {
    const cs = info.ticks.map((t) => t.coord);
    clampTo = { min: Math.min(...cs), max: Math.max(...cs) };
  }
  const placed = placeBandLabels(inputs, clampTo);
  const labels: PlacedAxisLabel[] = placed.map((p) => {
    const m = meta.get(p.key)!;
    return { ...p, label: m.label, baseLane: inputs.find((i) => i.key === p.key)!.baseLane, bandLo: m.lo, bandHi: m.hi };
  });

  // Environmental-event labels share the zone above the band edge with the
  // era labels, packed AFTER them so the two groups never share a row.
  const eraLanes = placed.filter((p) => p.lane >= 0).map((p) => p.lane);
  const envBase = eraLanes.length ? Math.max(...eraLanes) + 1 : 0;
  const envInputs: BandLabelInput[] = envEvents.map((e) => {
    const a = info.ageToCoord(e.from);
    const b = info.ageToCoord(e.to);
    return {
      key: `env:${e.id}`,
      lo: Math.min(a, b),
      hi: Math.max(a, b),
      label: e.label,
      width: estimateLabelWidth(e.label, fontSize),
      baseLane: envBase,
    };
  });
  const envPlaced = placeBandLabels(envInputs, clampTo);
  const env = envPlaced.map((p) => {
    const e = envEvents.find((ev) => `env:${ev.id}` === p.key)!;
    return { id: e.id, label: e.label, lane: p.lane, center: p.center };
  });

  return { bands, labels, env };
}
