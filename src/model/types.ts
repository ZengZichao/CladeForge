// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Core data model for CladeForge.
// A Project is a single serialisable document: one rooted tree (adjacency map),
// plus free-form "custom edges" (reticulation / special evolutionary relations),
// layout settings and style defaults.

export type NodeId = string;
export type EdgeId = string;
export type EventId = string;

/**
 * What a node's `support` number MEASURES. The statistics are not
 * interchangeable — an SH-aLRT of 90 and a Bayesian posterior of 0.90 are
 * different quantities that must not share one threshold line — so every
 * consumer that turns support into visuals (dashing, dimming, printing)
 * should know the kind before it compares.
 */
export type SupportKind = 'bootstrap' | 'posterior' | 'sh-alrt' | 'consensus-frequency' | 'other';
/** Scale a support value is stored in. Import lets the user declare it explicitly. */
export type SupportScale = 'fraction' | 'percent';

/** Where a node's `age` (and its interval) came from. Drives labelling of estimated ages. */
export type AgeSource = 'fossil' | 'clock' | 'estimate' | 'manual';

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
 *  - `curved`      smooth cubic "tube" branch (ported from PhyloRecViewer)
 *  - `rectangular` thick bar with flat ends and sharp (mitred) corners
 *  - `rounded`     thick bar with round ends and rounded corners
 */
export type BranchShape = 'line' | 'curved' | 'rectangular' | 'rounded';
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

/**
 * The model a discrete character's cost matrix encodes. 'unordered' is Fitch
 * (all changes cost 1), 'wagner' an ordered linear gradient, 'dollo' an
 * irreversible gain (changes back to the derived state are forbidden), and
 * 'custom' any hand-edited matrix. The model drives matrix presets in the UI
 * and decides which homoplasy wording is scientifically meaningful (C3).
 */
export type CharacterModel = 'unordered' | 'wagner' | 'dollo' | 'custom';

/** Where a character's colours are painted: node markers or branches. */
export type CharacterColorTarget = 'node' | 'branch';

/** One possible value of a discrete character (e.g. "State A"), with a colour. */
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
   * uniform cost (Fitch parsimony: 0 on the diagonal, 1 elsewhere). `Infinity`
   * is a legal entry and forbids a transition outright; only NaN falls back.
   */
  costMatrix?: number[][];
  /** Which standard model the cost matrix implements (drives presets and C3 wording). */
  model?: CharacterModel;
  /**
   * Relative weight of this character in cross-character aggregates (weighted
   * CI summaries, correlation families). 1 = unweighted.
   */
  weight?: number;
}

export type Confidence = 'high' | 'medium' | 'low';

/**
 * Badge shapes an evolutionary event can be drawn with. The default is a circle
 * (the historical look); the per-event override exists because events that sit
 * close together must stay distinguishable, and shape is the strongest
 * pre-colour channel for greyscale printing.
 */
export type EventMarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'star' | 'hexagon';

/** Confidence + evidence attached to a hypothesis (an event or an ancestral state). */
export interface HypothesisMeta {
  confidence?: Confidence;
  support?: string;
  against?: string;
  /** Accession / catalogue number of the specimen or record backing the claim. */
  accession?: string;
  /** DOI or URL of the publication backing the claim. */
  doi?: string;
}

/**
 * An annotated evolutionary event placed on a node or on the branch entering a
 * node. `typeId` keys into the event-type catalogue (see model/events.ts);
 * `triggers` lists downstream events for the causal-chain overlay.
 *
 * The `marker*` fields are optional per-event style overrides. Absent fields
 * fall back to the defaults: a circle of `EVENT_BADGE_RADIUS` in the event
 * type's catalogue colour, with NO text inside — the shape and colour carry
 * the identity, so a figure does not turn into a field of letter codes. They
 * are user-set in the event editor (shape / size / colour / inner text), and
 * the user decides per event whether text is drawn at all; a custom
 * `markerText` is still honoured for documents that set one.
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
  /** Badge outline shape; default 'circle'. */
  markerShape?: EventMarkerShape;
  /** Badge radius override in world px (clamped to [5, 24] on use). */
  markerSize?: number;
  /** Badge outline colour override; default = the event type's catalogue colour. */
  markerColor?: string;
  /**
   * Whether the badge draws inner text. Absent means ON (the type's catalogue
   * code shows by default — colour-only badges were not reliably
   * distinguishable); an explicit `false` hides it. Resolve it through
   * `eventMarkerTextVisible()` rather than reading this directly.
   */
  markerShowText?: boolean;
  /**
   * Text drawn inside the badge (e.g. "KI" or a short custom label). Only
   * drawn when the marker's text is shown; defaults to the type's code when
   * shown with no custom text.
   */
  markerText?: string;
}

