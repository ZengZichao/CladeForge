// Core data model for CladeForge.
// A Project is a single serialisable document: one rooted tree (adjacency map),
// plus free-form "custom edges" (reticulation / special evolutionary relations),
// layout settings and style defaults.

export type NodeId = string;
export type EdgeId = string;
export type EventId = string;

export type NodeShape = 'circle' | 'square' | 'diamond' | 'none';
export type DashStyle = 'solid' | 'dashed' | 'dotted';

/**
 * Label placement direction relative to the node marker. 'auto' uses the
 * layout-orientation-aware default (far side of the parent); the eight
 * cardinal / intercardinal directions are explicit user overrides.
 */
export type LabelPosition =
  | 'auto'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
/**
 * Visual style of a tree branch:
 *  - `line`        thin stroked polyline (the classic look)
 *  - `rectangular` thick bar with flat ends and sharp (mitred) corners
 *  - `rounded`     thick bar with round ends and rounded corners
 */
export type BranchShape = 'line' | 'rectangular' | 'rounded';
export type LayoutType =
  | 'rectangular-cladogram'
  | 'rectangular-phylogram'
  | 'time-calibrated'
  | 'circular';
export type Orientation = 'LR' | 'RL' | 'TB' | 'BT';
export type LayoutMode = 'auto' | 'manual';

export interface Point {
  x: number;
  y: number;
}

/** Canvas view transform: screen = world * scale + (tx, ty). */
export interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
}

export const IDENTITY_VIEW: ViewTransform = { tx: 40, ty: 40, scale: 1 };

export interface NodeStyle {
  shape: NodeShape;
  size: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  labelColor: string;
  fontSize: number;
  fontStyle: 'normal' | 'italic';
  /** CSS numeric font weight (100–900); 400 = normal, 700 = bold. */
  fontWeight: number;
  /** Label rotation in degrees (clockwise), pivoting on the label anchor. */
  labelRotation: number;
  showLabel: boolean;
  /**
   * Explicit label placement direction. 'auto' (the default) uses the
   * layout-orientation-aware far-side placement. When set to a cardinal /
   * intercardinal direction the label is positioned accordingly.
   */
  labelPosition?: LabelPosition;
  /** Manual X offset (px) applied on top of the label placement. */
  labelOffsetX?: number;
  /** Manual Y offset (px) applied on top of the label placement. */
  labelOffsetY?: number;
}

export interface BranchStyle {
  color: string;
  width: number;
  dash: DashStyle;
  shape: BranchShape;
}

/** Depth-based colour gradient applied to all branches (unless overridden). */
export interface BranchGradient {
  enabled: boolean;
  /** Colour near the root. */
  from: string;
  /** Colour near the tips. */
  to: string;
}

export interface EdgeStyle {
  color: string;
  width: number;
  dash: DashStyle;
  arrow: boolean;
  curvature: number; // 0 = shallow curve, 1 = strong curve
}

// --- character / state system (evolutionary semantic layer) ------------------

export type CharacterType = 'discrete' | 'continuous';

/** One possible value of a discrete character (e.g. "aquatic"), with a colour. */
export interface CharacterState {
  id: string;
  label: string;
  color: string;
}

/**
 * A user-defined trait mapped onto the tree. Discrete characters carry an
 * ordered list of coloured states; continuous characters carry numeric values
 * (states is empty) shaded along a two-colour ramp.
 */
export interface Character {
  id: string;
  name: string;
  type: CharacterType;
  states: CharacterState[];
  description?: string;
  /** Ramp endpoints for continuous characters. */
  lowColor?: string;
  highColor?: string;
  /**
   * Optional Sankoff step matrix: `costMatrix[i][j]` is the cost of a change
   * from state i to state j (indices follow `states` order). Undefined means
   * uniform cost (Fitch parsimony: 0 on the diagonal, 1 elsewhere).
   */
  costMatrix?: number[][];
}

export type Confidence = 'high' | 'medium' | 'low';

/** Confidence + evidence attached to a hypothesis (an event or an ancestral state). */
export interface HypothesisMeta {
  confidence?: Confidence;
  support?: string;
  against?: string;
}

/**
 * An annotated evolutionary event placed on a node or on the branch entering a
 * node. `typeId` keys into the event-type catalogue (see model/events.ts);
 * `triggers` lists downstream events for the causal-chain overlay.
 */
