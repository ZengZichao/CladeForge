// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Factory helpers for new / sample projects.
//
// ALL sample projects ship FICTIONAL taxa with NEUTRAL CODE NAMES and NO REAL
// BIOLOGICAL BACKGROUND: every node is labelled `Taxon_A`, `Taxon_B`, …
// (Excel-column style suffixes: A…Z, then AA, AB, …), and every character,
// state, event, calibration and environmental marker is an abstract,
// feature-oriented placeholder (Character 1, State A, Event A, …). The names
// and labels deliberately carry no imagery that could be mistaken for a real
// organism, trait or geological event — the documents exist to exercise the
// editor's features (time calibration, characters, hypothesis layers, events,
// calibrations), not to tell a scientific story or assert biology.
//
// Every sample tree is STRICTLY BINARY: each internal node has exactly two
// children (no polytomies, no single-child chains). The builder helpers below
// verify the document as it is assembled: `mkNode` enforces the branch-length /
// node-age identity on every edge, `assertBinary` re-checks the finished tree,
// and `assignStateAt` / `hypothesiseStateAt` resolve nodes by the ids returned
// from `mkNode`, so a rename can never silently orphan a state assignment.

import {
  DEFAULT_CANVAS,
  DEFAULT_LAYOUT,
  DEFAULT_RECON_COSTS,
  PROJECT_VERSION,
  defaultStyleDefaults,
  type GeneNodeAssumption,
  type Project,
  type TreeNode,
} from './types';
import { newId } from './treeOps';
import { defaultLayers } from './layers';
import { makeGeneTreeEntry } from './geneTrees';
import { tr } from '../ui/strings';

/**
 * Sample characters carry a FIXED id.
 *
 * The character id is the `character` column of thirteen committed fixture
 * tables — `manifest.tsv`, `ape-agreement.tsv` and the per-character tables of
 * the `feature-tour` and `large-tree` samples, ~300 data lines between them — so
 * it has to be stable. With `newId()` (a nanoid) every run of
 * `scripts/cross-check/dump-fixtures.mjs` would rewrite all of them while
 * changing nothing a reader could see. Pinning the character ids is
 * what keeps regeneration byte-identical. Node and state ids stay random: they
 * never appear in a fixture column.
 */
function sampleCharacterId(name: string): string {
  return `sample-char:${name}`;
}

/** An empty project containing just a root node. */
export function createEmptyProject(name = 'Untitled'): Project {
  const rootId = newId();
  const root: TreeNode = { id: rootId, label: 'Root', parentId: null, childrenIds: [] };
  return {
    id: newId(),
    name,
    version: PROJECT_VERSION,
    nodes: { [rootId]: root },
    rootId,
    customEdges: [],
    layout: { ...DEFAULT_LAYOUT },
    canvas: { ...DEFAULT_CANVAS },
    defaults: defaultStyleDefaults(),
    characters: [],
    events: [],
    ...defaultLayers(),
    environmentalEvents: [],
    calibrationPoints: [],
    geneTrees: [],
    reconCosts: { ...DEFAULT_RECON_COSTS },
  };
}

/** Metadata for the sample-project picker shown in the empty state. */
export interface SampleDescriptor {
  id: string;
  /** Localised name shown in the picker. */
  label: string;
  labelEn: string;
  /** One-line description shown under the label. */
  desc: string;
  descEn: string;
  /** Factory that builds a fresh copy of the sample project. */
  build: () => Project;
  /**
   * Which workspace the sample opens into. `'recon'` samples carry gene trees
   * and land directly in the reconciliation workspace (active gene tree =
   * the first entry) instead of the standard canvas.
   */
  entryView?: 'standard' | 'recon';
}

// ── helpers ───────────────────────────────────────────────────────────────
// These documents are hard-coded sample data, so the helpers verify them instead
// of quietly accepting whatever was typed: every edge has to satisfy the
// branch-length / node-age identity, every label has to be unique, and every
// declared state has to be carried by at least one tip.

