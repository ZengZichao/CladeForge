// Pure logic for the character / state system (evolutionary semantic layer).
//
// Characters are user-defined traits mapped onto the tree. Tips carry observed
// states; internal nodes carry the user's *hypothesised* ancestral states.
// This module holds the framework-agnostic helpers: factory constructors,
// per-node colour resolution (discrete swatch or continuous ramp) and
// state-transition detection along branches. Parsimony-based *suggestions* are
// computed elsewhere (`parsimony.ts`); here nothing is inferred — everything is
// asserted.

import { tr } from '../ui/strings';
import {
  colorDeltaE,
  lerpHexColor,
  wcagContrastRatio,
  type Character,
  type CharacterState,
  type NodeId,
  type Project,
  type TreeNode,
} from './types';
import { newId } from './treeOps';

/** The canvas backgrounds the palette has to stay legible on (app.css tokens
 *  `--canvas-bg`, light and dark). */
export const LIGHT_CANVAS_BG = '#f0f0f2';
export const DARK_CANVAS_BG = '#141416';

/**
 * WCAG 1.4.11 floor for a node fill / legend swatch against the light canvas.
 * Every colour below — curated or generated — is checked against it.
 */
export const MIN_STATE_COLOR_CONTRAST = 3;

/**
 * Distinct palette assigned to new discrete states.
 *
 * Derived from the Okabe–Ito colour-blind-safe set, with the three members that
 * failed as a FILL on the light canvas darkened to clear the contrast floor
 * (measured against `LIGHT_CANVAS_BG` = #f0f0f2, WCAG ratio):
 *   #56b4e9 sky blue 2.03:1 → dropped (its hue is covered by #0072b2)
 *   #e69f00 orange   1.98:1 → #a66100 4.26:1
 *   #f0e442 yellow   1.16:1 → #7f7f00 3.74:1
 *   #999999 grey     2.50:1 → #6e6e76 4.44:1
 * The shipped palette used grey #999999 in place of the Okabe–Ito black; pure
 * #000000 is not an option either (1.14:1 against the dark canvas, i.e.
 * invisible in the dark theme), and #6e6e76 is the neutral that clears 3:1 on
 * BOTH themes. Worst pair in the curated set is ΔE(76) = 23.1
 * (#d55e00 / #a66100); worst light-canvas contrast is 3.01:1 (#009e73).
 */
export const STATE_PALETTE = [
  '#0072b2', // blue (Okabe–Ito)
  '#d55e00', // vermillion (Okabe–Ito)
  '#009e73', // bluish green (Okabe–Ito)
  '#b0517e', // reddish purple (Okabe–Ito #cc79a7, darkened: 2.69 → 4.27)
  '#a66100', // amber (Okabe–Ito orange, darkened)
  '#7f7f00', // olive (Okabe–Ito yellow, darkened)
  '#6e6e76', // neutral grey (Okabe–Ito black, dark-theme-safe substitute)
  '#6a4fa3', // violet
  '#0f6a6a', // teal
  '#4c7a1f', // olive green
];

/** How many states the curated palette covers; beyond this colours are derived. */
export const CURATED_STATE_COLOR_COUNT = STATE_PALETTE.length;

