// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Factory helpers for new / sample projects.
//
// ALL sample projects ship FICTIONAL taxa with NEUTRAL CODE NAMES: every node
// is labelled `Taxon_A`, `Taxon_B`, … (Excel-column style suffixes: A…Z, then
// AA, AB, …). The names deliberately carry no imagery that could be mistaken
// for a real organism — the documents exist to exercise the editor's features
// (time calibration, characters, hypothesis layers, events, calibrations), not
// to assert biology.
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
 * The character id is the `character` column of five fixture files plus
 * `manifest.tsv`, so it has to be stable. With `newId()` (a nanoid) every run of
 * `scripts/cross-check/dump-fixtures.mjs` would rewrite ~1 500 lines of committed
 * fixtures while changing nothing a reader could see. Pinning the character ids is
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
// SAMPLE 1 — Fictional aquatic transition (the default project on first run)
// ════════════════════════════════════════════════════════════════════════════
export function createSampleProject(): Project {
  return createAquaticSample();
}

export function createAquaticSample(): Project {
  const project = createEmptyProject(tr('水生适应', 'Aquatic adaptation'));
  project.sampleId = 'cetacean';
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
  const terId = newId();
  const semiId = newId();
  const aqId = newId();
  const habitat: Project['characters'][number] = {
    id: sampleCharacterId('cetacean-habitat'),
    name: tr('栖息地', 'Habitat'),
    type: 'discrete',
    states: [
      { id: terId, label: tr('陆生', 'Terrestrial'), color: '#9ca3af' },
      { id: semiId, label: tr('半水生', 'Semi-aquatic'), color: '#3b82f6' },
      { id: aqId, label: tr('水生', 'Aquatic'), color: '#1e3a5f' },
    ],
    description: tr(
      '示例谱系中陆生 → 半水生 → 水生的栖息地转变（虚构类群）。',
      'A terrestrial-to-semi-aquatic-to-aquatic habitat transition in the sample clade.',
    ),
    // Sankoff step matrix, rows/columns in `states` order (陆生/半水生/水生):
    // an ORDERED (additive, direction-symmetric) matrix over a linearly ordered
    // character — adjacent states cost 2 (陆↔半) and 1 (半↔水), and the direct
    // 陆↔水 step costs exactly 3 = 2 + 1. These are the weights the on-screen
    // cost band and the parsimony baselines are computed with, and the same
    // numbers `scriptExport.ts` embeds as an R `matrix(c(...))` literal: the
    // exported R script, the NEXUS ASSUMPTIONS block and the cost band all read
    // this one matrix, so they cannot disagree. *Locomotion* below is priced the
    // other way on purpose — this project needs one character priced by a graded,
    // reversible transition and one priced by an irreversible innovation.
    costMatrix: [
      [0, 2, 3],
      [2, 0, 1],
      [3, 1, 0],
    ],
  };
  const walkId = newId();
  const limbId = newId();
  const tailId = newId();
  const locomotion: Project['characters'][number] = {
    id: sampleCharacterId('cetacean-locomotion'),
    name: tr('运动方式', 'Locomotion'),
    type: 'discrete',
    states: [
      { id: walkId, label: tr('跖行', 'Plantigrade-walking'), color: '#b45309' },
      { id: limbId, label: tr('划水游动', 'Limb-powered-swimming'), color: '#0ea5e9' },
      { id: tailId, label: tr('摆尾游动', 'Tail-powered-swimming'), color: '#1e3a8a' },
    ],
    description: tr(
      '跖行 → 四肢划水 → 尾鳍推进的运动方式转变（推进一旦交给脊柱即不可逆）。',
      'Walking to limb-paddling to tail-powered swimming (demo: propulsion handed to the spine does not go back).',
    ),
    // Sankoff step matrix, rows/columns in `states` order. Unlike *Habitat* this
    // one is genuinely DIRECTION-ASYMMETRIC: every reversal (5) costs more than
    // any forward step (2 / 3 / 1), so a fully tail-powered taxon cannot be
    // "un-derived" cheaply. The character carries no internal-node hypotheses,
    // so asymmetric pricing here cannot unbalance the worked example that
    // *Habitat* carries; `scriptExport.ts`/`io/nexus.ts` emit this literal as the
    // single source of truth for the exported R script and NEXUS ASSUMPTIONS.
    costMatrix: [
      [0, 2, 3],
      [5, 0, 1],
      [5, 5, 0],
    ],
  };
  project.characters = [habitat, locomotion];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  assign(tipG, habitat.id, terId);
  assign(tipC, habitat.id, semiId);
  assign(tipE, habitat.id, aqId);
  assign(tipF, habitat.id, aqId);
  assign(tipG, locomotion.id, walkId);
  assign(tipC, locomotion.id, limbId);
  assign(tipE, locomotion.id, tailId);
  assign(tipF, locomotion.id, tailId);

  project.layers[0].name = tr('陆生祖先', 'Terrestrial-ancestor');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, habitat.id, terId, 'high', tr('示例形态学证据', 'Illustrative morphological evidence'));
  hypothesise(cladeB, habitat.id, terId, 'medium', tr('示例骨盆形态', 'Illustrative pelvis morphology'));
  hypothesise(cladeD, habitat.id, semiId, 'medium', tr('示例运动形态', 'Illustrative locomotor morphology'));

  const innovationId = newId();
  const radiationId = newId();
  const buildEvents = () => [
    {
      id: innovationId,
      typeId: 'key-innovation',
      target: 'branch' as const,
      nodeId: cladeD,
      label: tr('摆尾游动', 'Tail-powered swimming'),
      note: tr(
        '示例谱系中的关键创新：椎骨衍生的尾叶摆动推进，通往全水生生活。',
        'Key innovation of the sample clade: vertebral-undulation swimming enabling a fully aquatic life.',
      ),
      confidence: 'high' as const,
      support: tr('示例形态学证据', 'Illustrative morphological evidence'),
      triggers: [radiationId],
    },
    {
      id: radiationId,
      typeId: 'adaptive-radiation',
      target: 'node' as const,
      nodeId: cladeD,
      label: tr('水生多样化', 'Aquatic diversification'),
      confidence: 'medium' as const,
      triggers: [],
    },
  ];
  project.events = buildEvents();

  const alternativeId = newId();
  // The competing layer is a genuine alternative ROOT state, and it is priced
  // consistently with it: under the ordered step matrix above, a semi-aquatic
  // root pays 2 for the 半水生 → 陆生 step to the terrestrial tip and 1 for the
  // 半水生 → 水生 step into the aquatic clade — 3 step units over 2 changes,
  // exactly the parsimony minimum. So this layer demonstrates "a different
  // hypothesis that the checker cannot fault", while the active layer (which
  // double-books the 陆生 → 半水生 step, costing 6 against a minimum of 3)
  // demonstrates what the excess-changes note is for.
  project.layers.push({ id: alternativeId, name: tr('半水生祖先', 'Semi-aquatic-ancestor') });
  const altStates: Record<string, Record<string, string>> = {
    [rootId]: { [habitat.id]: semiId },
    [cladeB]: { [habitat.id]: semiId },
    [cladeD]: { [habitat.id]: aqId },
  };
  project.layerStore[alternativeId] = {
    states: altStates,
    meta: {
      [rootId]: {
        [habitat.id]: { confidence: 'low', support: tr('早期记录不确定', 'uncertain early record') },
      },
    },
    events: buildEvents(),
  };

  // Fossil calibration points. Each range has to cover the age of the node it
  // calibrates — `validateTimeData` checks exactly that — so the bounds below
  // really carry the asserted ages, and no asserted age falls outside its own
  // range.
  project.calibrationPoints = [
    {
      id: newId(),
      nodeId: rootId,
      minAge: 52,
      maxAge: 55,
      label: tr('冠群下限', 'crown-group bound'),
    },
    {
      id: newId(),
      nodeId: tipG,
      minAge: 47,
      maxAge: 50,
      label: tr('化石下限', 'fossil bound'),
    },
    {
      id: newId(),
      nodeId: tipC,
      // The two early sample "horizons" (47–50 and 45–49) overlap, as the
      // stratigraphy of this fictional world requires, and the asserted node age
      // (45.0, fixed by the time-tree identity) sits inside its own window.
      // `validateTimeData` checks both.
      minAge: 45,
      maxAge: 49,
      label: tr('化石下限', 'fossil bound'),
    },
    {
      id: newId(),
      nodeId: cladeD,
      minAge: 34,
      maxAge: 41,
      label: tr('分支下限', 'clade minimum'),
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('始新世—渐新世界线', 'Eocene–Oligocene boundary'),
      from: 33.9,
      to: 33.9,
      color: '#ef4444',
      note: tr('全球气候变冷', 'Global cooling checkpoint'),
    },
    {
      id: newId(),
      label: tr('中中新世气候变冷', 'Mid-Miocene cooling'),
      from: 14,
      to: 14,
      color: '#ef4444',
    },
    {
      id: newId(),
      label: tr('赞克尔期洪水（地中海）', 'Zanclean flood (Mediterranean)'),
      from: 5.3,
      to: 5.3,
      color: '#0284c7',
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 2 — Fictional deep-domain radiation
// ════════════════════════════════════════════════════════════════════════════
export function createDeepDomainSample(): Project {
  const project = createEmptyProject(tr('深域辐射', 'Deep-domain radiation'));
  project.sampleId = 'archaea';
  const nextTaxon = taxonNamer();
  const rootId = project.rootId;
  project.nodes[rootId].label = nextTaxon(); // Taxon_A, age 4000

  // Strictly binary; branchLength = parent.age − node.age on every edge. The old
  // four-way split of the thermophilic branch is resolved into two balanced
  // internal nodes at 3250 / 3050 Ma.
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

  // --- characters: metabolism ---
  // Every state gets its own id constant and the assignments address states by
  // id: indexing by POSITION (`energy.states[2].id`) means deleting or reordering
  // a state silently re-labels taxa that looked perfectly reviewed. Every
  // declared state is also carried by at least one tip, so the legend never
  // shows a category nothing uses.
  const methanoId = newId();
  const haloId = newId();
  const sulfurId = newId();
  const energy: Project['characters'][number] = {
    id: sampleCharacterId('archaea-energy'),
    name: tr('能量代谢', 'Energy metabolism'),
    type: 'discrete',
    states: [
      { id: methanoId, label: tr('产甲烷', 'Methanogenesis'), color: '#7c3aed' },
      { id: haloId, label: tr('嗜盐光能', 'Halophilic phototrophy'), color: '#0ea5e9' },
      { id: sulfurId, label: tr('硫氧化', 'Sulfur oxidation'), color: '#f59e0b' },
    ],
    description: tr(
      '示例谱系的核心代谢途径分化（虚构类群）。',
      'Core metabolic pathway divergence across the fictional clades.',
    ),
  };
  const hyperId = newId();
  const thermoId = newId();
  const mesoId = newId();
  const temperature: Project['characters'][number] = {
    id: sampleCharacterId('archaea-temperature'),
    name: tr('温度适应性', 'Temperature adaptation'),
    type: 'discrete',
    states: [
      { id: hyperId, label: tr('超嗜热', 'Hyperthermophile'), color: '#dc2626' },
      { id: thermoId, label: tr('嗜热', 'Thermophile'), color: '#f97316' },
      { id: mesoId, label: tr('中温', 'Mesophile'), color: '#22c55e' },
    ],
  };
  project.characters = [energy, temperature];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  assign(tipsJ1, energy.id, methanoId);
  assign(tipsJ2, energy.id, methanoId);
  assign(tipsK1, energy.id, haloId);
  assign(tipsK2, energy.id, haloId);
  assign(tipsL1, energy.id, sulfurId);
  assign(tipsL2, energy.id, sulfurId);
  assign(tipsM1, energy.id, sulfurId);
  assign(tipsM2, energy.id, sulfurId);
  assign(tipsJ1, temperature.id, mesoId);
  assign(tipsJ2, temperature.id, mesoId);
  assign(tipsK1, temperature.id, mesoId);
  assign(tipsK2, temperature.id, mesoId);
  assign(tipsL1, temperature.id, hyperId);
  assign(tipsL2, temperature.id, hyperId);
  assign(tipsM1, temperature.id, thermoId);
  assign(tipsM2, temperature.id, thermoId);

  project.layers[0].name = tr('嗜热祖先', 'Thermophilic-ancestor');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, temperature.id, hyperId, 'medium', tr('深部分支证据', 'deep-branch evidence'));
  hypothesise(branchB, energy.id, methanoId, 'high', tr('核心基因保守', 'conserved core genes'));
  hypothesise(cladeE, energy.id, sulfurId, 'high', tr('硫代谢基因保守', 'conserved sulfur-metabolism genes'));

  // The 4000–4100 Ma range the root carries as a calibration bound, so the
  // document carries what it asserts and `validateTimeData` can check the root
  // age against it.
  project.calibrationPoints = [
    {
      id: newId(),
      nodeId: rootId,
      minAge: 4000,
      maxAge: 4100,
      label: tr('根年龄下限', 'root minimum bound'),
    },
  ];

  // Events
  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: cladeJ,
      label: tr('产甲烷途径', 'Methanogenesis pathway'),
      note: tr('示例谱系中的代谢创新：从 CO₂ + H₂ 生成甲烷。', 'Metabolic innovation of the sample clade: producing methane from CO₂ + H₂.'),
      confidence: 'high',
      support: tr('示例基因组注释', 'Illustrative genome annotation'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: cladeK,
      label: tr('高盐适应辐射', 'Halophilic radiation'),
      confidence: 'medium',
      triggers: [],
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('大氧化事件', 'Great Oxidation Event'),
      from: 2400,
      to: 2400,
      color: '#ef4444',
      note: tr('大气氧积累，影响厌氧代谢', 'Atmospheric oxygen accumulation affecting anaerobic metabolism'),
    },
    {
      id: newId(),
      label: tr('休伦冰期', 'Huronian glaciation'),
      from: 2400,
      to: 2100,
      color: '#0284c7',
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 3 — Fictional wall-type & oxygen demo
// ════════════════════════════════════════════════════════════════════════════
export function createWallTypeSample(): Project {
  const project = createEmptyProject(tr('壁型与氧需求', 'Wall type & oxygen'));
  project.sampleId = 'bacteria';
  const nextTaxon = taxonNamer();
  const rootId = project.rootId;
  project.nodes[rootId].label = nextTaxon(); // Taxon_A, age 3300

  // Strictly binary. The old four-way root split and the three-way thin-wall
  // split are resolved with balanced internal nodes at 3250 / 3050 / 2450 Ma,
  // and the former single-child chains are collapsed so their tips attach
  // directly to a bifurcation.
  const root = project.nodes[rootId];
  root.age = 3300; // oldest node; children range 2900–3250 Ma
  const cladeB = mkNode(project, nextTaxon(), rootId, 3250, 50);
  const cladeC = mkNode(project, nextTaxon(), rootId, 3050, 250);
  const cladeD = mkNode(project, nextTaxon(), cladeB, 3200, 50);
  const cladeE = mkNode(project, nextTaxon(), cladeB, 3100, 150);
  const cladeF = mkNode(project, nextTaxon(), cladeD, 2500, 700);
  const cladeG = mkNode(project, nextTaxon(), cladeD, 2450, 750);
  const tipH = mkNode(project, nextTaxon(), cladeG, 2400, 50);
  const tipI = mkNode(project, nextTaxon(), cladeG, 2300, 150);
  const cladeJ = mkNode(project, nextTaxon(), cladeF, 2000, 500);
  const cladeK = mkNode(project, nextTaxon(), cladeF, 1900, 600);
  const tipsJ1 = mkNode(project, nextTaxon(), cladeJ, 0, 2000);
  const tipsJ2 = mkNode(project, nextTaxon(), cladeJ, 0, 2000);
  const tipsK1 = mkNode(project, nextTaxon(), cladeK, 0, 1900);
  const tipsK2 = mkNode(project, nextTaxon(), cladeK, 0, 1900);
  const tipsE1 = mkNode(project, nextTaxon(), cladeE, 0, 3100);
  const tipsE2 = mkNode(project, nextTaxon(), cladeE, 0, 3100);
  const cladeL = mkNode(project, nextTaxon(), cladeC, 3000, 50);
  const cladeM = mkNode(project, nextTaxon(), cladeC, 2900, 150);
  const tipsL1 = mkNode(project, nextTaxon(), cladeL, 0, 3000);
  const tipsL2 = mkNode(project, nextTaxon(), cladeL, 0, 3000);
  const tipsM1 = mkNode(project, nextTaxon(), cladeM, 0, 2900);
  const tipsM2 = mkNode(project, nextTaxon(), cladeM, 0, 2900);

  // --- characters: wall type + oxygen ---
  const thickId = newId();
  const thinId = newId();
  const wall: Project['characters'][number] = {
    id: sampleCharacterId('bacteria-wall'),
    name: tr('细胞壁类型', 'Cell wall type'),
    type: 'discrete',
    states: [
      { id: thickId, label: tr('革兰阳性', 'Gram-positive'), color: '#7c3aed' },
      { id: thinId, label: tr('革兰阴性', 'Gram-negative'), color: '#0ea5e9' },
    ],
    description: tr('示例谱系的细胞壁结构二态（虚构类群）。', 'A two-state sample cell-wall character across the fictional clades.'),
  };
  const aerId = newId();
  const anaId = newId();
  const facId = newId();
  const oxygen: Project['characters'][number] = {
    id: sampleCharacterId('bacteria-oxygen'),
    name: tr('氧需求', 'Oxygen requirement'),
    type: 'discrete',
    states: [
      { id: aerId, label: tr('好氧', 'Aerobic'), color: '#22c55e' },
      { id: anaId, label: tr('厌氧', 'Anaerobic'), color: '#71717a' },
      { id: facId, label: tr('兼性厌氧', 'Facultative anaerobe'), color: '#f59e0b' },
    ],
  };
  project.characters = [wall, oxygen];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  assign(tipsL1, wall.id, thinId);
  assign(tipsL2, wall.id, thinId);
  assign(tipsJ1, wall.id, thinId);
  assign(tipsJ2, wall.id, thinId);
  assign(tipsK1, wall.id, thinId);
  assign(tipsK2, wall.id, thinId);
  assign(tipH, wall.id, thinId);
  assign(tipI, wall.id, thinId);
  assign(tipsM1, wall.id, thinId);
  assign(tipsM2, wall.id, thinId);
  assign(tipsE1, wall.id, thickId);
  assign(tipsE2, wall.id, thickId);

  assign(tipsL1, oxygen.id, facId);
  assign(tipsL2, oxygen.id, aerId);
  assign(tipsJ1, oxygen.id, aerId);
  assign(tipsJ2, oxygen.id, aerId);
  assign(tipsK1, oxygen.id, anaId);
  assign(tipsK2, oxygen.id, anaId);
  assign(tipH, oxygen.id, anaId);
  assign(tipI, oxygen.id, anaId);
  assign(tipsM1, oxygen.id, aerId);
  assign(tipsM2, oxygen.id, aerId);
  assign(tipsE1, oxygen.id, anaId);
  assign(tipsE2, oxygen.id, facId);

  project.layers[0].name = tr('革兰阴性祖先', 'Gram-negative ancestor');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, wall.id, thickId, 'low', tr('壁结构保守性', 'wall-structure conservation'));
  hypothesise(cladeD, wall.id, thinId, 'high', tr('双层结构证据', 'double-layer evidence'));
  hypothesise(cladeE, wall.id, thickId, 'high', tr('革兰阳性细胞壁证据', 'Gram-positive cell-wall evidence'));
  hypothesise(cladeF, oxygen.id, facId, 'medium', tr('代谢灵活性', 'metabolic flexibility'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: cladeM,
      label: tr('产氧代谢', 'Oxygenic metabolism'),
      note: tr('示例谱系中的关键创新：以水为电子供体的产氧代谢。', 'Key innovation of the sample clade: oxygenic metabolism with water as electron donor.'),
      confidence: 'high',
      support: tr('示例基因组注释', 'Illustrative genome annotation'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: cladeF,
      label: tr('代谢辐射', 'Metabolic radiation'),
      confidence: 'medium',
      triggers: [],
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('大氧化事件', 'Great Oxidation Event'),
      from: 2400,
      to: 2400,
      color: '#ef4444',
      note: tr('产氧代谢导致大气氧积累', 'oxygenic metabolism led to atmospheric oxygen accumulation'),
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 4 — Fictional viral evolution
// ════════════════════════════════════════════════════════════════════════════
export function createVirusSample(): Project {
  const project = createEmptyProject(tr('病毒演化', 'Viral evolution'));
  project.sampleId = 'virus';
  const nextTaxon = taxonNamer();
  const rootId = project.rootId;
  project.nodes[rootId].label = nextTaxon(); // Taxon_A, age 4200

  // Strictly binary. The old four-way RNA split becomes two balanced internal
  // nodes (3050 / 2850 Ma); the three-way splits further down are resolved the
  // same way, and the former single-child clades are collapsed so their single
  // tip attaches to a bifurcation.
  const root = project.nodes[rootId];
  root.age = 4200; // oldest node; children are 3800–4000 Ma
  const rnaClade = mkNode(project, nextTaxon(), rootId, 4000, 200);
  const dnaClade = mkNode(project, nextTaxon(), rootId, 3800, 400);
  const rnaUp = mkNode(project, nextTaxon(), rnaClade, 3050, 950);
  const rnaDown = mkNode(project, nextTaxon(), rnaClade, 2850, 1150);
  const posClade = mkNode(project, nextTaxon(), rnaUp, 3000, 50);
  const negClade = mkNode(project, nextTaxon(), rnaUp, 2900, 150);
  const posInner = mkNode(project, nextTaxon(), posClade, 1550, 1450);
  const posPair = mkNode(project, nextTaxon(), posInner, 1500, 50);
  const posPair2 = mkNode(project, nextTaxon(), posInner, 1400, 150);
  const tipPlant = mkNode(project, nextTaxon(), posClade, 0, 3000);
  const tipsPos11 = mkNode(project, nextTaxon(), posPair, 0, 1500);
  const tipsPos12 = mkNode(project, nextTaxon(), posPair, 0, 1500);
  const tipsPos21 = mkNode(project, nextTaxon(), posPair2, 0, 1400);
  const tipsPos22 = mkNode(project, nextTaxon(), posPair2, 0, 1400);
  const negInner = mkNode(project, nextTaxon(), negClade, 1300, 1600);
  const negInner2 = mkNode(project, nextTaxon(), negInner, 1250, 50);
  const tipNegSolo = mkNode(project, nextTaxon(), negClade, 0, 2900);
  const tipNegSolo2 = mkNode(project, nextTaxon(), negInner, 0, 1300);
  const tipsNeg11 = mkNode(project, nextTaxon(), negInner2, 0, 1250);
  const tipsNeg12 = mkNode(project, nextTaxon(), negInner2, 0, 1250);
  const dsRna = mkNode(project, nextTaxon(), rnaDown, 2800, 50);
  const retroClade = mkNode(project, nextTaxon(), rnaDown, 2700, 150);
  const tipsDs1 = mkNode(project, nextTaxon(), dsRna, 0, 2800);
  const tipsDs2 = mkNode(project, nextTaxon(), dsRna, 0, 2800);
  const tipsRetro1 = mkNode(project, nextTaxon(), retroClade, 0, 2700);
  const tipsRetro2 = mkNode(project, nextTaxon(), retroClade, 0, 2700);
  const duplivira = mkNode(project, nextTaxon(), dnaClade, 2500, 1300);
  const dnaDown = mkNode(project, nextTaxon(), dnaClade, 2450, 1350);
  mkNode(project, nextTaxon(), duplivira, 0, 2500);
  const tailClade = mkNode(project, nextTaxon(), duplivira, 1250, 1250);
  const latClade = mkNode(project, nextTaxon(), tailClade, 1200, 50);
  const caudClade = mkNode(project, nextTaxon(), tailClade, 1100, 150);
  const tipsLat1 = mkNode(project, nextTaxon(), latClade, 0, 1200);
  const tipsLat2 = mkNode(project, nextTaxon(), latClade, 0, 1200);
  const tipsCaud1 = mkNode(project, nextTaxon(), caudClade, 0, 1100);
  const tipsCaud2 = mkNode(project, nextTaxon(), caudClade, 0, 1100);
  const ssClade = mkNode(project, nextTaxon(), dnaDown, 2400, 50);
  const tipsSs1 = mkNode(project, nextTaxon(), ssClade, 0, 2400);
  const tipsSs2 = mkNode(project, nextTaxon(), ssClade, 0, 2400);
  const tipGiant = mkNode(project, nextTaxon(), dnaDown, 0, 2450);

  // --- characters: genome type + host ---
  const rnaId = newId();
  const dnaId = newId();
  const genome: Project['characters'][number] = {
    id: sampleCharacterId('virus-genome'),
    name: tr('基因组类型', 'Genome type'),
    type: 'discrete',
    states: [
      { id: rnaId, label: 'RNA', color: '#3b82f6' },
      { id: dnaId, label: 'DNA', color: '#dc2626' },
    ],
    description: tr('示例谱系遗传物质的核酸类型（虚构类群）。', 'Nucleic acid type of the fictional sample genomes.'),
  };
  const animalId = newId();
  const plantId = newId();
  const bactId = newId();
  // The giant-virus tip infects free-living amoebae in this fictional world, so
  // its host state is 原生生物 rather than 细菌: a sample teaches whatever host
  // association it encodes, and the assignment is kept internally consistent.
  const protistId = newId();
  const host: Project['characters'][number] = {
    id: sampleCharacterId('virus-host'),
    name: tr('宿主类型', 'Host type'),
    type: 'discrete',
    states: [
      { id: animalId, label: tr('动物', 'Animal'), color: '#8b5cf6' },
      { id: bactId, label: tr('细菌', 'Bacterial'), color: '#f59e0b' },
      { id: plantId, label: tr('植物', 'Plant'), color: '#22c55e' },
      { id: protistId, label: tr('原生生物（阿米巴）', 'Protist (amoeba)'), color: '#14b8a6' },
    ],
  };
  project.characters = [genome, host];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  // RNA side
  for (const tip of [tipsPos11, tipsPos12, tipsPos21, tipsPos22, tipPlant, tipNegSolo, tipNegSolo2, tipsNeg11, tipsNeg12, tipsDs1, tipsDs2, tipsRetro1, tipsRetro2]) {
    assign(tip, genome.id, rnaId);
  }
  // DNA side
  for (const tip of [tipsLat1, tipsLat2, tipsCaud1, tipsCaud2, tipsSs1, tipsSs2, tipGiant]) {
    assign(tip, genome.id, dnaId);
  }

  // Host assignments
  for (const tip of [tipsPos11, tipsPos12, tipsPos21, tipsPos22, tipNegSolo, tipNegSolo2, tipsNeg11, tipsNeg12, tipsDs1, tipsDs2, tipsRetro1, tipsRetro2, tipsLat1, tipsLat2, tipsSs1, tipsSs2]) {
    assign(tip, host.id, animalId);
  }
  assign(tipsCaud1, host.id, bactId);
  assign(tipsCaud2, host.id, bactId);
  // The plant tip is the sample plant-infecting lineage; the giant-virus tip is
  // the sample nucleocytoplasmic virus of amoebae, NOT a bacteriophage.
  assign(tipPlant, host.id, plantId);
  assign(tipGiant, host.id, protistId);

  project.layers[0].name = tr('RNA祖先', 'RNA-ancestor');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, genome.id, rnaId, 'low', tr('早期复制子假说', 'early replicator hypothesis'));
  hypothesise(rnaClade, genome.id, rnaId, 'high', tr('RNA依赖的复制酶', 'RNA-dependent replicase'));
  hypothesise(dnaClade, genome.id, dnaId, 'high', tr('DNA聚合酶同源', 'DNA polymerase homology'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: retroClade,
      label: tr('逆转录整合', 'Reverse transcription & integration'),
      note: tr('示例谱系中的关键创新：逆转录酶使RNA基因组可整合入宿主DNA。', 'Key innovation of the sample clade: reverse transcriptase enabling RNA genome integration.'),
      confidence: 'high',
      support: tr('示例基因组注释', 'Illustrative genome annotation'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: posClade,
      label: tr('阳性链辐射', 'Positive-sense radiation'),
      confidence: 'medium',
      triggers: [],
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 5 — Fictional plant terrestrialization
// ════════════════════════════════════════════════════════════════════════════
export function createPlantSample(): Project {
  const project = createEmptyProject(tr('陆地植物化', 'Plant terrestrialization'));
  project.sampleId = 'plant';
  const nextTaxon = taxonNamer();
  const rootId = project.rootId;
  project.nodes[rootId].label = nextTaxon(); // Taxon_A, age 520

  // Strictly binary; branchLength = parent.age − node.age: the root's two
  // daughters are 20 and 50 (520 − 500, 520 − 470).
  const root = project.nodes[rootId];
  root.age = 520; // oldest node; children are 470–500 Ma
  const algae = mkNode(project, nextTaxon(), rootId, 500, 20);
  const landPlants = mkNode(project, nextTaxon(), rootId, 470, 50);
  const bryia = mkNode(project, nextTaxon(), landPlants, 450, 20);
  const trachea = mkNode(project, nextTaxon(), landPlants, 430, 40);
  const lycopia = mkNode(project, nextTaxon(), trachea, 410, 20);
  const euphyllo = mkNode(project, nextTaxon(), trachea, 400, 30);
  const monilia = mkNode(project, nextTaxon(), euphyllo, 380, 20);
  const sperma = mkNode(project, nextTaxon(), euphyllo, 370, 30);
  const gymna = mkNode(project, nextTaxon(), sperma, 350, 20);
  const angia = mkNode(project, nextTaxon(), sperma, 340, 30);
  const mona = mkNode(project, nextTaxon(), angia, 140, 200);
  const eudia = mkNode(project, nextTaxon(), angia, 130, 210);
  const tipsA1 = mkNode(project, nextTaxon(), algae, 0, 500);
  const tipsA2 = mkNode(project, nextTaxon(), algae, 0, 500);
  const tipsB1 = mkNode(project, nextTaxon(), bryia, 0, 450);
  const tipsB2 = mkNode(project, nextTaxon(), bryia, 0, 450);
  const tipsC1 = mkNode(project, nextTaxon(), lycopia, 0, 410);
  const tipsC2 = mkNode(project, nextTaxon(), lycopia, 0, 410);
  const tipsD1 = mkNode(project, nextTaxon(), monilia, 0, 380);
  const tipsD2 = mkNode(project, nextTaxon(), monilia, 0, 380);
  const tipsE1 = mkNode(project, nextTaxon(), gymna, 0, 350);
  const tipsE2 = mkNode(project, nextTaxon(), gymna, 0, 350);
  const tipsF1 = mkNode(project, nextTaxon(), mona, 0, 140);
  const tipsF2 = mkNode(project, nextTaxon(), mona, 0, 140);
  const tipsG1 = mkNode(project, nextTaxon(), eudia, 0, 130);
  const tipsG2 = mkNode(project, nextTaxon(), eudia, 0, 130);

  // --- characters ---
  const aqId = newId();
  const semiId = newId();
  const terrId = newId();
  const habitat: Project['characters'][number] = {
    id: sampleCharacterId('plant-habitat'),
    name: tr('生境', 'Habitat'),
    type: 'discrete',
    states: [
      { id: aqId, label: tr('水生', 'Aquatic'), color: '#0ea5e9' },
      { id: semiId, label: tr('湿生', 'Semi-aquatic'), color: '#3b82f6' },
      { id: terrId, label: tr('陆生', 'Terrestrial'), color: '#22c55e' },
    ],
    description: tr('示例谱系从水生到陆生的栖息地转变（虚构类群）。', 'The sample clade\u2019s habitat transition from aquatic to terrestrial.'),
  };
  const noVascId = newId();
  const vascId = newId();
  const vasc: Project['characters'][number] = {
    id: sampleCharacterId('plant-vasc'),
    name: tr('维管组织', 'Vascular tissue'),
    type: 'discrete',
    states: [
      { id: noVascId, label: tr('无', 'Absent'), color: '#9ca3af' },
      { id: vascId, label: tr('有', 'Present'), color: '#7c3aed' },
    ],
  };
  const noSeedId = newId();
  const seedId = newId();
  const seed: Project['characters'][number] = {
    id: sampleCharacterId('plant-seed'),
    name: tr('种子', 'Seed'),
    type: 'discrete',
    states: [
      { id: noSeedId, label: tr('无（孢子繁殖）', 'Absent (spore)'), color: '#9ca3af' },
      { id: seedId, label: tr('有', 'Present'), color: '#dc2626' },
    ],
  };
  project.characters = [habitat, vasc, seed];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  assign(tipsA1, habitat.id, aqId);
  assign(tipsA2, habitat.id, aqId);
  assign(tipsB1, habitat.id, semiId);
  assign(tipsB2, habitat.id, semiId);
  assign(tipsC1, habitat.id, terrId);
  assign(tipsC2, habitat.id, terrId);
  assign(tipsD1, habitat.id, terrId);
  assign(tipsD2, habitat.id, terrId);
  assign(tipsE1, habitat.id, terrId);
  assign(tipsE2, habitat.id, terrId);
  assign(tipsF1, habitat.id, semiId);
  assign(tipsF2, habitat.id, terrId);
  assign(tipsG1, habitat.id, terrId);
  assign(tipsG2, habitat.id, terrId);

  for (const tip of [tipsC1, tipsC2, tipsD1, tipsD2, tipsE1, tipsE2, tipsF1, tipsF2, tipsG1, tipsG2]) {
    assign(tip, vasc.id, vascId);
  }
  for (const tip of [tipsA1, tipsA2, tipsB1, tipsB2]) {
    assign(tip, vasc.id, noVascId);
  }

  for (const tip of [tipsA1, tipsA2, tipsB1, tipsB2, tipsC1, tipsC2, tipsD1, tipsD2]) {
    assign(tip, seed.id, noSeedId);
  }
  for (const tip of [tipsE1, tipsE2, tipsF1, tipsF2, tipsG1, tipsG2]) {
    assign(tip, seed.id, seedId);
  }

  project.layers[0].name = tr('水生祖先', 'Aquatic-ancestor');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, habitat.id, aqId, 'high', tr('近缘水生类群', 'closely related aquatic taxa'));
  hypothesise(landPlants, habitat.id, semiId, 'medium', tr('早期陆生记录', 'early land record'));
  hypothesise(landPlants, vasc.id, noVascId, 'high', tr('早期类群无维管', 'early taxa lack vasculature'));
  hypothesise(trachea, vasc.id, vascId, 'high', tr('输运组织证据', 'transport-tissue evidence'));
  hypothesise(sperma, seed.id, seedId, 'high', tr('种子结构证据', 'seed-structure evidence'));
  hypothesise(euphyllo, vasc.id, vascId, 'high', tr('大型叶证据', 'megaphyll evidence'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: landPlants,
      label: tr('角质层与气孔', 'Cuticle & stomata'),
      note: tr('示例谱系的关键创新：防水角质层和可调节气孔。', 'Key innovations of the sample clade: waterproof cuticle and regulatable stomata.'),
      confidence: 'high',
      support: tr('角质层记录', 'cuticle record'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: trachea,
      label: tr('维管系统', 'Vascular system'),
      note: tr('示例谱系的关键创新：输运系统使植物体大型化成为可能。', 'Key innovation of the sample clade: a transport system enabling large body size.'),
      confidence: 'high',
      support: tr('管胞记录', 'tracheid record'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: angia,
      label: tr('被子植物辐射', 'Angiosperm radiation'),
      confidence: 'medium',
      triggers: [],
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('奥陶纪末大灭绝', 'End-Ordovician extinction'),
      from: 444,
      to: 444,
      color: '#ef4444',
    },
    {
      id: newId(),
      label: tr('泥盆纪末大灭绝', 'Late Devonian extinction'),
      from: 375,
      to: 375,
      color: '#ef4444',
    },
    {
      id: newId(),
      label: tr('白垩纪-古近纪界线', 'K–Pg boundary'),
      from: 66,
      to: 66,
      color: '#ef4444',
      note: tr('被子植物分支在 K–Pg 后快速辐射', 'the angiosperm clade radiated rapidly after the K–Pg boundary'),
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 6 — Fictional land-invasion (tetrapod-style) demo
// ════════════════════════════════════════════════════════════════════════════
export function createAnimalSample(): Project {
  const project = createEmptyProject(tr('四足登陆', 'Tetrapod land invasion'));
  project.sampleId = 'animal';
  const nextTaxon = taxonNamer();
  const rootId = project.rootId;
  project.nodes[rootId].label = nextTaxon(); // Taxon_A, age 430

  // Strictly binary. The old three-way splits (lobe-finned branch, amniote
  // branch, placental branch) are resolved with balanced internal nodes, and the
  // former single-child chains (the crocodile / sauropod / monotreme sides) are
  // collapsed so each remaining tip attaches to a bifurcation.
  const root = project.nodes[rootId];
  root.age = 430; // oldest node; first child is 410 Ma
  const podomorpha = mkNode(project, nextTaxon(), rootId, 410, 20);
  const tipMeria = mkNode(project, nextTaxon(), rootId, 0, 430);
  const finPair = mkNode(project, nextTaxon(), podomorpha, 390, 20);
  const tipFin1 = mkNode(project, nextTaxon(), finPair, 0, 390);
  const tipFin2 = mkNode(project, nextTaxon(), finPair, 0, 390);
  const tetra = mkNode(project, nextTaxon(), podomorpha, 380, 30);
  const tetraUp = mkNode(project, nextTaxon(), tetra, 370, 10);
  const amphibGroup = mkNode(project, nextTaxon(), tetraUp, 360, 10);
  const stegaPair = mkNode(project, nextTaxon(), tetraUp, 355, 15);
  const amnia = mkNode(project, nextTaxon(), tetra, 320, 60);
  const tipStega1 = mkNode(project, nextTaxon(), stegaPair, 0, 355);
  const tipStega2 = mkNode(project, nextTaxon(), stegaPair, 0, 355);
  const tipAmph1 = mkNode(project, nextTaxon(), amphibGroup, 0, 360);
  const tipAmph2 = mkNode(project, nextTaxon(), amphibGroup, 0, 360);
  const herpia = mkNode(project, nextTaxon(), amnia, 310, 10);
  const mammalia = mkNode(project, nextTaxon(), amnia, 200, 120);
  const lepGroup = mkNode(project, nextTaxon(), herpia, 265, 45);
  const archosa = mkNode(project, nextTaxon(), herpia, 250, 60);
  const lepida = mkNode(project, nextTaxon(), lepGroup, 260, 5);
  const tipTestudinis = mkNode(project, nextTaxon(), lepGroup, 0, 265);
  const tipLacertis = mkNode(project, nextTaxon(), lepida, 0, 260);
  const tipSerpentis = mkNode(project, nextTaxon(), lepida, 0, 260);
  const magna = mkNode(project, nextTaxon(), archosa, 230, 20);
  const tipCroci = mkNode(project, nextTaxon(), archosa, 0, 250);
  const thera = mkNode(project, nextTaxon(), magna, 200, 30);
  const tipBrachio = mkNode(project, nextTaxon(), magna, 0, 230);
  const avia = mkNode(project, nextTaxon(), thera, 150, 50);
  const tipTyranno = mkNode(project, nextTaxon(), thera, 0, 200);
  const tipGalla = mkNode(project, nextTaxon(), avia, 0, 150);
  const tipPassera = mkNode(project, nextTaxon(), avia, 0, 150);
  const tipOrnitho = mkNode(project, nextTaxon(), mammalia, 0, 200);
  const marsupialGroup = mkNode(project, nextTaxon(), mammalia, 80, 120);
  const placenta = mkNode(project, nextTaxon(), marsupialGroup, 65, 15);
  const tipDelphis = mkNode(project, nextTaxon(), marsupialGroup, 0, 80);
  const primatesPair = mkNode(project, nextTaxon(), placenta, 30, 35);
  const tipLupus = mkNode(project, nextTaxon(), placenta, 0, 65);
  const tipPrimas = mkNode(project, nextTaxon(), primatesPair, 0, 30);
  const tipMuris = mkNode(project, nextTaxon(), primatesPair, 0, 30);

  // --- characters: habitat + limbs ---
  const aqId = newId();
  const semiId = newId();
  const terrId = newId();
  const flyId = newId();
  const habitat: Project['characters'][number] = {
    id: sampleCharacterId('animal-habitat'),
    name: tr('生境', 'Habitat'),
    type: 'discrete',
    states: [
      { id: aqId, label: tr('水生', 'Aquatic'), color: '#0ea5e9' },
      { id: semiId, label: tr('半水生', 'Semi-aquatic'), color: '#3b82f6' },
      { id: terrId, label: tr('陆生', 'Terrestrial'), color: '#22c55e' },
      { id: flyId, label: tr('飞行', 'Aerial'), color: '#8b5cf6' },
    ],
    description: tr('示例谱系从水生到陆生的栖息地演化（虚构类群）。', 'Habitat evolution from aquatic to terrestrial across the sample clade.'),
  };
  const finId = newId();
  const digId = newId();
  const wingId = newId();
  const limb: Project['characters'][number] = {
    id: sampleCharacterId('animal-limb'),
    name: tr('附肢类型', 'Appendage type'),
    type: 'discrete',
    states: [
      { id: finId, label: tr('鳍', 'Fin'), color: '#0284c7' },
      { id: digId, label: tr('趾型', 'Digiti-grade limbs'), color: '#b45309' },
      { id: wingId, label: tr('翼', 'Wing'), color: '#8b5cf6' },
    ],
  };
  project.characters = [habitat, limb];

  const assign = (nodeId: string, charId: string, stateId: string) =>
    assignStateAt(project, nodeId, charId, stateId);
  assign(tipFin1, habitat.id, aqId);
  assign(tipFin2, habitat.id, semiId);
  assign(tipStega1, habitat.id, semiId);
  assign(tipStega2, habitat.id, semiId);
  assign(tipAmph1, habitat.id, semiId);
  assign(tipAmph2, habitat.id, semiId);
  assign(tipLacertis, habitat.id, terrId);
  assign(tipSerpentis, habitat.id, terrId);
  assign(tipTestudinis, habitat.id, terrId);
  assign(tipCroci, habitat.id, semiId);
  assign(tipBrachio, habitat.id, terrId);
  assign(tipTyranno, habitat.id, terrId);
  assign(tipGalla, habitat.id, flyId);
  assign(tipPassera, habitat.id, flyId);
  assign(tipOrnitho, habitat.id, semiId);
  assign(tipDelphis, habitat.id, terrId);
  assign(tipPrimas, habitat.id, terrId);
  assign(tipMuris, habitat.id, terrId);
  assign(tipLupus, habitat.id, terrId);
  // Extant sample sister lineage: fully aquatic, fin-bearing.
  assign(tipMeria, habitat.id, aqId);

  assign(tipFin1, limb.id, finId);
  assign(tipFin2, limb.id, finId);
  assign(tipStega1, limb.id, digId);
  assign(tipStega2, limb.id, digId);
  assign(tipAmph1, limb.id, digId);
  assign(tipAmph2, limb.id, digId);
  assign(tipLacertis, limb.id, digId);
  assign(tipSerpentis, limb.id, digId);
  assign(tipTestudinis, limb.id, digId);
  assign(tipCroci, limb.id, digId);
  assign(tipBrachio, limb.id, digId);
  assign(tipTyranno, limb.id, digId);
  assign(tipGalla, limb.id, wingId);
  assign(tipPassera, limb.id, wingId);
  assign(tipOrnitho, limb.id, digId);
  assign(tipDelphis, limb.id, digId);
  assign(tipPrimas, limb.id, digId);
  assign(tipMuris, limb.id, digId);
  assign(tipLupus, limb.id, digId);
  assign(tipMeria, limb.id, finId);

  project.layers[0].name = tr('水生祖先', 'Aquatic-ancestor');
  const hypothesise = (
    nodeId: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseStateAt(project, nodeId, charId, stateId, confidence, support);
  hypothesise(rootId, habitat.id, aqId, 'high', tr('肉鳍状记录', 'lobe-fin-like record'));
  hypothesise(tetra, habitat.id, semiId, 'high', tr('过渡型记录', 'transitional record'));
  hypothesise(tetra, limb.id, digId, 'high', tr('多趾型记录', 'polydactylous record'));
  hypothesise(amnia, habitat.id, terrId, 'high', tr('羊膜卵记录', 'amniotic-egg record'));
  hypothesise(thera, limb.id, digId, 'high', tr('后肢记录', 'hindlimb record'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: tetra,
      label: tr('四肢与趾型', 'Limbs with digits'),
      note: tr('示例谱系的关键转变：从鳍到四肢，得以登陆。', 'The sample clade\u2019s key transition: from fins to limbs, enabling land invasion.'),
      confidence: 'high',
      support: tr('过渡型化石记录', 'transitional-fossil record'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: amnia,
      label: tr('羊膜卵', 'Amniotic egg'),
      note: tr('示例谱系的关键创新：羊膜卵使繁殖脱离水体。', 'Key innovation of the sample clade: the amniotic egg freeing reproduction from water.'),
      confidence: 'high',
      support: tr('蛋壳记录', 'eggshell record'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: avia,
      label: tr('飞行', 'Powered flight'),
      note: tr('示例谱系的关键创新：动力飞行的起源，与羽毛演化密切相关。', 'Key innovation of the sample clade: powered flight, tied to feather evolution.'),
      confidence: 'medium',
      support: tr('羽毛印痕记录', 'feather-impression record'),
      triggers: [],
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('泥盆纪末大灭绝', 'Late Devonian extinction'),
      from: 375,
      to: 375,
      color: '#ef4444',
    },
    {
      id: newId(),
      label: tr('二叠纪-三叠纪大灭绝', 'Permian–Triassic extinction'),
      from: 252,
      to: 252,
      color: '#ef4444',
      note: tr('史上最大灭绝事件', 'Largest extinction event in Earth history'),
    },
    {
      id: newId(),
      label: tr('白垩纪-古近纪界线', 'K–Pg boundary'),
      from: 66,
      to: 66,
      color: '#ef4444',
      note: tr('大型陆生类群更替', 'turnover of large land taxa'),
    },
  ];

  assertBinary(project);
  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 7 — Gene-family reconciliation (opens into the reconciliation view)
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
    id: 'recon-family',
    label: '基因家族协调',
    labelEn: 'Gene-family reconciliation',
    desc: '两棵基因树与物种树的 DTL 协调示例：各含一例基因重复、水平转移与基因丢失（虚构示例）。',
    descEn: 'A DTL reconciliation sample of two gene trees against a species tree: one gene duplication, one horizontal transfer and one gene loss (fictional dataset).',
    build: createReconciliationSample,
    entryView: 'recon',
  },
  {
    id: 'archaea',
    label: '深域辐射',
    labelEn: 'Deep-domain radiation',
    desc: '两大分支的能量代谢与温度适应性演化（虚构示例）',
    descEn: 'Energy metabolism and temperature adaptation across fictional phyla (fictional dataset)',
    build: createDeepDomainSample,
  },
  {
    id: 'bacteria',
    label: '壁型与氧需求',
    labelEn: 'Wall type & oxygen',
    desc: '细胞壁类型、氧需求与产氧代谢创新（虚构示例）',
    descEn: 'Cell-wall type, oxygen requirement, and oxygenic-metabolism innovation (fictional dataset)',
    build: createWallTypeSample,
  },
  {
    id: 'virus',
    label: '病毒演化',
    labelEn: 'Viral evolution',
    desc: '病毒基因组类型、宿主范围与逆转录创新（虚构示例）',
    descEn: 'Genome types, host range, and reverse-transcription innovation (fictional dataset)',
    build: createVirusSample,
  },
  {
    id: 'cetacean',
    label: '水生适应',
    labelEn: 'Aquatic adaptation',
    desc: '从陆地到水生的栖息地与运动方式变化（虚构示例）',
    descEn: 'Terrestrial-to-aquatic habitat and locomotion shift of a fictional clade (fictional dataset)',
    build: createAquaticSample,
  },
  {
    id: 'plant',
    label: '陆地植物化',
    labelEn: 'Plant terrestrialization',
    desc: '维管组织与种子的演化，从水生藻类到被子植物（虚构示例）',
    descEn: 'Vascular tissue and seed evolution from aquatic algae to angiosperms (fictional dataset)',
    build: createPlantSample,
  },
  {
    id: 'animal',
    label: '四足登陆',
    labelEn: 'Tetrapod land invasion',
    desc: '从鳍到四肢、羊膜卵与飞行的演化（虚构示例）',
    descEn: 'From fins to limbs, amniotic egg, and flight (fictional dataset)',
    build: createAnimalSample,
  },
];