/** Lifecycle of a named hypothesis layer. */
export type HypothesisStatus = 'draft' | 'tested' | 'supported' | 'refuted';

/**
 * A named alternative hypothesis over the shared topology (see model/layers.ts).
 * Beyond the name, a competitive hypothesis carries its CLAIM (statement), how
 * it would be tested (prediction), lifecycle status and evidence pointers —
 * without these the comparison numbers have nowhere to land.
 */
export interface HypothesisLayer {
  id: string;
  name: string;
  /** One-sentence claim this layer asserts (the hypothesis本体). */
  statement?: string;
  /** The observation that would test or refute the claim. */
  prediction?: string;
  status?: HypothesisStatus;
  /** Evidence pointers: character/event ids, citations, DOIs. */
  evidence?: string[];
  author?: string;
  createdAt?: string;
  updatedAt?: string;
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
  states: Record<NodeId, Record<string, string | number | string[]>>;
  meta: Record<NodeId, Record<string, HypothesisMeta>>;
  /** Free-text hypothesis annotation per node (shown on the tree). */
  notes?: Record<NodeId, string>;
  events: EvolutionaryEvent[];
}

export interface TreeNode {
  id: NodeId;
  label: string;
  parentId: NodeId | null;
  childrenIds: NodeId[];
  branchLength?: number;
  /**
   * Branch-support value as written by the source file. Read it together with
   * `supportKind` / `supportScale` — the bare number alone cannot distinguish
   * a 0–1 posterior from a 0–100 bootstrap, and `1` under the two conventions
   * means "100%" and "1%" respectively.
   */
  support?: number;
  /** What the support number measures, when the source (or the user) declares it. */
  supportKind?: SupportKind;
  /** Scale the support value is stored in; defaulted heuristically only when unknown. */
  supportScale?: SupportScale;
  /** Node age (time before present) in the project's time unit; used by the time-calibrated layout. */
  age?: number;
  /** Lower bound of the node-age interval (e.g. 95% HPD), same unit as `age`. */
  ageMin?: number;
  /** Upper bound of the node-age interval. */
  ageMax?: number;
  /** Where the age / interval comes from; 'estimate' marks topology-derived pseudo-ages. */
  ageSource?: AgeSource;
  /** Citation for the age or its interval (publication / database id). */
  ageCitation?: string;
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
   * A discrete assignment may also be a `string[]`: a POLYMORPHIC /
   * partially-observed set of states ("A or B") — distinct from an unobserved
   * tip, which simply has no entry. Parsimony scores a set as the cheapest
   * state in the set; Mk multiplies likelihoods of the set members.
   */
  charStates?: Record<string, string | number | string[]>;
  /** Confidence / evidence for this node's ancestral-state hypotheses, per character. */
  charMeta?: Record<string, HypothesisMeta>;
  /**
   * Free-text hypothesis statement for this node, belonging to the ACTIVE
   * hypothesis layer. Rendered on the tree under the node label; switching
   * layers swaps it with that layer's snapshot.
   */
  hypothesisNote?: string;
  /**
   * Structured per-tip metadata (accession, strain, host, country, collection
   * date, lineage, …) joined from an external table. Queryable — unlike the
   * free-form `meta` bag — and it is what the CSV/TSV import writes.
   */
  annotations?: Record<string, string | number>;
  meta?: Record<string, unknown>;
}

export interface CustomEdge {
  id: EdgeId;
  sourceId: NodeId;
  targetId: NodeId;
  label?: string;
  style: EdgeStyle;
  /**
   * What the drawn line asserts. Custom edges are DRAWING ANNOTATIONS, not
   * model components — they never enter parsimony / Mk / DTL computation —
   * but recording the intended meaning makes them a checkable register of
   * reticulation hypotheses instead of decoration.
   */
  kind?: CustomEdgeKind;
  /** Free-text justification (evidence, source, why this reticulation). */
  note?: string;
}

/** Meaning a user can attach to a custom (net-like) edge. */
export type CustomEdgeKind = 'hgt' | 'hybridization' | 'symbiosis' | 'recombination' | 'association';