const GOLDEN_ANGLE = 137.50776405003785;

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${seg
    .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/* ---------------------------------------------------------------------------
 * Derived state colours: farthest-point sampling
 *
 * Colours past the curated palette are DERIVED, never reused. Every colour that
 * is legal to begin with (a candidate grid in HSL, filtered by the two
 * canvas-legibility contrast floors) forms a pool, and each next colour is the
 * pool member FARTHEST from everything already chosen, curated palette
 * included. Greedy farthest-point traversal needs no knowledge of the final
 * count, so the colour for state i is unchanged when state i + 1 is created.
 *
 * "Farthest" is the worst over three colour appearances — normal, protanopic,
 * deuteranopic (Machado 2009, severe, applied in linear RGB) — not just normal
 * Lab. The curated set is Okabe–Ito, i.e. picked to survive colour-blindness;
 * an objective that only looks at normal vision would happily spend the
 * separation on hue pairs that collapse again for ~8 % of male readers.
 *
 * Separation of the first N states, worst pair, measured with the two QA
 * helpers below (`stateColorSeparation` / `stateColorDichromatSeparation`):
 *
 *   states            12    16    20    24    30    40
 *   normal          23.1  23.1  22.2  22.2  18.7  15.2
 *   dichromat       19.6  19.6  19.6  19.6  18.4  15.0
 *
 * The dichromat floor of 19.6 is the curated Okabe–Ito set's own worst pair —
 * the sampler holds to it and does not go below it until ~30 states. Past the
 * curated set, colour alone stops being enough: a warning is still right for
 * high cardinality (see `MAX_DISTINGUISHABLE_STATES`), and a non-colour
 * redundancy (direct labels / patterned fills) remains the only true fix there.
 * ------------------------------------------------------------------------- */

type Lab = readonly [number, number, number];
/** The same colour as a normal, a protanopic and a deuteranopic reader sees. */
type Appearance = readonly [Lab, Lab, Lab];

const LINEARIZE = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const DELINEARIZE = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** Machado (2009) severe dichromat approximations, applied to linear RGB. */
const DICHROMAT_MATRICES: readonly (readonly (readonly number[])[])[] = [
  [[2.02396, -1.42818, 0.40433], [-0.49474, 1.23613, 0.25851], [0, 0, 1]],
  [[1.94834, -1.48089, 0.53255], [-0.54367, 1.52733, 0.01634], [-0.02882, 0.31201, 0.71681]],
];

function labOfLinear(r: number, g: number, b: number): Lab {
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function hexToLinearRgb(hex: string): [number, number, number] {
  const v = hex.slice(1);
  const n = Number.parseInt(v, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [LINEARIZE(((n >> 16) & 255) / 255), LINEARIZE(((n >> 8) & 255) / 255), LINEARIZE((n & 255) / 255)];
}

function appearanceOf(hex: string): Appearance {
  const [r, g, b] = hexToLinearRgb(hex);
  const labs: Lab[] = [labOfLinear(r, g, b)];
  for (const m of DICHROMAT_MATRICES) {
    const mix = (row: readonly number[]) =>
      Math.max(0, Math.min(1, row[0] * r + row[1] * g + row[2] * b));
    labs.push(labOfLinear(mix(m[0]), mix(m[1]), mix(m[2])));
  }
  return labs as unknown as Appearance;
}

function appearanceDistance(a: Appearance, b: Appearance): number {
  let worst = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]);
    if (d < worst) worst = d;
  }
  return worst;
}

/** Grid steps chosen so the pool stays ~4 000 entries: the sampler's cost is
 *  linear in the pool, and a finer grid moved the measured separation by <0.2. */
const CANDIDATE_HUE_STEP = 4;
const CANDIDATE_SATURATIONS = [0.4, 0.55, 0.7, 0.85, 1];
const CANDIDATE_LIGHT_MIN = 0.06;
const CANDIDATE_LIGHT_MAX = 0.64;
const CANDIDATE_LIGHT_STEP = 0.025;

interface PoolEntry {
  hex: string;
  app: Appearance;
}

let candidatePool: PoolEntry[] | null = null;

/** Every grid colour that clears both canvas legibility floors. */
function stateColorCandidates(): PoolEntry[] {
  if (candidatePool) return candidatePool;
  const curated = new Set(STATE_PALETTE.map((c) => c.toLowerCase()));
  const seen = new Set<string>();
  const pool: PoolEntry[] = [];
  for (let h = 0; h < 360; h += CANDIDATE_HUE_STEP) {
    for (const s of CANDIDATE_SATURATIONS) {
      for (let l = CANDIDATE_LIGHT_MAX; l >= CANDIDATE_LIGHT_MIN; l -= CANDIDATE_LIGHT_STEP) {
        const hex = hslToHex(h, s, l);
        const key = hex.toLowerCase();
        if (seen.has(key) || curated.has(key)) continue;
        if (
          wcagContrastRatio(hex, LIGHT_CANVAS_BG) < MIN_STATE_COLOR_CONTRAST ||
          wcagContrastRatio(hex, DARK_CANVAS_BG) < 2
        ) {
          continue;
        }
        seen.add(key);
        pool.push({ hex, app: appearanceOf(hex) });
      }
    }
  }
  candidatePool = pool;
  return pool;
}