export interface EvolutionaryEvent {
  id: EventId;
  typeId: string;
  target: 'node' | 'branch';
  nodeId: NodeId;
  label?: string;
  note?: string;
  confidence?: Confidence;
  support?: string;
  against?: string;
  triggers: EventId[];
}

/** A named alternative hypothesis over the shared topology (see model/layers.ts). */
export interface HypothesisLayer {
  id: string;
  name: string;
}

/**
 * A dated environmental / geological context event overlaid on the time axis
 * (climate shift, continental break-up, impact, mass extinction, …). Ages are
 * "before present" in the project time unit; a point event has from === to.
 */
export interface EnvironmentalEvent {
  id: string;
  label: string;
  from: number;
  to: number;
  color: string;
  note?: string;
}

/**
 * Saved hypothesis overlay for a non-active layer: internal-node ancestral
 * states + their confidence/evidence, and the event set. Tip (observed) states
 * are shared across layers and are not stored here.
 */
export interface StoredLayer {
  states: Record<NodeId, Record<string, string | number>>;
  meta: Record<NodeId, Record<string, HypothesisMeta>>;
  events: EvolutionaryEvent[];
}

export interface TreeNode {
  id: NodeId;
  label: string;
  parentId: NodeId | null;
  childrenIds: NodeId[];
  branchLength?: number;
  support?: number;
  /** Node age (time before present) in the project's time unit; used by the time-calibrated layout. */
  age?: number;
  /** Manual position override in world coordinates. */
  position?: Point;
  /** When true the node keeps its manual position and is ignored by auto-layout. */
  pinned?: boolean;
  collapsed?: boolean;
  style?: Partial<NodeStyle>;
  /** Style of the branch leading INTO this node (from its parent). */
  branchStyle?: Partial<BranchStyle>;
  /**
   * Character-state assignments keyed by character id. On a tip this is an
   * observed/known state; on an internal node it is the user's *hypothesised*
   * ancestral state. Discrete characters store a state id, continuous a number.
   */
  charStates?: Record<string, string | number>;
  /** Confidence / evidence for this node's ancestral-state hypotheses, per character. */
  charMeta?: Record<string, HypothesisMeta>;
  meta?: Record<string, unknown>;
}

export interface CustomEdge {
  id: EdgeId;
  sourceId: NodeId;
  targetId: NodeId;
  label?: string;
  style: EdgeStyle;
}

/** A fossil calibration point for time-calibrated layouts. */
export interface CalibrationPoint {
  id: string;
  nodeId: NodeId;
  minAge: number;
  maxAge: number;
  label?: string;
}

// --- gene-tree / species-tree reconciliation (DTL) ---------------------------

/**
 * The event a user asserts (or the solver infers) for a GENE node mapped onto
 * the species tree: speciation / duplication / transfer. Losses are counted
 * separately, along the branch entering the node.
 */
export type ReconEventType = 'speciation' | 'duplication' | 'transfer';

/** Manual assumption for one GENE-node placement in the species tree. */
export interface GeneNodeAssumption {
  /**
   * Mapped species-tree node. Internal gene nodes may sit on any species node.
   * A gene TIP normally maps to a species TIP; on an internal node it means "the
   * lineage ended here", which only that reading makes sense — and it is what the
   * solver writes for a lineage it bought out — so the placement must carry at
   * least one `losses` or `validateScenario` flags it as unsupported.
   */
  speciesNode: NodeId;
  /**
   * Event classifying HOW this gene node sits on its mapping (internal nodes
   * only; undefined = not yet resolved). Leaves never carry an event.
   */
  event?: ReconEventType;
  /** Asserted number of losses along the incoming branch of this gene node. */
  losses?: number;
  /** Confidence + supporting/counter evidence for this placement hypothesis. */
  meta?: HypothesisMeta;
}

/**
 * One gene tree embedded in the project document. Stored as a full standalone
 * mini-Project so parsing (newick/nexus), topology helpers and computeLayout
 * all work on it unchanged. Topology is read-only in the UI — assumptions key
 * by gene node id and would be invalidated by structural edits.
 */
export interface GeneTreeEntry {
  id: string;
  name: string;
  doc: Project;
  /** Manual per-gene-node reconciliation assumptions (the editable scenario). */
  assumptions: Record<NodeId, GeneNodeAssumption>;
}