/** A fossil calibration point for time-calibrated layouts. */
export interface CalibrationPoint {
  id: string;
  nodeId: NodeId;
  minAge: number;
  maxAge: number;
  label?: string;
  /** Where the bound comes from (publication, PBDB collection id, …). */
  source?: string;
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
  /**
   * Position WITHIN the host species branch: 0 = the parent-species-node end,
   * 1 = the mapped species node's end. Optional; absent means the embedded
   * layout picks a deterministic default. Clamped to [0, 1] on load.
   */
  branchFraction?: number;
  /**
   * Horizontal-transfer DONOR as a species NODE id (not a branch id) — the node
   * whose incoming branch hosts the donating child lineage. The established
   * model convention (`validateScenario` / `geneTreeNhk`) treats the child
   * placed OUTSIDE the recipient subtree as the donor; absent means that rule
   * derives it automatically. An explicit value covers multi-donor / ambiguous
   * scenarios and must point at an existing species node outside the recipient
   * subtree (else it is ignored and auto-derivation applies).
   */
  transferDonor?: NodeId;
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

/**
 * DTL cost presets. Every default encodes a methodological stance — the classic
 * `transfer = 2` makes "duplication + loss" cheaper than a single transfer,
 * which biases microbial (HGT-rich) data toward under-reporting transfers.
 * The presets make the stance explicit and selectable:
 *  - `eukaryote-conservative`: the historical default; transfers are expensive.
 *  - `unit`: standard Page/JMM unit costs — every event costs the same.
 *  - `microbial`: HGT is treated as at least as cheap as duplication + loss.
 */
export const RECON_COST_PRESETS: {
  id: string;
  label: string;
  labelEn: string;
  costs: ReconCosts;
}[] = [
  {
    id: 'eukaryote-conservative',
    label: '真核/保守（转移较贵）',
    labelEn: 'Eukaryote / conservative (costly transfers)',
    costs: { dup: 1, transfer: 2, loss: 1 },
  },
  { id: 'unit', label: '标准等价代价 (1,1,1)', labelEn: 'Standard unit costs (1,1,1)', costs: { dup: 1, transfer: 1, loss: 1 } },
  {
    id: 'microbial',
    label: '微生物/高转移（转移廉价）',
    labelEn: 'Microbial / transfer-friendly (cheap transfers)',
    costs: { dup: 1, transfer: 1, loss: 0.5 },
  },
];

/**
 * The historical default. Changed from `{dup:1, transfer:2, loss:1}` to the
 * standard unit costs: with `transfer = 2` the solver reads real horizontal
 * transfers as "duplication + loss", which is the wrong prior for microbial
 * data. Users who want the conservative stance pick the matching preset.
 */
export const DEFAULT_RECON_COSTS: ReconCosts = { dup: 1, transfer: 1, loss: 1 };

/**
 * Options beyond the raw cost vector that change what the DTL DP is allowed to
 * do. All optional; absent fields mean the documented defaults.
 */
export interface ReconOptions {
  /**
   * Allow the gene root to be placed at any species node for free. `false`
   * (the default) anchors the root at the species root, which keeps absolute
   * event counts comparable with standard tools.
   */
  freeRoot?: boolean;
  /** Extra cost charged when the (free) root placement implies a transfer. Default 0. */
  rootTransferCost?: number;
  /**
   * Tie-break priority among equal-cost event classes at one cell. Absent =
   * the documented `duplication > speciation > transfer`. Microbial studies
   * often want transfer first, so the order is user-selectable.
   */
  tiePriority?: ReconEventType[];
}

/**
 * Which mapping lines the reconciliation canvas draws.
 *
 * `tips` (the default) shows only tip mappings — the anchors produced by label
 * matching; `internal` only the inferred/edited internal placements; `all`
 * everything. Selected/hovered lines are always shown regardless of scope.
 */
export type MappingScope = 'tips' | 'internal' | 'all';

/**
 * Reconciliation canvas layout mode.
 *
 * `side-by-side` (the default) is the two-pane species-left / gene-right view
 * joined by the mapping bridge. `embedded` is the single-viewport nested view:
 * the species tree drawn as THICK branch tubes with the gene tree's THIN
 * lineages nested inside them, so the user can read (and hand-build) a gene
 * lineage's path through the species tree.
 */
export type ReconLayoutMode = 'side-by-side' | 'embedded';

/**
 * Transient reconciliation-canvas display options. Pure UI state: never written
 * into the Project, never part of undo/redo or autosave.
 */
export interface ReconViewOptions {
  mappingScope: MappingScope;
  showLabels: boolean;
  showEventGlyphs: boolean;
  showLosses: boolean;
  showMappings: boolean;
  /** Mirror one shared scale across both panes (pan stays independent). */
  syncZoom: boolean;
  /** Restrict drawn mapping lines to one event class, unresolved only, or all. */
  eventFilter: ReconEventType | 'unresolved' | 'all';