/** Colours already sampled for indices ≥ CURATED_STATE_COLOR_COUNT, append-only. */
const derivedColors: PoolEntry[] = [];
/** Per pool entry: distance to the nearest already-chosen colour, or -1 if taken. */
let derivedDistances: number[] | null = null;

/**
 * Extend the derived palette until index `upto` has a colour. Each round takes
 * the candidate that is farthest from everything chosen so far and refreshes the
 * running distances, so the whole palette costs O(picks × pool) rather than
 * O(picks² × pool) — the difference between milliseconds and seconds at 200
 * states.
 */
function ensureDerivedColor(upto: number): void {
  const pool = stateColorCandidates();
  const need = upto - CURATED_STATE_COLOR_COUNT + 1;
  if (need <= derivedColors.length) return;
  if (!derivedDistances) {
    const anchors = STATE_PALETTE.map((hex) => appearanceOf(hex));
    derivedDistances = pool.map((entry) => {
      let best = Infinity;
      for (const anchor of anchors) best = Math.min(best, appearanceDistance(entry.app, anchor));
      return best;
    });
  }
  const distances = derivedDistances;
  while (need > derivedColors.length) {
    let at = -1;
    let best = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      if (distances[i] < 0) continue; // already taken
      if (distances[i] > best) {
        best = distances[i];
        at = i;
      }
    }
    if (at < 0 || !Number.isFinite(best)) break; // pool exhausted: fall back below
    const pick = pool[at];
    distances[at] = -1;
    for (let i = 0; i < pool.length; i += 1) {
      if (distances[i] < 0) continue;
      const d = appearanceDistance(pool[i].app, pick.app);
      if (d < distances[i]) distances[i] = d;
    }
    derivedColors.push(pick);
  }
}

/**
 * Last resort when the candidate pool is exhausted (it holds ~4 000 colours, so
 * this is a few thousand states deep): keep stepping the golden angle, which is
 * cheap and never returns a duplicate.
 */
function goldenAngleFallback(index: number): string {
  const generation = Math.floor(index / Math.max(1, CURATED_STATE_COLOR_COUNT));
  const hue = (index * GOLDEN_ANGLE + generation * 11.3) % 360;
  const saturation = Math.max(0.3, 0.8 - 0.09 * (generation % 5));
  let lightness = 0.5;
  for (let i = 0; i < 24; i += 1) {
    const hex = hslToHex(hue, saturation, lightness);
    if (
      wcagContrastRatio(hex, LIGHT_CANVAS_BG) >= MIN_STATE_COLOR_CONTRAST &&
      wcagContrastRatio(hex, DARK_CANVAS_BG) >= 2
    ) {
      return hex;
    }
    lightness -= 0.02;
    if (lightness < 0.08) break;
  }
  return hslToHex(hue, saturation, 0.3);
}

/**
 * The colour for the state created at `index` (0-based). Deterministic, and
 * never returns a colour an earlier index already got for realistic state
 * counts (see the distinctness test).
 */
export function stateColorFor(index: number): string {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  if (i < CURATED_STATE_COLOR_COUNT) return STATE_PALETTE[i];
  ensureDerivedColor(i);
  return derivedColors[i - CURATED_STATE_COLOR_COUNT]?.hex ?? goldenAngleFallback(i);
}

/** True when a character with `stateCount` states has run out of curated fills. */
export function statePaletteExhausted(stateCount: number): boolean {
  return stateCount > CURATED_STATE_COLOR_COUNT;
}

/**
 * Palette QA: worst WCAG contrast against the light canvas among the first
 * `count` state colours. Used by the tests and by any legend that wants to
 * warn about low-confidence colour coding.
 */
export function stateColorContrastFloor(count: number): number {
  let worst = Infinity;
  for (let i = 0; i < Math.max(0, Math.floor(count)); i += 1) {
    worst = Math.min(worst, wcagContrastRatio(stateColorFor(i), LIGHT_CANVAS_BG));
  }
  return worst;
}

/**
 * How many states can still be told apart by colour alone.
 *
 * The bar is the one the shipped tests use: a worst pairwise CIE76 distance of
 * 15 among the first N colours, in normal vision AND under red/green dichromat
 * simulation (`stateColorDichromatSeparation`), because separating colours on a
 * channel some readers do not have is not a separation. Measured on the sampled
 * palette, normal vision holds ≥ 15 through 42 states and the dichromat reading
 * through 39 — the binding one, so that is the number below.
 *
 * Past this many states the honest answer is a warning plus a non-colour
 * redundancy (direct labels / patterned fills), which colour cannot substitute
 * for however well it is chosen.
 */