/** Costs driving the DTL dynamic-programming optimum. */
export interface ReconCosts {
  dup: number;
  transfer: number;
  loss: number;
}

export const DEFAULT_RECON_COSTS: ReconCosts = { dup: 1, transfer: 2, loss: 1 };

export interface LayoutSettings {
  mode: LayoutMode;
  type: LayoutType;
  orientation: Orientation;
  /** Spacing between successive depth levels (px). */
  hGap: number;
  /** Spacing between adjacent leaves / siblings (px). */
  vGap: number;
  /** Unit label for node ages in the time-calibrated layout (e.g. "Ma"). */
  timeUnit?: string;
  /** Support threshold (0–100); branches below this are drawn dashed/lighter. */
  supportThreshold?: number;
  /** When true, nodes with support below the threshold are auto-collapsed. */
  collapseBelowThreshold?: boolean;
}

export interface CanvasSettings {
  width: number;
  height: number;
  background: string;
}

export interface StyleDefaults {
  node: NodeStyle;
  branch: BranchStyle;
  edge: EdgeStyle;
  branchGradient: BranchGradient;
}

export interface Project {
  id: string;
  name: string;
  version: string;
  nodes: Record<NodeId, TreeNode>;
  rootId: NodeId;
  customEdges: CustomEdge[];
  layout: LayoutSettings;
  canvas: CanvasSettings;
  defaults: StyleDefaults;
  /** User-defined characters (traits) mapped onto the tree. */
  characters: Character[];
  /** Annotated evolutionary events (speciation, extinction, key innovation, …). */
  events: EvolutionaryEvent[];
  /** Named hypothesis layers over the shared topology. */
  layers: HypothesisLayer[];
  /** Id of the layer whose hypotheses currently live on the nodes / events. */
  activeLayerId: string;
  /** Saved hypothesis data for the NON-active layers (active layer lives on nodes). */
  layerStore: Record<string, StoredLayer>;
  /** Dated environmental-context events drawn on the time axis. */
  environmentalEvents: EnvironmentalEvent[];
  /** Fossil calibration points for time-calibrated layouts. */
  calibrationPoints: CalibrationPoint[];
  /** Embedded gene trees for species-tree reconciliation. */
  geneTrees?: GeneTreeEntry[];
  /** Costs for the DTL dynamic-programming optimum. */
  reconCosts?: ReconCosts;
  /**
   * Stable id into the built-in sample catalogue (`sampleTree.ts`), set when the
   * document was created from a sample card. It lets the app rebuild a still
   * untouched sample in the other language on a locale switch, so sample content
   * follows the UI language instead of staying frozen in the language that was
   * active when the card was clicked.
   */
  sampleId?: string;
}

export const PROJECT_VERSION = '0.1.0';

export const DEFAULT_NODE_STYLE: NodeStyle = {
  shape: 'circle',
  size: 6,
  fill: '#ffffff',
  stroke: '#222222',
  strokeWidth: 1.5,
  labelColor: '#111111',
  fontSize: 14,
  fontStyle: 'normal',
  fontWeight: 400,
  labelRotation: 0,
  showLabel: true,
  labelPosition: 'auto',
  labelOffsetX: 0,
  labelOffsetY: 0,
};

export const DEFAULT_BRANCH_STYLE: BranchStyle = {
  color: '#333333',
  width: 1.5,
  dash: 'solid',
  shape: 'line',
};

export const DEFAULT_BRANCH_GRADIENT: BranchGradient = {
  enabled: false,
  from: '#2563eb',
  to: '#dc2626',
};

export const DEFAULT_EDGE_STYLE: EdgeStyle = {
  color: '#d1495b',
  width: 1.75,
  dash: 'dashed',
  arrow: true,
  curvature: 0.35,
};

export const DEFAULT_LAYOUT: LayoutSettings = {
  mode: 'auto',
  type: 'rectangular-cladogram',
  orientation: 'LR',
  hGap: 150,
  vGap: 46,
  timeUnit: 'Ma',
};

export const DEFAULT_CANVAS: CanvasSettings = {
  width: 1600,
  height: 1000,
  background: '#ffffff',
};