  /** Canvas layout mode: side-by-side comparison / nested embedding. */
  layoutMode: ReconLayoutMode;
  /** Embedded mode: base species-branch tube width (world px). */
  embeddedTubeWidth: number;
  /** Embedded mode: gene lane spacing (world px). */
  embeddedLaneGap: number;
  /** Embedded mode: draw horizontal-transfer arcs. */
  embeddedShowTransfers: boolean;
  /** Embedded mode: draw gene-loss stubs inside the tubes. */
  embeddedShowLossStubs: boolean;
}

export const DEFAULT_RECON_VIEW_OPTIONS: ReconViewOptions = {
  mappingScope: 'tips',
  showLabels: true,
  showEventGlyphs: true,
  showLosses: true,
  showMappings: true,
  syncZoom: true,
  eventFilter: 'all',

  layoutMode: 'side-by-side',
  embeddedTubeWidth: 18,
  embeddedLaneGap: 3,
  embeddedShowTransfers: true,
  embeddedShowLossStubs: true,
};

/** Which section of the reconciliation left panel the rail currently shows. */
export type ReconSection = 'trees' | 'scenario' | 'validation' | 'view';

export interface LayoutSettings {
  mode: LayoutMode;
  type: LayoutType;
  orientation: Orientation;
  /** Spacing between successive depth levels (px). */
  hGap: number;
  /** Spacing between adjacent leaves / siblings (px). */
  vGap: number;
  /**
   * Explicit length of the time axis in px for time-calibrated layouts.
   * Decoupled from `hGap`: deriving the axis from `root.height × hGap` ties
   * px-per-Ma to the topological depth of the sampling, which makes deep-time
   * figures mathematically unreadable and non-comparable across trees. When
   * absent the legacy `root.height × max(20, hGap)` behaviour is kept.
   */
  timeAxisLength?: number;
  /** Depth mapping for the time axis. 'log' maps age as log10(1 + age/t0). */
  timeScale?: TimeScaleKind;
  /** Log-origin t0 (in time units) for the 'log' mapping. Default 1. */
  timeLogOrigin?: number;
  /**
   * An optional second unit (e.g. "年" next to "Ma") rendered beside axis
   * tick labels so a deep-time figure is not misread in the wrong magnitude.
   */
  secondTimeUnit?: string;
  /** Unit label for node ages in the time-calibrated layout (e.g. "Ma"). */
  timeUnit?: string;
  /** Support threshold (0–100); branches below this are drawn dashed/lighter. */
  supportThreshold?: number;
  /** When true, nodes with support below the threshold are auto-collapsed. */
  collapseBelowThreshold?: boolean;
  /**
   * Screen-constant label rendering (Level-of-Detail): when zoomed out below
   * the readable threshold, labels switch to a screen-fixed size instead of
   * vanishing with the world-space scale.
   */
  labelLod?: boolean;
}

/** Mapping from age to pixel depth on a time axis. */
export type TimeScaleKind = 'linear' | 'sqrt' | 'log';

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

/**
 * Where the pieces of this document came from. A publishable hypothesis
 * document must record its provenance: which tool produced the topology, what
 * the branch lengths / ages / traits were derived from, and by whom.
 */
export interface ProjectProvenance {
  topologySource?: string;
  lengthSource?: string;
  dateSource?: string;
  traitSource?: string;
  methodsNote?: string;
  createdUtc?: string;
  modifiedUtc?: string;
}

/** What kind of stored analysis run this is. */
export type AnalysisKind =
  | 'parsimony'
  | 'asr'
  | 'correlation'
  | 'consistency'
  | 'blombergK'
  | 'phylosignal'
  | 'treeDistance'
  | 'other';

/**
 * A first-class, retained analysis run. Inference results that only live in
 * component state cannot be cited, compared or exported — so completed runs
 * are appended here with their method, parameters, input fingerprint and the
 * software version, and become part of the document.
 */
export interface AnalysisResult {
  id: string;
  kind: AnalysisKind;
  /** Human-readable name shown in the run history list. */
  title?: string;
  characterIds?: string[];
  /** Fingerprint of the inputs (characters + relevant node states + costs). */
  fingerprint: string;
  /** Method name exactly as it should be cited. */
  method: string;
  params?: Record<string, string | number | boolean | null>;
  /** Application version that produced the result. */
  version: string;
  createdAt: string;
  payload: unknown;
  /** Pinned results do not go stale when unrelated parts of the document change. */
  pinned?: boolean;
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
  /** DTL solver options (free root, tie priority, …). */
  reconOptions?: ReconOptions;
  /** User-defined event types extending the built-in catalogue (see model/events.ts). */
  customEventTypes?: CustomEventType[];
  /** Retained analysis runs (see AnalysisResult). */
  analysisResults?: AnalysisResult[];
  /** Structured provenance record for this document. */
  provenance?: ProjectProvenance;
  /**
   * Absolute path this document was opened from / last saved to. Present only
   * when the app can write it back in place (native build); ⌘S saves in place
   * when set, ⌘⇧S always asks.
   */
  sourcePath?: string;
  /** ISO timestamp of the last successful disk save. */
  savedAt?: string;
  /** Document revision at the last successful disk save (dirty = current ≠ saved). */
  savedRevision?: number;
  /** ISO timestamp of the last modification. */
  modifiedAt?: string;
  /** Application version that last wrote this document. */
  appVersion?: string;
  /**
   * Stable id into the built-in sample catalogue (`sampleTree.ts`), set when the
   * document was created from a sample card. The catalogue is feature-oriented
   * (`feature-tour`, `large-tree`, `recon-family`). The id lets the app rebuild a
   * still untouched sample in the other language on a locale switch, so sample
   * content follows the UI language instead of staying frozen in the language
   * that was active when the card was clicked. An id that is no longer in the
   * catalogue (e.g. from an older version) is left untouched: the document stays
   * an ordinary user project and is never rebuilt or cleaned.
   */
  sampleId?: string;
}

/**
 * A user-defined event type. Extends the built-in catalogue so a figure is not
 * locked to a fixed list — project-specific microbial / deep-time semantics
 * (genome reduction, plasmid gain, CRISPR acquisition, …) can be first-class.
 * Loaded from `project.customEventTypes`, importable/exportable as a JSON
 * ontology file.
 */
export interface CustomEventType {
  id: string;
  label: string;
  labelEn: string;
  group: string;
  groupEn: string;
  /** Two-letter code shown inside badges when text is on. */
  code: string;
  color: string;
  target: 'node' | 'branch' | 'both';
  /** Badge outline shape; defaults to the catalogue default. */
  shape?: EventMarkerShape;
}

/**
 * Schema version of the project file format. Kept in lock-step with the
 * application minor version (see README "Project file format" for the
 * compatibility matrix): a 0.1.0 file migrates forward through `MIGRATIONS`
 * (see io/projectIO.ts).
 */
export const PROJECT_VERSION = '0.2.0';

/**
 * Application version. Injected at build time from package.json by Vite
 * (`define.__APP_VERSION__` in vite.config.ts) so there is exactly ONE source
 * of truth; the literal below is only a fallback for non-Vite consumers
 * (tests run through Vitest, which shares the define).
 */
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : '0.3.0';

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
    case 'curved':
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
  const t = hex.trim();
  // 6-digit hex, plus the forms a colour field can realistically carry: 3-digit
  // shorthand (#abc), 4-digit with alpha (#abcd), 8-digit with alpha
  // (#rrggbbaa) and functional rgb(). Without these, `lerpHexColor`,
  // `relativeLuminance` and `colorDeltaE` silently degraded such a value to
  // `from` / black.
  const m6 = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(t);
  if (m6) return { r: parseInt(m6[1], 16), g: parseInt(m6[2], 16), b: parseInt(m6[3], 16) };
  const m3 = /^#?([\da-f])([\da-f])([\da-f])$/i.exec(t);
  if (m3) {
    const wide = (c: string) => parseInt(c + c, 16);
    return { r: wide(m3[1]), g: wide(m3[2]), b: wide(m3[3]) };
  }
  const m4 = /^#?([\da-f])([\da-f])([\da-f])([\da-f])$/i.exec(t);
  if (m4) {
    const wide = (c: string) => parseInt(c + c, 16);
    return { r: wide(m4[1]), g: wide(m4[2]), b: wide(m4[3]) };
  }
  const m8 = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(t);
  if (m8) return { r: parseInt(m8[1], 16), g: parseInt(m8[2], 16), b: parseInt(m8[3], 16) };
  const mfn = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(t);
  if (mfn) return { r: Number(mfn[1]), g: Number(mfn[2]), b: Number(mfn[3]) };
  return null;
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