export const MAX_DISTINGUISHABLE_STATES = 39;

/** A warning once a character outgrows the palette, or null while it is safe. */
export function stateColorLimitWarning(stateCount: number): string | null {
  if (stateCount <= MAX_DISTINGUISHABLE_STATES) return null;
  return `该性状有 ${stateCount} 个状态，超出配色可区分的上限（约 ${MAX_DISTINGUISHABLE_STATES} 个）：第 ${MAX_DISTINGUISHABLE_STATES + 1} 个之后的派生色两两差异已小于肉眼可辨的范围，图例与分支着色可能被误读。建议改用直接标注、图案填充或合并状态。`;
}

/** Palette QA: worst pairwise CIE76 distance among the first `count` colours. */
export function stateColorSeparation(count: number): number {
  const colors = Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => stateColorFor(i));
  let worst = Infinity;
  for (let i = 0; i < colors.length; i += 1) {
    for (let j = i + 1; j < colors.length; j += 1) worst = Math.min(worst, colorDeltaE(colors[i], colors[j]));
  }
  return worst;
}

/**
 * Palette QA: the same worst-pairwise distance, but judged as a red- or
 * green-colour-blind reader sees it (the minimum over protanopic and
 * deuteranopic appearance). A palette that scores well here and badly in
 * `stateColorSeparation` is separating colours on a channel some readers do not
 * have, which is the failure the sampler exists to avoid.
 */
export function stateColorDichromatSeparation(count: number): number {
  const apps = Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => appearanceOf(stateColorFor(i)));
  let worst = Infinity;
  for (let i = 0; i < apps.length; i += 1) {
    for (let j = i + 1; j < apps.length; j += 1) {
      const d = appearanceDistance(apps[i], apps[j]);
      if (d < worst) worst = d;
    }
  }
  return worst;
}

export function newCharacterState(label: string, index = 0): CharacterState {
  return { id: newId(), label, color: stateColorFor(index) };
}

export function newCharacter(name: string): Character {
  return {
    id: newId(),
    name,
    type: 'discrete',
    states: [newCharacterState(tr('状态 1', 'State 1'), 0), newCharacterState(tr('状态 2', 'State 2'), 1)],
  };
}

export function findCharacter(project: Project, characterId: string | null | undefined): Character | undefined {
  if (!characterId) return undefined;
  return project.characters.find((c) => c.id === characterId);
}

/**
 * Standard missing-data codes the character matrix can write straight into a
 * node's state slot ('?' = missing, '-' = not applicable; NEXUS convention).
 * They are NOT observed states: they must never enter the state counts behind
 * CI/RI, a consistency verdict, or a "state transition" on the canvas.
 * Parsimony and Mk ignore them because they are not declared states of the
 * character; the statistics layer has to agree.
 */
export const MISSING_STATE_CODES: readonly string[] = ['?', '-'];

/**
 * True when `value` is a genuine observation for `character`: a declared state
 * id. Undefined values, the missing-data codes, and stale ids left over from a
 * deleted state all mean "no data" (the shared guard for stats / consistency /
 * transition detection, so the three cannot disagree).
 */
export function isObservedState(
  character: Character,
  value: string | number | undefined,
): value is string {
  if (typeof value !== 'string') return false;
  if (MISSING_STATE_CODES.includes(value)) return false;
  return character.states.some((s) => s.id === value);
}

/** Number of nodes carrying a missing-data code rather than a declared state. */
export function missingCodeCount(project: Project, character: Character): number {
  let n = 0;
  for (const node of Object.values(project.nodes)) {
    const v = node.charStates?.[character.id];
    if (typeof v === 'string' && MISSING_STATE_CODES.includes(v)) n += 1;
  }
  return n;
}

/** Human-readable label for a node's value under a character. */
export function stateLabel(character: Character, value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (character.type === 'continuous') return String(value);
  return character.states.find((s) => s.id === value)?.label;
}