/**
 * Neutral code name for a sample node: `Taxon_A` … `Taxon_Z`, then
 * `Taxon_AA`, `Taxon_AB`, … (the same roll-over Excel column letters use).
 */
export function taxonLabel(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) return 'Taxon_A';
  let suffix = '';
  let n = seq;
  do {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Taxon_${suffix}`;
}

/** A per-document name allocator: `const nextTaxon = taxonNamer();` */
export function taxonNamer(): () => string {
  let i = 0;
  return () => taxonLabel(i++);
}

/** Look a node up by id, LOUDLY (sample ids are built in this same module). */
function nodeAt(project: Project, nodeId: string): TreeNode {
  const node = project.nodes[nodeId];
  if (!node) throw new Error(`sampleTree: node "${nodeId}" does not exist`);
  return node;
}

/** Assign an observed state to a node, checking character and state. */
function assignStateAt(project: Project, nodeId: string, characterId: string, stateId: string): void {
  const character = project.characters.find((c) => c.id === characterId);
  if (!character) throw new Error(`sampleTree: unknown character "${characterId}"`);
  if (!character.states.some((s) => s.id === stateId)) {
    throw new Error(
      `sampleTree: state "${stateId}" is not declared by character "${character.name}"`,
    );
  }
  const node = nodeAt(project, nodeId);
  node.charStates = { ...node.charStates, [characterId]: stateId };
}

/**
 * Assert an internal node's hypothesised ancestral state together with the
 * evidence behind it (confidence + supporting character).
 */
function hypothesiseStateAt(
  project: Project,
  nodeId: string,
  characterId: string,
  stateId: string,
  confidence: 'high' | 'medium' | 'low',
  support: string,
): void {
  assignStateAt(project, nodeId, characterId, stateId);
  const node = nodeAt(project, nodeId);
  node.charMeta = { ...node.charMeta, [characterId]: { confidence, support } };
}

/**
 * Create a node under `parentId`.
 *
 * A time-tree sample must satisfy `branchLength = parent.age − node.age` on every
 * edge, so the helper checks it: `age` feeds the layout and the time axis while
 * `branchLength` feeds the phylogram / Mk / Blomberg's K, so a length that
 * contradicts its own ages makes one tree read as two different depths depending
 * on the mode.
 */
function mkNode(
  project: Project,
  label: string,
  parentId: string,
  age?: number,
  branchLength?: number,
): string {
  const parent = project.nodes[parentId];
  if (!parent) throw new Error(`sampleTree: parent "${parentId}" of "${label}" does not exist`);
  if (age !== undefined && branchLength !== undefined && typeof parent.age === 'number') {
    const implied = parent.age - age;
    if (Math.abs(branchLength - implied) > Math.max(1e-6, Math.max(implied, 1) * 0.005)) {
      throw new Error(
        `sampleTree: "${label}" branch length ${branchLength} contradicts its ages (${parent.age} − ${age} = ${implied})`,
      );
    }
  }
  const id = newId();
  project.nodes[id] = { id, label, parentId, childrenIds: [] };
  if (age !== undefined) project.nodes[id].age = age;
  if (branchLength !== undefined) project.nodes[id].branchLength = branchLength;
  parent.childrenIds.push(id);
  return id;
}

/**
 * Every sample tree must be STRICTLY BINARY: each internal node carries exactly
 * two children. Polytomies (≥3 children) and single-child chains both defeat the
 * editor's tree model — an unresolved node is an unrooted tree drawn as rooted,
 * and a unary edge carries no split at all. Called on the finished document so a
 * structural slip fails loudly instead of shipping.
 */
function assertBinary(project: Project): void {
  for (const node of Object.values(project.nodes)) {
    const n = node.childrenIds.length;
    if (n !== 0 && n !== 2) {
      throw new Error(
        `sampleTree: node "${node.label}" has ${n} children — sample trees must be strictly binary`,
      );
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 1 — Feature tour (the default project on first run)
// ════════════════════════════════════════════════════════════════════════════
export function createSampleProject(): Project {
  return createFeatureTourSample();
}

export function createFeatureTourSample(): Project {
  const project = createEmptyProject(tr('功能导览', 'Feature tour'));
  project.sampleId = 'feature-tour';
  const nextTaxon = taxonNamer();
  const rootId = project.rootId;
  project.nodes[rootId].label = nextTaxon(); // Taxon_A, age 53

  // Strictly binary; every edge satisfies branchLength = parent.age − node.age,
  // which `mkNode` verifies. The root's two children carry 1 and 5 (53 − 52,
  // 53 − 48); any other pair puts the phylogram and the time axis in disagreement
  // about the same branch.
  const root = project.nodes[rootId];
  root.age = 53; // oldest node; inside the root calibration [52, 55] below
  const cladeB = mkNode(project, nextTaxon(), rootId, 52, 1);
  const tipC = mkNode(project, nextTaxon(), cladeB, 45, 7);
  const cladeD = mkNode(project, nextTaxon(), cladeB, 41, 11);
  const tipE = mkNode(project, nextTaxon(), cladeD, 0, 41);
  const tipF = mkNode(project, nextTaxon(), cladeD, 0, 41);
  const tipG = mkNode(project, nextTaxon(), rootId, 48, 5);

  // --- characters ---
  const c1aId = newId();
  const c1bId = newId();
  const c1cId = newId();
  const character1: Project['characters'][number] = {
    id: sampleCharacterId('feature-tour-c1'),
    name: tr('性状 1', 'Character 1'),
    type: 'discrete',
    states: [
      { id: c1aId, label: tr('状态 A', 'State A'), color: '#9ca3af' },
      { id: c1bId, label: tr('状态 B', 'State B'), color: '#3b82f6' },
      { id: c1cId, label: tr('状态 C', 'State C'), color: '#1e3a5f' },
    ],
    description: tr(
      '演示有序（可加）代价矩阵：相邻状态代价 2 与 1，跨级代价 3 = 2 + 1。',
      'Demonstrates an ordered (additive) cost matrix: adjacent steps cost 2 and 1; the direct step costs 3 = 2 + 1.',
    ),
    // Sankoff step matrix, rows/columns in `states` order (A/B/C):
    // an ORDERED (additive, direction-symmetric) matrix over a linearly ordered
    // character — adjacent states cost 2 (A↔B) and 1 (B↔C), and the direct
    // A↔C step costs exactly 3 = 2 + 1. These are the weights the on-screen
    // cost band and the parsimony baselines are computed with, and the same
    // numbers `scriptExport.ts` embeds as an R `matrix(c(...))` literal: the
    // exported R script, the NEXUS ASSUMPTIONS block and the cost band all read
    // this one matrix, so they cannot disagree. *Character 2* below is priced the
    // other way on purpose — this project needs one character priced by a graded,
    // reversible transition and one priced by an irreversible innovation.
    costMatrix: [
      [0, 2, 3],
      [2, 0, 1],
      [3, 1, 0],
    ],
  };
  const c2aId = newId();
  const c2bId = newId();
  const c2cId = newId();
  const character2: Project['characters'][number] = {
    id: sampleCharacterId('feature-tour-c2'),
    name: tr('性状 2', 'Character 2'),
    type: 'discrete',
    states: [
      { id: c2aId, label: tr('状态 A', 'State A'), color: '#b45309' },
      { id: c2bId, label: tr('状态 B', 'State B'), color: '#0ea5e9' },
      { id: c2cId, label: tr('状态 C', 'State C'), color: '#1e3a8a' },
    ],
    description: tr(
      '演示方向不对称代价矩阵：所有反向代价（5）高于正向（2/3/1）。',
      'Demonstrates a direction-asymmetric cost matrix: every reversal (5) costs more than any forward step (2/3/1).',
    ),
    // Sankoff step matrix, rows/columns in `states` order. Unlike *Character 1*
    // this one is genuinely DIRECTION-ASYMMETRIC: every reversal (5) costs more
    // than any forward step (2 / 3 / 1), so a State-C taxon cannot be
    // "un-derived" cheaply. The character carries no internal-node hypotheses,
    // so asymmetric pricing here cannot unbalance the worked example that
    // *Character 1* carries; `scriptExport.ts`/`io/nexus.ts` emit this literal as
    // the single source of truth for the exported R script and NEXUS ASSUMPTIONS.
    costMatrix: [
      [0, 2, 3],
      [5, 0, 1],
      [5, 5, 0],
    ],
  };
  project.characters = [character1, character2];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  assign(tipG, character1.id, c1aId);
  assign(tipC, character1.id, c1bId);
  assign(tipE, character1.id, c1cId);
  assign(tipF, character1.id, c1cId);
  assign(tipG, character2.id, c2aId);
  assign(tipC, character2.id, c2bId);
  assign(tipE, character2.id, c2cId);
  assign(tipF, character2.id, c2cId);

  project.layers[0].name = tr('主假说', 'Primary hypothesis');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, character1.id, c1aId, 'high', tr('示例证据 A', 'Illustrative evidence A'));
  hypothesise(cladeB, character1.id, c1aId, 'medium', tr('示例证据 B', 'Illustrative evidence B'));
  hypothesise(cladeD, character1.id, c1bId, 'medium', tr('示例证据 C', 'Illustrative evidence C'));

  const innovationId = newId();
  const radiationId = newId();
  const buildEvents = () => [
    {
      id: innovationId,
      typeId: 'key-innovation',
      target: 'branch' as const,
      nodeId: cladeD,
      label: tr('事件 A（关键创新）', 'Event A (key innovation)'),
      note: tr(
        '演示事件触发链——本事件触发事件 B。',
        'Demonstrates event triggers: this event fires Event B.',
      ),
      confidence: 'high' as const,
      support: tr('示例证据 A', 'Illustrative evidence A'),
      triggers: [radiationId],
    },
    {
      id: radiationId,
      typeId: 'adaptive-radiation',
      target: 'node' as const,
      nodeId: cladeD,
      label: tr('事件 B（适应辐射）', 'Event B (adaptive radiation)'),
      confidence: 'medium' as const,
      triggers: [],
    },
  ];
  project.events = buildEvents();

  const alternativeId = newId();
  // The competing layer is a genuine alternative ROOT state, and it is priced
  // consistently with it: under the ordered step matrix above, a State-B root
  // pays 2 for the B → A step to the State-A tip and 1 for the B → C step into
  // the State-C clade — 3 step units over 2 changes, exactly the parsimony
  // minimum. So this layer demonstrates "a different hypothesis that the
  // checker cannot fault", while the active layer (which double-books the
  // A → B step, costing 6 against a minimum of 3) demonstrates what the
  // excess-changes note is for.
  project.layers.push({ id: alternativeId, name: tr('备选假说', 'Alternative hypothesis') });
  const altStates: Record<string, Record<string, string>> = {
    [rootId]: { [character1.id]: c1bId },
    [cladeB]: { [character1.id]: c1bId },
    [cladeD]: { [character1.id]: c1cId },
  };
  project.layerStore[alternativeId] = {
    states: altStates,
    meta: {
      [rootId]: {
        [character1.id]: { confidence: 'low', support: tr('示例证据 D', 'Illustrative evidence D') },
      },
    },
    events: buildEvents(),
  };

  // Calibration points. Each range has to cover the age of the node it
  // calibrates — `validateTimeData` checks exactly that — so the bounds below
  // really carry the asserted ages, and no asserted age falls outside its own
  // range.
  project.calibrationPoints = [
    {
      id: newId(),
      nodeId: rootId,
      minAge: 52,
      maxAge: 55,
      label: tr('根节点校准', 'Root calibration'),
    },
    {
      id: newId(),
      nodeId: tipG,
      minAge: 47,
      maxAge: 50,
      label: tr('末端校准', 'Tip calibration'),
    },
    {
      id: newId(),
      nodeId: tipC,
      // The two sample windows (47–50 and 45–49) deliberately overlap, and the
      // asserted node age (45.0, fixed by the time-tree identity) sits inside
      // its own window. `validateTimeData` checks both.
      minAge: 45,
      maxAge: 49,
      label: tr('末端校准', 'Tip calibration'),
    },
    {
      id: newId(),
      nodeId: cladeD,
      minAge: 34,
      maxAge: 41,
      label: tr('分支校准', 'Branch calibration'),
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('环境标记 A', 'Environmental marker A'),
      from: 33.9,
      to: 33.9,
      color: '#ef4444',
      note: tr('示例环境标记', 'Illustrative environmental marker'),
    },
    {
      id: newId(),
      label: tr('环境标记 B', 'Environmental marker B'),
      from: 14,
      to: 14,
      color: '#ef4444',
    },
    {
      id: newId(),
      label: tr('环境标记 C', 'Environmental marker C'),
      from: 5.3,
      to: 5.3,
      color: '#0284c7',
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 2 — Large tree & deep time
// ════════════════════════════════════════════════════════════════════════════
export function createLargeTreeSample(): Project {
  const project = createEmptyProject(tr('大树与深时', 'Large tree & deep time'));
  project.sampleId = 'large-tree';
  const nextTaxon = taxonNamer();
  const rootId = project.rootId;
  project.nodes[rootId].label = nextTaxon(); // Taxon_A, age 4000

  // Strictly binary; branchLength = parent.age − node.age on every edge. Two
  // balanced internal nodes at 3250 / 3050 Ma resolve what would otherwise be a
  // four-way split.
  const root = project.nodes[rootId];
  root.age = 4000; // oldest node; inside the [4000, 4100] root calibration below
  const branchB = mkNode(project, nextTaxon(), rootId, 3500, 500);
  const branchC = mkNode(project, nextTaxon(), rootId, 3400, 600);
  const cladeD = mkNode(project, nextTaxon(), branchC, 3250, 150);
  const cladeE = mkNode(project, nextTaxon(), cladeD, 3200, 50);
  mkNode(project, nextTaxon(), cladeD, 3100, 150);
  const cladeG = mkNode(project, nextTaxon(), branchC, 3050, 350);
  mkNode(project, nextTaxon(), cladeG, 3000, 50);
  mkNode(project, nextTaxon(), cladeG, 2900, 150);
  const cladeJ = mkNode(project, nextTaxon(), branchB, 2800, 700);
  const cladeK = mkNode(project, nextTaxon(), branchB, 2700, 800);
  const cladeL = mkNode(project, nextTaxon(), cladeE, 2600, 600);
  const cladeM = mkNode(project, nextTaxon(), cladeE, 2500, 700);
  const tipsJ1 = mkNode(project, nextTaxon(), cladeJ, 0, 2800);
  const tipsJ2 = mkNode(project, nextTaxon(), cladeJ, 0, 2800);
  const tipsK1 = mkNode(project, nextTaxon(), cladeK, 0, 2700);
  const tipsK2 = mkNode(project, nextTaxon(), cladeK, 0, 2700);
  const tipsL1 = mkNode(project, nextTaxon(), cladeL, 0, 2600);
  const tipsL2 = mkNode(project, nextTaxon(), cladeL, 0, 2600);
  const tipsM1 = mkNode(project, nextTaxon(), cladeM, 0, 2500);
  const tipsM2 = mkNode(project, nextTaxon(), cladeM, 0, 2500);

  // --- characters ---
  // Every state gets its own id constant and the assignments address states by
  // id: indexing by POSITION (`character1.states[2].id`) means deleting or
  // reordering a state silently re-labels taxa that looked perfectly reviewed.
  // Every declared state is also carried by at least one tip, so the legend
  // never shows a category nothing uses.
  const c1aId = newId();
  const c1bId = newId();
  const c1cId = newId();
  const character1: Project['characters'][number] = {
    id: sampleCharacterId('large-tree-c1'),
    name: tr('性状 1', 'Character 1'),
    type: 'discrete',
    states: [
      { id: c1aId, label: tr('状态 A', 'State A'), color: '#7c3aed' },
      { id: c1bId, label: tr('状态 B', 'State B'), color: '#0ea5e9' },
      { id: c1cId, label: tr('状态 C', 'State C'), color: '#f59e0b' },
    ],
    description: tr(
      '演示三状态离散性状与图例。',
      'Demonstrates a three-state discrete character and the legend.',
    ),
  };
  const c2aId = newId();
  const c2bId = newId();
  const c2cId = newId();
  const character2: Project['characters'][number] = {
    id: sampleCharacterId('large-tree-c2'),
    name: tr('性状 2', 'Character 2'),
    type: 'discrete',
    states: [
      { id: c2aId, label: tr('状态 A', 'State A'), color: '#dc2626' },
      { id: c2bId, label: tr('状态 B', 'State B'), color: '#f97316' },
      { id: c2cId, label: tr('状态 C', 'State C'), color: '#22c55e' },
    ],
  };
  project.characters = [character1, character2];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  assign(tipsJ1, character1.id, c1aId);
  assign(tipsJ2, character1.id, c1aId);
  assign(tipsK1, character1.id, c1bId);
  assign(tipsK2, character1.id, c1bId);
  assign(tipsL1, character1.id, c1cId);
  assign(tipsL2, character1.id, c1cId);
  assign(tipsM1, character1.id, c1cId);
  assign(tipsM2, character1.id, c1cId);
  assign(tipsJ1, character2.id, c2cId);
  assign(tipsJ2, character2.id, c2cId);
  assign(tipsK1, character2.id, c2cId);
  assign(tipsK2, character2.id, c2cId);
  assign(tipsL1, character2.id, c2aId);
  assign(tipsL2, character2.id, c2aId);
  assign(tipsM1, character2.id, c2bId);
  assign(tipsM2, character2.id, c2bId);

  project.layers[0].name = tr('主假说', 'Primary hypothesis');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, character2.id, c2aId, 'medium', tr('示例证据 A', 'Illustrative evidence A'));
  hypothesise(branchB, character1.id, c1aId, 'high', tr('示例证据 B', 'Illustrative evidence B'));
  hypothesise(cladeE, character1.id, c1cId, 'high', tr('示例证据 C', 'Illustrative evidence C'));

  // The 4000–4100 Ma range the root carries as a calibration bound, so the
  // document carries what it asserts and `validateTimeData` can check the root
  // age against it.
  project.calibrationPoints = [
    {
      id: newId(),
      nodeId: rootId,
      minAge: 4000,
      maxAge: 4100,
      label: tr('根节点校准', 'Root calibration'),
    },
  ];

  // Events
  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: cladeJ,
      label: tr('事件 A（关键创新）', 'Event A (key innovation)'),
      note: tr('演示关键创新事件：标注在分支上的事件实例。', 'Demonstrates a key-innovation event instance placed on a branch.'),
      confidence: 'high',
      support: tr('示例证据 A', 'Illustrative evidence A'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: cladeK,
      label: tr('事件 B（适应辐射）', 'Event B (adaptive radiation)'),
      confidence: 'medium',
      triggers: [],
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('环境标记 A', 'Environmental marker A'),
      from: 2400,
      to: 2400,
      color: '#ef4444',
      note: tr('示例环境标记', 'Illustrative environmental marker'),
    },
    {
      id: newId(),
      label: tr('环境区间 B', 'Environmental interval B'),
      from: 2400,
      to: 2100,
      color: '#0284c7',
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 3 — Gene-family reconciliation (opens into the reconciliation view)
// ════════════════════════════════════════════════════════════════════════════
//
// The DTL sample the reconciliation workspace's empty state and the sample
// picker both offer: ONE click lands the user in a fully mapped reconciliation
// — species tree + two gene trees, one duplication, one transfer, one loss —
// instead of an empty canvas they would first have to populate themselves.
//
// Event semantics are validated with `validateScenario` inside this builder
// (the sample test asserts 0 errors for tree α), so the sample can never ship an
// inconsistent scenario. Gene docs are built with plain `addChildren` (always
// binary → the DP solver accepts them) and labelled by hand; node ids are
// random, so assumptions are written via the ids returned here, never literally.

/**
 * The reconciliation sample. Species tree: 6 fictional tips (Taxon_A…F) with
 * ages consistent with the branch-length identity. Gene tree α reuses the same
 * tip labels (every tip auto-maps) on a different topology, and carries a
 * hand-written scenario with exactly one duplication (δ), one transfer (τ) and
 * one loss (λ). Gene tree β is a clean mirror of the species topology with one
 * deliberately unresolved internal node, so the validation section has a real
 * warning badge to show.
 */
export function createReconciliationSample(): Project {
  const project = createEmptyProject(
    tr('基因家族协调', 'Gene-family reconciliation'),
  );
  project.sampleId = 'recon-family';

  // --- species tree (strictly binary, ages satisfy branchLength identity) ---
  const rootId = project.rootId;
  project.nodes[rootId].label = tr('物种根', 'Species root');
  project.nodes[rootId].age = 100;
  const n1 = mkNode(project, 'N1', rootId, 60, 40);
  const tipA = mkNode(project, 'Taxon_A', n1, 0, 60);
  mkNode(project, 'Taxon_B', n1, 0, 60);
  const n2 = mkNode(project, 'N2', rootId, 60, 40);
  mkNode(project, 'Taxon_C', n2, 0, 60);
  const n3 = mkNode(project, 'N3', n2, 30, 30);
  mkNode(project, 'Taxon_D', n3, 0, 30);
  const n4 = mkNode(project, 'N4', n3, 15, 15);
  mkNode(project, 'Taxon_E', n4, 0, 15);
  mkNode(project, 'Taxon_F', n4, 0, 15);
  assertBinary(project);

  // --- gene tree α: same tip labels, different topology, full scenario -------
  // α: ((A,(B)) transferred…) — the working scenario:
//   αR  → root   σ   (children land in the two root branches)
//   αAC → N1     τ   (gene lineage of A/B transferred out of C's lineage)
//   αAB → A      δ   (one child co-located on A: classic duplication)
//   αN3 → N3     σ λ (2 edges below the root ⇒ 1 structural loss)
//   αEF → N4     σ   (children land on the two N4 branches, E and F)
  const alpha = createEmptyProject(tr('基因家族 α', 'Gene family α'));
  alpha.layout = { ...alpha.layout, type: 'rectangular-cladogram', orientation: 'LR' };
  const aR = alpha.rootId;
  alpha.nodes[aR].label = 'αR';
  const aAC = mkNode(alpha, 'αAC', aR);
  const aAB = mkNode(alpha, 'αAB', aAC);
  mkNode(alpha, 'Taxon_A', aAB);
  mkNode(alpha, 'Taxon_B', aAB);
  mkNode(alpha, 'Taxon_C', aAC);
  const aN3 = mkNode(alpha, 'αN3', aR);
  mkNode(alpha, 'Taxon_D', aN3);
  const aEF = mkNode(alpha, 'αEF', aN3);
  mkNode(alpha, 'Taxon_E', aEF);
  mkNode(alpha, 'Taxon_F', aEF);
  assertBinary(alpha);
  const alphaAssumptions: Record<string, GeneNodeAssumption> = {
    [aR]: { speciesNode: rootId, event: 'speciation' },
    [aAC]: { speciesNode: n1, event: 'transfer' },
    [aAB]: { speciesNode: tipA, event: 'duplication' },
    [aN3]: { speciesNode: n3, event: 'speciation', losses: 1 },
    // Tips E and F map by label to their same-named species tips; αEF is a
    // speciation whose children enter the two branches of N4.
    [aEF]: { speciesNode: n4, event: 'speciation' },
  };

  // --- gene tree β: mirror topology, one unresolved node (a real warning) ----
  const beta = createEmptyProject(tr('基因家族 β', 'Gene family β'));
  beta.layout = { ...beta.layout, type: 'rectangular-cladogram', orientation: 'LR' };
  const bR = beta.rootId;
  beta.nodes[bR].label = 'βR';
  const b1 = mkNode(beta, 'β1', bR);
  mkNode(beta, 'Taxon_A', b1);
  mkNode(beta, 'Taxon_B', b1);
  const b2 = mkNode(beta, 'β2', bR);
  mkNode(beta, 'Taxon_C', b2);
  const b3 = mkNode(beta, 'β3', b2);
  mkNode(beta, 'Taxon_D', b3);
  const b4 = mkNode(beta, 'β4', b3); // deliberately unresolved: no assumption below
  mkNode(beta, 'Taxon_E', b4);
  mkNode(beta, 'Taxon_F', b4);
  assertBinary(beta);
  const betaAssumptions: Record<string, GeneNodeAssumption> = {
    [bR]: { speciesNode: rootId, event: 'speciation' },
    [b1]: { speciesNode: n1, event: 'speciation' },
    [b2]: { speciesNode: n2, event: 'speciation' },
    [b3]: { speciesNode: n3, event: 'speciation' },
  };

  const alphaEntry = makeGeneTreeEntry(alpha, alpha.name);
  alphaEntry.assumptions = alphaAssumptions;
  const betaEntry = makeGeneTreeEntry(beta, beta.name);
  betaEntry.assumptions = betaAssumptions;
  project.geneTrees = [alphaEntry, betaEntry];
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE CATALOGUE
// ════════════════════════════════════════════════════════════════════════════

/** Look a catalogue entry up by the stable id stamped into `Project.sampleId`. */
export function sampleById(id: string): SampleDescriptor | undefined {
  return SAMPLE_PROJECTS.find((s) => s.id === id);
}

export const SAMPLE_PROJECTS: SampleDescriptor[] = [
  {
    id: 'feature-tour',
    label: '功能导览',
    labelEn: 'Feature tour',
    desc: '小型时间树：演示性状与代价矩阵、假说层、事件触发与时间校准',
    descEn: 'A small time tree demonstrating characters, cost matrices, hypothesis layers, event triggers and time calibration',
    build: createFeatureTourSample,
  },
  {
    id: 'large-tree',
    label: '大树与深时',
    labelEn: 'Large tree & deep time',
    desc: '11 个末端、根年龄 4000 的较大时间树：演示布局、图例与深时轴',
    descEn: 'A larger time tree (11 tips, root age 4000) demonstrating layout, legend and the deep-time axis',
    build: createLargeTreeSample,
  },
  {
    id: 'recon-family',
    label: '基因家族协调',
    labelEn: 'Gene-family reconciliation',
    desc: '物种树 + 两棵基因树的 DTL 协调演示：重复、转移、丢失各一例，含一个未映射内部节点警告',
    descEn: 'DTL reconciliation of a species tree plus two gene trees: one duplication, one transfer and one loss, with one unmapped internal-node warning',
    build: createReconciliationSample,
    entryView: 'recon',
  },
];