export function defaultStyleDefaults(): StyleDefaults {
  return {
    node: { ...DEFAULT_NODE_STYLE },
    branch: { ...DEFAULT_BRANCH_STYLE },
    edge: { ...DEFAULT_EDGE_STYLE },
    branchGradient: { ...DEFAULT_BRANCH_GRADIENT },
  };
}

/** Effective node style = project defaults overlaid with per-node overrides. */
export function resolveNodeStyle(node: TreeNode, project: Project): NodeStyle {
  return { ...project.defaults.node, ...node.style };
}

/** Effective branch style for the edge entering `node`. */
export function resolveBranchStyle(node: TreeNode, project: Project): BranchStyle {
  return { ...project.defaults.branch, ...node.branchStyle };
}

export function dashArray(dash: DashStyle, width: number): string | undefined {
  switch (dash) {
    case 'dashed':
      return `${width * 4} ${width * 3}`;
    case 'dotted':
      return `${width} ${width * 2}`;
    default:
      return undefined;
  }
}

/** SVG stroke line-cap / line-join implied by a branch shape. */
export function branchCaps(shape: BranchShape): {
  linecap: 'butt' | 'round';
  linejoin: 'miter' | 'round';
} {
  switch (shape) {
    case 'rectangular':
      return { linecap: 'butt', linejoin: 'miter' };
    case 'rounded':
      return { linecap: 'round', linejoin: 'round' };
    case 'line':
    default:
      return { linecap: 'round', linejoin: 'round' };
  }
}

/**
 * Coerce a font weight to a numeric CSS weight. Tolerates the legacy
 * `'normal' | 'bold'` strings that may still live in older saved projects.
 */
export function fontWeightValue(weight: number | string | undefined): number {
  if (typeof weight === 'number') return weight;
  if (weight === 'bold') return 700;
  return 400;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function channelHex(v: number): string {
  // A non-finite channel would survive Math.round as NaN and stringify to
  // "NaNaNa" — an invalid colour handed to the SVG/PDF writer. The
  // documented fallback is 0 (black), so a corrupt value degrades to a legal
  // colour instead of to garbage.
  const c = Number.isFinite(v) ? Math.max(0, Math.min(255, Math.round(v))) : 0;
  return c.toString(16).padStart(2, '0');
}

/** Linearly interpolate between two `#rrggbb` colours (t clamped to [0,1]).
 *  A non-finite `t` (a corrupt ramp parameter, a 0/0 ratio upstream) reaches
 *  `channelHex` as NaN and lands on its documented fallback, so the result is
 * `#000000` — never the illegal `#NaNaNa`. */
export function lerpHexColor(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  if (!a || !b) return from;
  const k = Math.max(0, Math.min(1, t));
  return `#${channelHex(a.r + (b.r - a.r) * k)}${channelHex(a.g + (b.g - a.g) * k)}${channelHex(
    a.b + (b.b - a.b) * k,
  )}`;
}

/**
 * sRGB relative luminance (WCAG 2.x) of a `#rrggbb` colour; 0 for anything
 * unparsable, so a corrupt value reads as "black" rather than as NaN.
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** WCAG contrast ratio (1 … 21) between two `#rrggbb` colours. */
export function wcagContrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * CIE76 colour distance in D65 Lab: ~0 means indistinguishable, ≥ 23 is an
 * obvious difference side by side. Used to keep the discrete-state palette from
 * handing out two colours a reader cannot tell apart in a legend.
 */
export function colorDeltaE(a: string, b: string): number {
  const toLab = (hex: string): [number, number, number] => {
    const rgb = hexToRgb(hex);
    if (!rgb) return [0, 0, 0];
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = lin(rgb.r);
    const g = lin(rgb.g);
    const b2 = lin(rgb.b);
    const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b2) / 0.95047);
    const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b2);
    const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b2) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  };
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * Effective branch colour for the edge entering `node`, honouring an optional
 * depth-based gradient. A per-node branch colour always wins over the gradient.
 */
export function branchColorFor(
  node: TreeNode,
  project: Project,
  depth: number,
  maxDepth: number,
): string {
  const gradient = project.defaults.branchGradient;
  if (gradient?.enabled && node.branchStyle?.color === undefined) {
    return lerpHexColor(gradient.from, gradient.to, maxDepth > 0 ? depth / maxDepth : 0);
  }
  return resolveBranchStyle(node, project).color;
}