function discreteColor(character: Character, value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return character.states.find((s) => s.id === value)?.color;
}

export interface NumRange {
  min: number;
  max: number;
}

/** Observed numeric range of a continuous character across all nodes. */
export function continuousRange(project: Project, character: Character): NumRange {
  let min = Infinity;
  let max = -Infinity;
  for (const node of Object.values(project.nodes)) {
    const v = node.charStates?.[character.id];
    if (typeof v === 'number') {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return { min: 0, max: 1 };
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

/** Fill colour for a node under a character, or undefined when unassigned. */
export function nodeCharacterColor(
  character: Character,
  node: TreeNode,
  range?: NumRange,
): string | undefined {
  const v = node.charStates?.[character.id];
  if (v === undefined) return undefined;
  if (character.type === 'continuous') {
    if (typeof v !== 'number' || !range) return undefined;
    const t = range.max > range.min ? (v - range.min) / (range.max - range.min) : 0;
    return lerpHexColor(character.lowColor ?? '#dbeafe', character.highColor ?? '#1e3a8a', t);
  }
  return discreteColor(character, v);
}

export interface Transition {
  /** Child node; the transition is drawn on the branch entering it. */
  nodeId: NodeId;
  parentId: NodeId;
  from: string | number;
  to: string | number;
  fromLabel: string;
  toLabel: string;
  /**
   * True when at least one endpoint carries no observation (unassigned, or a
   * '?'/'-' missing-data code). Such a branch is a *data prompt*, not evidence
   * of an evolutionary change: unknown ≠ transition, so every
   * count of "state transitions" must filter these out — see
   * `countEvolutionaryTransitions`.
   */
  involvesUnknown: boolean;
}

/**
 * Every branch whose child state differs from its parent state, for a discrete
 * character. A branch where one endpoint has an assigned state and the other
 * is unassigned ("unknown") is still returned — the canvas uses it to prompt
 * the user for missing data — but it is flagged with `involvesUnknown` so
 * statistics, legends and exports never read it as an evolutionary change.
 * Only branches where BOTH endpoints are unassigned (or where both are assigned
 * and equal) are skipped. `visible` optionally restricts detection to on-screen
 * nodes.
 */
export function detectTransitions(
  project: Project,
  character: Character,
  visible?: Set<NodeId>,
): Transition[] {
  if (character.type !== 'discrete') return [];
  const UNKNOWN_LABEL = tr('未知', 'Unknown');
  const out: Transition[] = [];
  for (const node of Object.values(project.nodes)) {
    const parentId = node.parentId;
    if (!parentId) continue;
    if (visible && (!visible.has(node.id) || !visible.has(parentId))) continue;
    // Anything that is not a declared state (missing-data code, stale id) is
    // treated exactly like "no data" here, as everywhere else.
    const rawTo = node.charStates?.[character.id];
    const rawFrom = project.nodes[parentId]?.charStates?.[character.id];
    const to = isObservedState(character, rawTo) ? rawTo : undefined;
    const from = isObservedState(character, rawFrom) ? rawFrom : undefined;
    // Both unassigned → no information, skip.
    if (to === undefined && from === undefined) continue;
    // Both assigned and equal → no change, skip.
    if (to !== undefined && from !== undefined && to === from) continue;
    out.push({
      nodeId: node.id,
      parentId,
      from: from as string | number,
      to: to as string | number,
      fromLabel: from === undefined ? UNKNOWN_LABEL : (stateLabel(character, from) ?? String(from)),
      toLabel: to === undefined ? UNKNOWN_LABEL : (stateLabel(character, to) ?? String(to)),
      involvesUnknown: to === undefined || from === undefined,
    });
  }
  return out;
}

/**
 * Transitions that are genuine evolutionary changes (both endpoints observed).
 * This is the set every statistic, tally and narrative report must use.
 */
export function evolutionaryTransitions(
  project: Project,
  character: Character,
  visible?: Set<NodeId>,
): Transition[] {
  return detectTransitions(project, character, visible).filter((t) => !t.involvesUnknown);
}

/** Number of genuine state changes for `character` on the current tree. */
export function countEvolutionaryTransitions(
  project: Project,
  character: Character,
  visible?: Set<NodeId>,
): number {
  return evolutionaryTransitions(project, character, visible).length;
}
