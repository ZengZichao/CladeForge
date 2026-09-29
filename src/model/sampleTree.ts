// Factory helpers for new / sample projects.

import {
  DEFAULT_CANVAS,
  DEFAULT_LAYOUT,
  DEFAULT_RECON_COSTS,
  PROJECT_VERSION,
  defaultStyleDefaults,
  type Project,
  type TreeNode,
} from './types';
import { newId } from './treeOps';
import { defaultLayers } from './layers';
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
}

// ── helpers ───────────────────────────────────────────────────────────────
// These documents are hard-coded *scientific data*, so the helpers verify it
// instead of quietly accepting whatever was typed: every edge has to satisfy the
// branch-length / node-age identity, every label lookup has to resolve to exactly
// one node, and every declared state has to be carried by at least one tip.

/**
 * Look a sample node up by label, LOUDLY. `find((n) => n.label === label)` behind
 * an `if (node) …` lets a renamed or duplicated label silently drop the state it
 * was meant to address, so every lookup must resolve exactly one node or throw.
 */
function nodeByLabel(project: Project, label: string): TreeNode {
  const matches = Object.values(project.nodes).filter((n) => n.label === label);
  if (matches.length === 0) throw new Error(`sampleTree: no node labelled "${label}"`);
  if (matches.length > 1) {
    throw new Error(`sampleTree: ${matches.length} nodes share the label "${label}"`);
  }
  return matches[0];
}

/** Assign an observed state to a node, checking character, state and label. */
function assignState(project: Project, label: string, characterId: string, stateId: string): void {
  const character = project.characters.find((c) => c.id === characterId);
  if (!character) throw new Error(`sampleTree: unknown character "${characterId}" for "${label}"`);
  if (!character.states.some((s) => s.id === stateId)) {
    throw new Error(
      `sampleTree: state "${stateId}" is not declared by character "${character.name}" (assigning to "${label}")`,
    );
  }
  const node = nodeByLabel(project, label);
  node.charStates = { ...node.charStates, [characterId]: stateId };
}

/**
 * Assert an internal node's hypothesised ancestral state together with the
 * evidence behind it (confidence + supporting character).
 */
function hypothesiseState(
  project: Project,
  label: string,
  characterId: string,
  stateId: string,
  confidence: 'high' | 'medium' | 'low',
  support: string,
): void {
  assignState(project, label, characterId, stateId);
  const node = nodeByLabel(project, label);
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

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 1 — Cetacean aquatic transition (the default project on first run)
// ════════════════════════════════════════════════════════════════════════════
export function createSampleProject(): Project {
  return createCetaceanSample();
}

export function createCetaceanSample(): Project {
  const project = createEmptyProject(tr('鲸类水生适应', 'Cetacean aquatic transition'));
  project.sampleId = 'cetacean';
  const rootId = project.rootId;
  project.nodes[rootId].label = 'Cetacea';
  project.nodes[rootId].age = 53; // oldest node; inside the root calibration [52, 55] below

  // Time-tree identity on every edge: branchLength = parent.age − node.age, so the
  // root's two children carry 1 and 5 (53 − 52, 53 − 48). Any other pair puts the
  // phylogram and the time axis in disagreement about the same branch, which is
  // what `mkNode` refuses to build.
  const pelagiceti = mkNode(project, 'Pelagiceti', rootId, 52, 1);
  const pakicetus = mkNode(project, 'Pakicetus', rootId, 48, 5);
  const ambulocetus = mkNode(project, 'Ambulocetus', pelagiceti, 45, 7);
  const basilosauridae = mkNode(project, 'Basilosauridae', pelagiceti, 41, 11);
  const neoceti = mkNode(project, 'Neoceti', basilosauridae, 35, 6);
  mkNode(project, 'Mysticeti', neoceti, 0, 35);
  mkNode(project, 'Odontoceti', neoceti, 0, 35);

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
      '陆生 → 半水生 → 水生的鲸类栖息地转变。',
      'The terrestrial-to-aquatic habitat transition in cetaceans.',
    ),
    // Sankoff step matrix, rows/columns in `states` order (陆生/半水生/水生):
    // an ORDERED (additive, direction-symmetric) matrix over a linearly ordered
    // character — adjacent states cost 2 (陆↔半) and 1 (半↔水), and the direct
    // 陆↔水 step costs exactly 3 = 2 + 1. That is the scientific statement this
    // sample makes: reaching the fully aquatic habitus is a STEPWISE transition
    // through the semi-aquatic stage, with no shortcut cheaper than going
    // through it, while the reverse step is possible but costs as much as going
    // forward. These are the weights the on-screen cost band and the parsimony
    // baselines are computed with, and the same numbers `scriptExport.ts` embeds as
    // an R `matrix(c(...))` literal: the exported R script, the NEXUS ASSUMPTIONS
    // block and the cost band all read this one matrix, so they cannot disagree.
    // *Locomotion* below is priced the other way on purpose — this project needs
    // one character that is priced by a graded, reversible transition and one that
    // is priced by an irreversible innovation.
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
      '跖行 → 四肢划水 → 尾鳍推进的运动方式转变；推进一旦交给脊柱就不可逆。',
      'Walking to limb-paddling to tail-powered swimming; propulsion handed to the spine does not go back.',
    ),
    // Sankoff step matrix, rows/columns in `states` order (跖行/划水/摆尾), i.e.
    // walking / limb-powered paddling / tail-powered swimming. Unlike *Habitat*
    // this one is genuinely DIRECTION-ASYMMETRIC, and the reading of each cell is
    // a biological claim, not a styling choice:
    //   walk → limb      2  — the paddling stroke is a re-orientation of an
    //                          existing weight-bearing limb (elbow/ankle spools,
    //                          a flattened hand); little new anatomy is needed.
    //   limb → tail      1  — the cheapest step in the character: vertebral
    //                          undulation simply takes over propulsion while the
    //                          limb shrinks, and the limb is already streamlined.
    //   walk → tail      3  — exactly 2 + 1: additive on the forward axis, so
    //                          there is no shortcut past the limb-powered stage.
    //   limb → walk      5  — the animal has to rebuild a weight-bearing limb.
    //   tail → walk      5  — same argument one step further: the axial body plan
    //                          does not hand locomotion back to the limbs, a
    //                          Dollo-style irreversible innovation.
    //   tail → limb      5  — and it does not revert to a paddling one either.
    // Every reversal therefore costs more than any forward step, so a fully
    // tail-powered cetacean cannot be "un-derived" cheaply. The character carries
    // no internal-node hypotheses, so asymmetric pricing here cannot unbalance the
    // worked example that *Habitat* carries (see the note on the alternative layer
    // below), and since `scriptExport.ts`/`io/nexus.ts` emit both matrices per
    // character, this literal is the single source of truth for the exported R
    // script and the NEXUS ASSUMPTIONS block.
    costMatrix: [
      [0, 2, 3],
      [5, 0, 1],
      [5, 5, 0],
    ],
  };
  project.characters = [habitat, locomotion];

  // Every lookup is checked (see `assignState`): a typo or a renamed label fails
  // loudly instead of silently dropping a state.
  const assign = (label: string, charId: string, stateId: string) =>
    assignState(project, label, charId, stateId);
  assign('Pakicetus', habitat.id, terId);
  assign('Ambulocetus', habitat.id, semiId);
  assign('Mysticeti', habitat.id, aqId);
  assign('Odontoceti', habitat.id, aqId);
  assign('Pakicetus', locomotion.id, walkId);
  assign('Ambulocetus', locomotion.id, limbId);
  assign('Mysticeti', locomotion.id, tailId);
  assign('Odontoceti', locomotion.id, tailId);

  project.layers[0].name = tr('陆生祖先', 'Terrestrial-ancestor');
  const hypothesise = (
    label: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseState(project, label, charId, stateId, confidence, support);
  hypothesise('Cetacea', habitat.id, terId, 'high', tr('Pakicetus 踝骨形态', 'Pakicetus ankle morphology'));
  hypothesise('Pelagiceti', habitat.id, terId, 'medium', tr('Ambulocetus 骨盆', 'Ambulocetus pelvis morphology'));
  hypothesise('Basilosauridae', habitat.id, semiId, 'medium', tr('龙王鲸运动形态', 'Basilosaurus locomotor morphology'));
  hypothesise('Neoceti', habitat.id, aqId, 'high', tr('颈部解剖', 'Cervical anatomy of stem neocetes'));

  const innovationId = newId();
  const radiationId = newId();
  const buildEvents = () => [
    {
      id: innovationId,
      typeId: 'key-innovation',
      target: 'branch' as const,
      nodeId: neoceti,
      label: tr('摆尾游动', 'Tail-powered swimming'),
      note: tr(
        '椎骨衍生出的尾叶摆动推进，是通往全水生生活的关键创新。',
        'Vertebral-undulation swimming, the key innovation enabling a fully aquatic life.',
      ),
      confidence: 'high' as const,
      support: tr('椎体形态学', 'Vertebral morphology'),
      triggers: [radiationId],
    },
    {
      id: radiationId,
      typeId: 'adaptive-radiation',
      target: 'node' as const,
      nodeId: neoceti,
      label: tr('新鲸类多样化', 'Neoceti diversification'),
      confidence: 'medium' as const,
      triggers: [],
    },
  ];
  project.events = buildEvents();

  const alternativeId = newId();
  // The competing layer is a genuine alternative ROOT state, and it is priced
  // consistently with it: under the ordered step matrix above, a semi-aquatic
  // *Cetacea* pays 2 for the 半水生 → 陆生 step back to *Pakicetus* and 1 for the
  // 半水生 → 水生 step to *Neoceti* — 3 step units over 2 changes, exactly the
  // parsimony minimum. So this layer demonstrates "a different hypothesis that
  // the checker cannot fault", while the active layer (which double-books the
  // 陆生 → 半水生 step, costing 5) demonstrates what the excess-changes note is
  // for. Making this matrix direction-asymmetric (a Dollo-style irreversibility)
  // would flip that: the reversal would cost 5, the layer could never be
  // parsimony-consistent, and the exported R script's matrix literal — which is
  // pinned against this document — would change too. Asymmetric pricing is still
  // demonstrated by this project, just where it belongs scientifically: on
  // *Locomotion*, whose two layers are unassigned and so are never costed.
  project.layers.push({ id: alternativeId, name: tr('半水生祖先', 'Semi-aquatic-ancestor') });
  const altStates: Record<string, Record<string, string>> = {
    [rootId]: { [habitat.id]: semiId },
    [pelagiceti]: { [habitat.id]: semiId },
    [basilosauridae]: { [habitat.id]: semiId },
    [neoceti]: { [habitat.id]: aqId },
  };
  project.layerStore[alternativeId] = {
    states: altStates,
    meta: {
      [rootId]: {
        [habitat.id]: { confidence: 'low', support: tr('早期鲸类不确定', 'Uncertain early-cetacean record') },
      },
    },
    events: buildEvents(),
  };

  // Fossil calibration points. Each range has to cover the age of the node it
  // calibrates — `validateTimeData` checks exactly that — so the node comments
  // above describe bounds this document really carries, and no asserted age falls
  // outside its own range.
  project.calibrationPoints = [
    {
      id: newId(),
      nodeId: rootId,
      minAge: 52,
      maxAge: 55,
      label: tr('鲸类冠群下限（古生/分子界）', 'Cetacea crown bound'),
    },
    {
      id: newId(),
      nodeId: pakicetus,
      minAge: 47,
      maxAge: 50,
      label: tr('Pakicetus 化石', 'Pakicetus fossil'),
    },
    {
      id: newId(),
      nodeId: ambulocetus,
      // The type material of Ambulocetus natans comes from the same
      // Kuldana Formation beds as the pakicetids, whose mammal-bearing horizons
      // are dated late Ypresian – early Lutetian, ≈50–45 Ma (Cooper, Thewissen &
      // Hussain 2009, doi:10.1671/039.029.0423; Gingerich 2003, doi:10.1671/2409;
      // Cooper et al. 2014, doi:10.1371/journal.pone.0109232), and Gingerich 2003
      // states explicitly that the interval between the sampled levels is too
      // short for the difference to be a real age difference. A window ending at
      // 46 Ma would therefore sit BELOW every published age for the unit AND would
      // not overlap the Pakicetus window above, which the stratigraphy requires.
      // 45–49 brackets the asserted node age (45.0, fixed by the time-tree
      // identity) and overlaps 47–50 as it must.
      minAge: 45,
      maxAge: 49,
      label: tr('Ambulocetus 化石', 'Ambulocetus fossil'),
    },
    {
      id: newId(),
      nodeId: basilosauridae,
      minAge: 34,
      maxAge: 41,
      label: tr('龙王鲸科下限', 'Basilosauridae minimum'),
    },
  ];

  project.environmentalEvents = [
    {
      id: newId(),
      label: tr('始新世-渐新世交界', 'Eocene–Oligocene boundary'),
      from: 33.9,
      to: 33.9,
      color: '#ef4444',
      note: tr('全球气候转冷', 'Global cooling checkpoint'),
    },
    {
      id: newId(),
      label: tr('中中新世气候转冷', 'Mid-Miocene cooling'),
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

  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 2 — Archaeal domain evolution
// ════════════════════════════════════════════════════════════════════════════
export function createArchaeaSample(): Project {
  const project = createEmptyProject(tr('古菌域演化', 'Archaeal domain evolution'));
  project.sampleId = 'archaea';
  const rootId = project.rootId;
  project.nodes[rootId].label = 'Asgard';
  project.nodes[rootId].age = 4000; // oldest node; inside the [4000, 4100] root calibration below

  // branchLength = parent.age − node.age on every edge, so the root's children are
  // 500 and 600 (4000 − 3500, 4000 − 3400); `mkNode` rejects a length that says
  // otherwise, because the phylogram and the time axis would then disagree.
  const euryarch = mkNode(project, 'Euryarchaeota', rootId, 3500, 500);
  const tetrarch = mkNode(project, 'Tetrarchaeota', rootId, 3400, 600);
  const crenarch = mkNode(project, 'Crenarchaeota', tetrarch, 3200, 200);
  const thaumarch = mkNode(project, 'Thaumarchaeota', tetrarch, 3100, 300);
  const korarch = mkNode(project, 'Korarchaeota', tetrarch, 3000, 400);
  const nanoarch = mkNode(project, 'Nanoarchaeota', tetrarch, 2900, 500);

  // Euryarchaeota subclades
  const methano = mkNode(project, 'Methanobacteriales', euryarch, 2800, 700);
  const halophile = mkNode(project, 'Halobacteriales', euryarch, 2700, 800);
  const thermopro = mkNode(project, 'Thermoproteales', crenarch, 2600, 600);
  const sulfolob = mkNode(project, 'Sulfolobales', crenarch, 2500, 700);
  mkNode(project, 'Methanosarcina', methano, 0, 2800);
  mkNode(project, 'Methanobrevibacter', methano, 0, 2800);
  mkNode(project, 'Halobacterium', halophile, 0, 2700);
  mkNode(project, 'Natronomonas', halophile, 0, 2700);
  mkNode(project, 'Thermoproteus', thermopro, 0, 2600);
  mkNode(project, 'Pyrobaculum', thermopro, 0, 2600);
  mkNode(project, 'Sulfolobus', sulfolob, 0, 2500);
  mkNode(project, 'Metallosphaera', sulfolob, 0, 2500);

  // --- characters: metabolism ---
  // Every state gets its own id constant and the assignments address states by id:
  // indexing by POSITION (`energy.states[2].id`) means deleting or reordering a
  // state silently re-labels taxa that looked perfectly reviewed. Every declared
  // state is also carried by at least one tip, so the legend never shows a
  // category nothing uses.
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
      '古菌多样化的核心代谢途径演化。',
      'Evolution of core metabolic pathways driving archaeal diversification.',
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

  // Every lookup is checked (see `assignState`): a typo or a renamed label fails
  // loudly instead of silently dropping a state.
  const assign = (label: string, charId: string, stateId: string) =>
    assignState(project, label, charId, stateId);
  // Observed tip states
  assign('Methanosarcina', energy.id, methanoId);
  assign('Methanobrevibacter', energy.id, methanoId);
  assign('Halobacterium', energy.id, haloId);
  assign('Natronomonas', energy.id, haloId);
  assign('Thermoproteus', energy.id, sulfurId);
  assign('Pyrobaculum', energy.id, sulfurId);
  assign('Sulfolobus', energy.id, sulfurId);
  assign('Metallosphaera', energy.id, sulfurId);
  assign('Methanosarcina', temperature.id, mesoId);
  assign('Methanobrevibacter', temperature.id, mesoId);
  assign('Halobacterium', temperature.id, mesoId);
  assign('Natronomonas', temperature.id, mesoId);
  assign('Thermoproteus', temperature.id, hyperId);
  assign('Pyrobaculum', temperature.id, hyperId);
  assign('Sulfolobus', temperature.id, thermoId);
  assign('Metallosphaera', temperature.id, thermoId);

  // Hypothesise internal states
  project.layers[0].name = tr('嗜热祖先', 'Thermophilic-ancestor');
  const hypothesise = (
    label: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseState(project, label, charId, stateId, confidence, support);
  hypothesise('Asgard', temperature.id, hyperId, 'medium', tr('深部分支嗜热证据', 'Deep-branching thermophile evidence'));
  hypothesise('Euryarchaeota', energy.id, methanoId, 'high', tr('产甲烷核心基因', 'Core methanogenesis genes'));
  hypothesise('Crenarchaeota', energy.id, sulfurId, 'high', tr('硫代谢基因保守', 'Conserved sulfur metabolism genes'));

  // The 4000–4100 Ma range the root node comment claims exists as a calibration
  // point here, so the document carries the bound it asserts and
  // `validateTimeData` can check the root age against it.
  project.calibrationPoints = [
    {
      id: newId(),
      nodeId: rootId,
      minAge: 4000,
      maxAge: 4100,
      label: tr('古菌域根下限', 'Archaea root minimum bound'),
    },
  ];

  // Events
  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: methano,
      label: tr('产甲烷途径', 'Methanogenesis pathway'),
      note: tr('从CO₂+H₂产生甲烷的代谢创新，古菌独有的能量获取方式。', 'Metabolic innovation producing methane from CO₂+H₂, unique to archaea.'),
      confidence: 'high',
      support: tr('mcrABG 基因簇', 'mcrABG gene cluster'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: halophile,
      label: tr('嗜盐适应辐射', 'Halophilic radiation'),
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

  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 3 — Bacterial domain evolution
// ════════════════════════════════════════════════════════════════════════════
export function createBacteriaSample(): Project {
  const project = createEmptyProject(tr('细菌域演化', 'Bacterial domain evolution'));
  project.sampleId = 'bacteria';
  const rootId = project.rootId;
  project.nodes[rootId].label = 'Terrabacteria';
  project.nodes[rootId].age = 3300; // oldest node; children range 2900–3200 Ma

  // branchLength = parent.age − node.age on every edge: 100 / 200 / 300 / 400 for
  // children at 3200 / 3100 / 3000 / 2900 Ma under a 3300 Ma root. A constant
  // offset added to those differences leaves the branch scale and the time axis
  // describing two different trees.
  const gracilicutes = mkNode(project, 'Gracilicutes (GN)', rootId, 3200, 100);
  const firmicutes = mkNode(project, 'Firmicutes (GP)', rootId, 3100, 200);
  const actinobact = mkNode(project, 'Actinobacteria', rootId, 3000, 300);
  const cyanobact = mkNode(project, 'Cyanobacteria', rootId, 2900, 400);

  // Gram-negative clades
  const proteo = mkNode(project, 'Proteobacteria', gracilicutes, 2500, 700);
  const bacteroid = mkNode(project, 'Bacteroidetes', gracilicutes, 2400, 800);
  const spiroch = mkNode(project, 'Spirochaetes', gracilicutes, 2300, 900);

  // Proteobacteria subclades
  const alpha = mkNode(project, 'Alphaproteobacteria', proteo, 2000, 500);
  const gamma = mkNode(project, 'Gammaproteobacteria', proteo, 1900, 600);
  mkNode(project, 'Rhizobium', alpha, 0, 2000);
  mkNode(project, 'Rickettsia', alpha, 0, 2000);
  mkNode(project, 'Escherichia', gamma, 0, 1900);
  mkNode(project, 'Pseudomonas', gamma, 0, 1900);
  mkNode(project, 'Bacteroides', bacteroid, 0, 2400);
  mkNode(project, 'Treponema', spiroch, 0, 2300);

  // Firmicutes
  const clostrid = mkNode(project, 'Clostridiales', firmicutes, 2200, 900);
  const bacillales = mkNode(project, 'Bacillales', firmicutes, 2100, 1000);
  mkNode(project, 'Clostridium', clostrid, 0, 2200);
  mkNode(project, 'Bacillus', bacillales, 0, 2100);
  mkNode(project, 'Streptomyces', actinobact, 0, 3000);
  mkNode(project, 'Mycobacterium', actinobact, 0, 3000);
  mkNode(project, 'Synechocystis', cyanobact, 0, 2900);
  mkNode(project, 'Prochlorococcus', cyanobact, 0, 2900);

  // --- characters: Gram stain + oxygen ---
  const gramPosId = newId();
  const gramNegId = newId();
  const gram: Project['characters'][number] = {
    id: sampleCharacterId('bacteria-gram'),
    name: tr('革兰氏反应', 'Gram stain reaction'),
    type: 'discrete',
    states: [
      { id: gramPosId, label: tr('革兰氏阳性', 'Gram-positive'), color: '#7c3aed' },
      { id: gramNegId, label: tr('革兰氏阴性', 'Gram-negative'), color: '#0ea5e9' },
    ],
    description: tr('基于细胞壁结构的细菌分类。', 'Bacterial classification based on cell wall structure.'),
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
      { id: facId, label: tr('兼性', 'Facultative'), color: '#f59e0b' },
    ],
  };
  project.characters = [gram, oxygen];

  // Every lookup is checked (see `assignState`): a typo or a renamed label fails
  // loudly instead of silently dropping a state.
  const assign = (label: string, charId: string, stateId: string) =>
    assignState(project, label, charId, stateId);
  assign('Escherichia', gram.id, gramNegId);
  assign('Pseudomonas', gram.id, gramNegId);
  assign('Rhizobium', gram.id, gramNegId);
  assign('Rickettsia', gram.id, gramNegId);
  assign('Bacteroides', gram.id, gramNegId);
  assign('Treponema', gram.id, gramNegId);
  assign('Clostridium', gram.id, gramPosId);
  assign('Bacillus', gram.id, gramPosId);
  assign('Streptomyces', gram.id, gramPosId);
  assign('Mycobacterium', gram.id, gramPosId);
  assign('Synechocystis', gram.id, gramNegId);
  assign('Prochlorococcus', gram.id, gramNegId);

  assign('Escherichia', oxygen.id, facId);
  assign('Pseudomonas', oxygen.id, aerId);
  assign('Rhizobium', oxygen.id, aerId);
  assign('Rickettsia', oxygen.id, aerId);
  assign('Bacteroides', oxygen.id, anaId);
  assign('Treponema', oxygen.id, anaId);
  assign('Clostridium', oxygen.id, anaId);
  assign('Bacillus', oxygen.id, facId);
  assign('Streptomyces', oxygen.id, aerId);
  assign('Mycobacterium', oxygen.id, aerId);
  assign('Synechocystis', oxygen.id, aerId);
  assign('Prochlorococcus', oxygen.id, aerId);

  project.layers[0].name = tr('革兰氏阴性祖先', 'Gram-negative-ancestor');
  const hypothesise = (
    label: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseState(project, label, charId, stateId, confidence, support);
  hypothesise('Terrabacteria', gram.id, gramPosId, 'low', tr('细胞壁保守性', 'Cell wall conservation'));
  hypothesise('Gracilicutes (GN)', gram.id, gramNegId, 'high', tr('外膜双层结构', 'Outer membrane double-layer'));
  hypothesise('Firmicutes (GP)', gram.id, gramPosId, 'high', tr('厚肽聚糖层', 'Thick peptidoglycan layer'));
  hypothesise('Proteobacteria', oxygen.id, facId, 'medium', tr('代谢灵活性', 'Metabolic flexibility'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: cyanobact,
      label: tr('产氧光合作用', 'Oxygenic photosynthesis'),
      note: tr('利用水作为电子供体的光合系统II，引发了地球历史上最大的氧化事件。', 'Photosystem II using water as electron donor, triggering the largest oxidation event in Earth history.'),
      confidence: 'high',
      support: tr('psbA/psbD 基因', 'psbA/psbD genes'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: proteo,
      label: tr('变形菌纲辐射', 'Proteobacteria radiation'),
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
      note: tr('蓝细菌产氧光合作用导致大气氧积累', 'Cyanobacterial oxygenic photosynthesis led to atmospheric oxygen accumulation'),
    },
  ];

  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 4 — Viral evolution (RNA + DNA viruses)
// ════════════════════════════════════════════════════════════════════════════
export function createVirusSample(): Project {
  const project = createEmptyProject(tr('病毒演化', 'Viral evolution'));
  project.sampleId = 'virus';
  const rootId = project.rootId;
  project.nodes[rootId].label = 'Urvirus';
  project.nodes[rootId].age = 4200; // oldest node; children are 3800–4000 Ma

  // branchLength = parent.age − node.age: the root's two children are 200 and 400
  // because 4200 − 4000 and 4200 − 3800 say so. Values in the same ratio as the
  // ages themselves (1000 / 1200) would stretch each branch far beyond the time
  // it represents, and `mkNode` rejects them.
  const rnaVirus = mkNode(project, 'RNA viruses', rootId, 4000, 200);
  const dnaVirus = mkNode(project, 'DNA viruses', rootId, 3800, 400);

  // RNA virus clades
  const posStrand = mkNode(project, '+ssRNA viruses', rnaVirus, 3000, 1000);
  const negStrand = mkNode(project, '-ssRNA viruses', rnaVirus, 2900, 1100);
  const dsrna = mkNode(project, 'dsRNA viruses', rnaVirus, 2800, 1200);
  const retro = mkNode(project, 'Retro-transcribing', rnaVirus, 2700, 1300);

  // +ssRNA subclades
  const picorna = mkNode(project, 'Picornavirales', posStrand, 1500, 1500);
  const nidovir = mkNode(project, 'Nidovirales', posStrand, 1400, 1600);
  mkNode(project, 'Poliovirus', picorna, 0, 1500);
  mkNode(project, 'Foot-and-mouth', picorna, 0, 1500);
  mkNode(project, 'SARS-CoV-2', nidovir, 0, 1400);
  mkNode(project, 'MERS-CoV', nidovir, 0, 1400);
  // A plant-infecting tobamovirus, unresolved below +ssRNA (the same treatment as
  // Influenza A below -ssRNA). It is also the only tip carrying the host
  // character's 植物 state, so the legend never shows a category nothing uses.
  mkNode(project, 'Tobacco mosaic virus', posStrand, 0, 3000);

  // -ssRNA
  const mononeg = mkNode(project, 'Mononegavirales', negStrand, 1300, 1600);
  mkNode(project, 'Influenza A', negStrand, 0, 2900);
  mkNode(project, 'Measles virus', mononeg, 0, 1300);
  mkNode(project, 'Ebola virus', mononeg, 0, 1300);
  mkNode(project, 'Rhabdovirus', mononeg, 0, 1300);

  // dsRNA
  mkNode(project, 'Rotavirus', dsrna, 0, 2800);
  mkNode(project, 'Reovirus', dsrna, 0, 2800);

  // Retro
  mkNode(project, 'HIV-1', retro, 0, 2700);
  mkNode(project, 'HTLV-1', retro, 0, 2700);

  // DNA viruses
  const dsdna = mkNode(project, 'dsDNA viruses', dnaVirus, 2500, 1300);
  const ssdna = mkNode(project, 'ssDNA viruses', dnaVirus, 2400, 1400);
  const nucleo = mkNode(project, 'Nucleocytoplasmic', dnaVirus, 2300, 1500);

  const herpes = mkNode(project, 'Herpesvirales', dsdna, 1200, 1300);
  const caudov = mkNode(project, 'Caudovirales', dsdna, 1100, 1400);
  mkNode(project, 'HSV-1', herpes, 0, 1200);
  mkNode(project, 'Varicella-zoster', herpes, 0, 1200);
  mkNode(project, 'Mimivirus', nucleo, 0, 2300);
  mkNode(project, 'Adenovirus', dsdna, 0, 2500);
  mkNode(project, 'Papillomavirus', ssdna, 0, 2400);
  mkNode(project, 'Parvovirus', ssdna, 0, 2400);
  mkNode(project, 'Lambda phage', caudov, 0, 1100);
  mkNode(project, 'T4 phage', caudov, 0, 1100);

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
    description: tr('病毒遗传物质的核酸类型。', 'Nucleic acid type of the viral genetic material.'),
  };
  const animalId = newId();
  const plantId = newId();
  const bactId = newId();
  // Mimivirus infects free-living amoebae, so its host state is 原生生物 rather than
  // 细菌: a sample teaches whatever host association it encodes, and a wrong one here
  // reads as a biological fact wherever the tree is shown.
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

  // Every lookup is checked (see `assignState`): a typo or a renamed label fails
  // loudly instead of silently dropping a state.
  const assign = (label: string, charId: string, stateId: string) =>
    assignState(project, label, charId, stateId);
  // RNA virus tips
  assign('Poliovirus', genome.id, rnaId);
  assign('Foot-and-mouth', genome.id, rnaId);
  assign('SARS-CoV-2', genome.id, rnaId);
  assign('MERS-CoV', genome.id, rnaId);
  assign('Influenza A', genome.id, rnaId);
  assign('Measles virus', genome.id, rnaId);
  assign('Ebola virus', genome.id, rnaId);
  assign('Rhabdovirus', genome.id, rnaId);
  assign('Rotavirus', genome.id, rnaId);
  assign('Reovirus', genome.id, rnaId);
  assign('HIV-1', genome.id, rnaId);
  assign('HTLV-1', genome.id, rnaId);
  assign('Tobacco mosaic virus', genome.id, rnaId);
  // DNA virus tips
  assign('HSV-1', genome.id, dnaId);
  assign('Varicella-zoster', genome.id, dnaId);
  assign('Mimivirus', genome.id, dnaId);
  assign('Adenovirus', genome.id, dnaId);
  assign('Papillomavirus', genome.id, dnaId);
  assign('Parvovirus', genome.id, dnaId);
  assign('Lambda phage', genome.id, dnaId);
  assign('T4 phage', genome.id, dnaId);

  // Host assignments
  assign('Poliovirus', host.id, animalId);
  assign('Foot-and-mouth', host.id, animalId);
  assign('SARS-CoV-2', host.id, animalId);
  assign('MERS-CoV', host.id, animalId);
  assign('Influenza A', host.id, animalId);
  assign('Measles virus', host.id, animalId);
  assign('Ebola virus', host.id, animalId);
  assign('Rotavirus', host.id, animalId);
  assign('Reovirus', host.id, animalId);
  assign('HIV-1', host.id, animalId);
  assign('HTLV-1', host.id, animalId);
  assign('Rhabdovirus', host.id, animalId);
  assign('HSV-1', host.id, animalId);
  assign('Varicella-zoster', host.id, animalId);
  assign('Adenovirus', host.id, animalId);
  assign('Papillomavirus', host.id, animalId);
  assign('Parvovirus', host.id, animalId);
  assign('Lambda phage', host.id, bactId);
  assign('T4 phage', host.id, bactId);
  // Tobacco mosaic virus is the textbook plant virus; Mimivirus is a nucleocytoplasmic
  // giant virus of free-living amoebae (a protist), NOT a bacteriophage.
  assign('Tobacco mosaic virus', host.id, plantId);
  assign('Mimivirus', host.id, protistId);

  project.layers[0].name = tr('RNA祖先', 'RNA-ancestor');
  const hypothesise = (
    label: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseState(project, label, charId, stateId, confidence, support);
  hypothesise('Urvirus', genome.id, rnaId, 'low', tr('RNA世界假说', 'RNA world hypothesis'));
  hypothesise('RNA viruses', genome.id, rnaId, 'high', tr('依赖RNA的RNA聚合酶', 'RNA-dependent RNA polymerase'));
  hypothesise('DNA viruses', genome.id, dnaId, 'high', tr('DNA聚合酶同源', 'DNA polymerase homology'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: retro,
      label: tr('逆转录整合', 'Reverse transcription & integration'),
      note: tr('逆转录酶使RNA基因组可整合入宿主DNA，是反转录病毒的关键创新。', 'Reverse transcriptase enabling RNA genome integration into host DNA, key innovation of retroviruses.'),
      confidence: 'high',
      support: tr('pol 基因逆转录酶', 'pol gene reverse transcriptase'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: posStrand,
      label: tr('+ssRNA病毒辐射', '+ssRNA virus radiation'),
      confidence: 'medium',
      triggers: [],
    },
  ];

  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 5 — Plant land colonization
// ════════════════════════════════════════════════════════════════════════════
export function createPlantSample(): Project {
  const project = createEmptyProject(tr('植物陆地登陆演化', 'Plant terrestrialization'));
  project.sampleId = 'plant';
  const rootId = project.rootId;
  project.nodes[rootId].label = 'Streptophyta';
  project.nodes[rootId].age = 520; // oldest node; children are 470–500 Ma

  // branchLength = parent.age − node.age: the root's two daughters are 20 and 50
  // (520 − 500, 520 − 470). Numbers closer to the node ages themselves — 450 and
  // 30 — would draw the two daughters at nearly the same depth and make the algae
  // branch read ~22× longer than the time axis says it is.
  const algae = mkNode(project, 'Charophyceae', rootId, 500, 20);
  const landPlants = mkNode(project, 'Embryophyta', rootId, 470, 50);

  const bryophytes = mkNode(project, 'Bryophyta', landPlants, 450, 20);
  const tracheophytes = mkNode(project, 'Tracheophyta', landPlants, 430, 40);

  const lycopsids = mkNode(project, 'Lycopodiopsida', tracheophytes, 410, 20);
  const euphyllo = mkNode(project, 'Euphyllophyta', tracheophytes, 400, 30);

  const ferns = mkNode(project, 'Monilophyta', euphyllo, 380, 20);
  const spermat = mkNode(project, 'Spermatophyta', euphyllo, 370, 30);

  const gymno = mkNode(project, 'Gymnospermae', spermat, 350, 20);
  const angio = mkNode(project, 'Angiospermae', spermat, 340, 30);

  const monocots = mkNode(project, 'Monocots', angio, 140, 200);
  const eudicots = mkNode(project, 'Eudicots', angio, 130, 210);

  // Tips
  mkNode(project, 'Chara', algae, 0, 500);
  mkNode(project, 'Coleochaete', algae, 0, 500);
  mkNode(project, 'Marchantia', bryophytes, 0, 450);
  mkNode(project, 'Sphagnum', bryophytes, 0, 450);
  mkNode(project, 'Lycopodium', lycopsids, 0, 410);
  mkNode(project, 'Selaginella', lycopsids, 0, 410);
  mkNode(project, 'Pteridium', ferns, 0, 380);
  mkNode(project, 'Equisetum', ferns, 0, 380);
  mkNode(project, 'Pinus', gymno, 0, 350);
  mkNode(project, 'Ginkgo', gymno, 0, 350);
  mkNode(project, 'Oryza', monocots, 0, 140);
  mkNode(project, 'Zea', monocots, 0, 140);
  mkNode(project, 'Arabidopsis', eudicots, 0, 130);
  mkNode(project, 'Rosa', eudicots, 0, 130);

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
    description: tr('植物从水生到陆生的栖息地转变。', 'Plant habitat transition from aquatic to terrestrial.'),
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

  // Every lookup is checked (see `assignState`): a typo or a renamed label fails
  // loudly instead of silently dropping a state.
  const assign = (label: string, charId: string, stateId: string) =>
    assignState(project, label, charId, stateId);
  assign('Chara', habitat.id, aqId);
  assign('Coleochaete', habitat.id, aqId);
  assign('Marchantia', habitat.id, semiId);
  assign('Sphagnum', habitat.id, semiId);
  assign('Lycopodium', habitat.id, terrId);
  assign('Selaginella', habitat.id, terrId);
  assign('Pteridium', habitat.id, terrId);
  assign('Equisetum', habitat.id, terrId);
  assign('Pinus', habitat.id, terrId);
  assign('Ginkgo', habitat.id, terrId);
  assign('Oryza', habitat.id, semiId);
  assign('Zea', habitat.id, terrId);
  assign('Arabidopsis', habitat.id, terrId);
  assign('Rosa', habitat.id, terrId);

  assign('Chara', vasc.id, noVascId);
  assign('Coleochaete', vasc.id, noVascId);
  assign('Marchantia', vasc.id, noVascId);
  assign('Sphagnum', vasc.id, noVascId);
  assign('Lycopodium', vasc.id, vascId);
  assign('Selaginella', vasc.id, vascId);
  assign('Pteridium', vasc.id, vascId);
  assign('Equisetum', vasc.id, vascId);
  assign('Pinus', vasc.id, vascId);
  assign('Ginkgo', vasc.id, vascId);
  assign('Oryza', vasc.id, vascId);
  assign('Zea', vasc.id, vascId);
  assign('Arabidopsis', vasc.id, vascId);
  assign('Rosa', vasc.id, vascId);

  assign('Chara', seed.id, noSeedId);
  assign('Coleochaete', seed.id, noSeedId);
  assign('Marchantia', seed.id, noSeedId);
  assign('Sphagnum', seed.id, noSeedId);
  assign('Lycopodium', seed.id, noSeedId);
  assign('Selaginella', seed.id, noSeedId);
  assign('Pteridium', seed.id, noSeedId);
  assign('Equisetum', seed.id, noSeedId);
  assign('Pinus', seed.id, seedId);
  assign('Ginkgo', seed.id, seedId);
  assign('Oryza', seed.id, seedId);
  assign('Zea', seed.id, seedId);
  assign('Arabidopsis', seed.id, seedId);
  assign('Rosa', seed.id, seedId);

  project.layers[0].name = tr('水生祖先', 'Aquatic-ancestor');
  const hypothesise = (
    label: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseState(project, label, charId, stateId, confidence, support);
  hypothesise('Streptophyta', habitat.id, aqId, 'high', tr('轮藻近亲', 'Charophyte relatives'));
  hypothesise('Embryophyta', habitat.id, semiId, 'medium', tr('早期陆生植物化石', 'Early land plant fossils'));
  hypothesise('Embryophyta', vasc.id, noVascId, 'high', tr('苔藓植物无维管', 'Bryophytes lack vascular tissue'));
  hypothesise('Tracheophyta', vasc.id, vascId, 'high', tr('木质部/韧皮部', 'Xylem/phloem'));
  hypothesise('Spermatophyta', seed.id, seedId, 'high', tr('种子结构', 'Seed structure'));
  hypothesise('Euphyllophyta', vasc.id, vascId, 'high', tr('真叶植物维管', 'Euphyllophyte vasculature'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: landPlants,
      label: tr('角质层与气孔', 'Cuticle & stomata'),
      note: tr('防水角质层和可调节气孔是陆地植物的关键创新。', 'Waterproof cuticle and regulatable stomata are key innovations of land plants.'),
      confidence: 'high',
      support: tr('化石角质层', 'Fossil cuticles'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: tracheophytes,
      label: tr('维管系统', 'Vascular system'),
      note: tr('木质部与韧皮部运输系统，使植物体大型化成为可能。', 'Xylem and phloem transport system enabling plant body size increase.'),
      confidence: 'high',
      support: tr('管胞化石', 'Tracheid fossils'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'adaptive-radiation',
      target: 'node',
      nodeId: angio,
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
      note: tr('被子植物在K-Pg后快速辐射', 'Angiosperms radiated rapidly after the K–Pg boundary'),
    },
  ];

  return project;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLE 6 — Animal (tetrapod) terrestrialization
// ════════════════════════════════════════════════════════════════════════════
export function createAnimalSample(): Project {
  const project = createEmptyProject(tr('四足动物陆地演化', 'Tetrapod terrestrialization'));
  project.sampleId = 'animal';
  const rootId = project.rootId;
  project.nodes[rootId].label = 'Sarcopterygii';
  project.nodes[rootId].age = 430; // oldest node; first child is 410 Ma

  const tetrapodomorph = mkNode(project, 'Tetrapodomorpha', rootId, 410, 20);
  // The root must be a genuine bifurcation: a unary root carries no split at all —
  // it is an unrooted tree drawn as a rooted one — which drags treeSummary's
  // resolution down and pushes the DTL solver through its unary special case.
  // Latimeria (Actinistia, the extant coelacanths) is the real sister lineage of
  // Tetrapodomorpha within Sarcopterygii once lungfish are left out of the summary,
  // so this second child is both the biologically right split and the structurally
  // required one.
  mkNode(project, 'Latimeria', rootId, 0, 430);
  const tetrapoda = mkNode(project, 'Tetrapoda', tetrapodomorph, 380, 30);

  const amphibians = mkNode(project, 'Amphibia', tetrapoda, 340, 40);
  const amniota = mkNode(project, 'Amniota', tetrapoda, 320, 60);

  const sauropsids = mkNode(project, 'Sauropsida', amniota, 310, 10);
  const synapsids = mkNode(project, 'Synapsida', amniota, 315, 5);

  const lepidosaur = mkNode(project, 'Lepidosauria', sauropsids, 260, 50);
  const archosaur = mkNode(project, 'Archosauria', sauropsids, 250, 60);
  const testudines = mkNode(project, 'Testudines', sauropsids, 260, 50);

  const dinosaurs = mkNode(project, 'Dinosauria', archosaur, 230, 20);
  const crocodylia = mkNode(project, 'Crocodylia', archosaur, 220, 30);

  const theropods = mkNode(project, 'Theropoda', dinosaurs, 200, 30);
  const sauropodomorph = mkNode(project, 'Sauropodomorpha', dinosaurs, 200, 30);

  const birds = mkNode(project, 'Aves', theropods, 150, 50);
  const mammals = mkNode(project, 'Mammalia', synapsids, 200, 115);

  const marsupial = mkNode(project, 'Marsupialia', mammals, 80, 120);
  const placental = mkNode(project, 'Placentalia', mammals, 65, 135);

  // Tips
  mkNode(project, 'Eusthenopteron', tetrapodomorph, 0, 410);
  mkNode(project, 'Tiktaalik', tetrapodomorph, 0, 410);
  mkNode(project, 'Acanthostega', tetrapoda, 0, 380);
  mkNode(project, 'Ichthyostega', tetrapoda, 0, 380);
  mkNode(project, 'Ambystoma', amphibians, 0, 340);
  mkNode(project, 'Rana', amphibians, 0, 340);
  mkNode(project, 'Lacerta', lepidosaur, 0, 260);
  mkNode(project, 'Python', lepidosaur, 0, 260);
  mkNode(project, 'Testudo', testudines, 0, 260);
  mkNode(project, 'Crocodylus', crocodylia, 0, 220);
  mkNode(project, 'Brachiosaurus', sauropodomorph, 0, 200);
  mkNode(project, 'Tyrannosaurus', theropods, 0, 200);
  mkNode(project, 'Gallus', birds, 0, 150);
  mkNode(project, 'Passer', birds, 0, 150);
  mkNode(project, 'Ornithorhynchus', mammals, 0, 200);
  mkNode(project, 'Didelphis', marsupial, 0, 80);
  mkNode(project, 'Homo', placental, 0, 65);
  mkNode(project, 'Mus', placental, 0, 65);
  mkNode(project, 'Canis', placental, 0, 65);

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
    description: tr('四足动物从水生到陆生的栖息地演化。', 'Tetrapod habitat evolution from aquatic to terrestrial.'),
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

  // Every lookup is checked (see `assignState`): a typo or a renamed label fails
  // loudly instead of silently dropping a state.
  const assign = (label: string, charId: string, stateId: string) =>
    assignState(project, label, charId, stateId);
  assign('Eusthenopteron', habitat.id, aqId);
  assign('Tiktaalik', habitat.id, semiId);
  assign('Acanthostega', habitat.id, semiId);
  assign('Ichthyostega', habitat.id, semiId);
  assign('Ambystoma', habitat.id, semiId);
  assign('Rana', habitat.id, semiId);
  assign('Lacerta', habitat.id, terrId);
  assign('Python', habitat.id, terrId);
  assign('Testudo', habitat.id, terrId);
  assign('Crocodylus', habitat.id, semiId);
  assign('Brachiosaurus', habitat.id, terrId);
  assign('Tyrannosaurus', habitat.id, terrId);
  assign('Gallus', habitat.id, flyId);
  assign('Passer', habitat.id, flyId);
  assign('Ornithorhynchus', habitat.id, semiId);
  assign('Didelphis', habitat.id, terrId);
  assign('Homo', habitat.id, terrId);
  assign('Mus', habitat.id, terrId);
  assign('Canis', habitat.id, terrId);
  // Extant coelacanth: fully aquatic, fin-bearing.
  assign('Latimeria', habitat.id, aqId);

  assign('Eusthenopteron', limb.id, finId);
  assign('Tiktaalik', limb.id, finId);
  assign('Acanthostega', limb.id, digId);
  assign('Ichthyostega', limb.id, digId);
  assign('Ambystoma', limb.id, digId);
  assign('Rana', limb.id, digId);
  assign('Lacerta', limb.id, digId);
  assign('Python', limb.id, digId);
  assign('Testudo', limb.id, digId);
  assign('Crocodylus', limb.id, digId);
  assign('Brachiosaurus', limb.id, digId);
  assign('Tyrannosaurus', limb.id, digId);
  assign('Gallus', limb.id, wingId);
  assign('Passer', limb.id, wingId);
  assign('Ornithorhynchus', limb.id, digId);
  assign('Didelphis', limb.id, digId);
  assign('Homo', limb.id, digId);
  assign('Mus', limb.id, digId);
  assign('Canis', limb.id, digId);
  assign('Latimeria', limb.id, finId);

  project.layers[0].name = tr('水生祖先', 'Aquatic-ancestor');
  const hypothesise = (
    label: string,
    charId: string,
    stateId: string,
    confidence: 'high' | 'medium' | 'low',
    support: string,
  ) => hypothesiseState(project, label, charId, stateId, confidence, support);
  hypothesise('Sarcopterygii', habitat.id, aqId, 'high', tr('肉鳍鱼类化石', 'Lobe-finned fish fossils'));
  hypothesise('Tetrapoda', habitat.id, semiId, 'high', tr('Acanthostega 化石', 'Acanthostega fossils'));
  hypothesise('Tetrapoda', limb.id, digId, 'high', tr('八趾足', 'Polydactylous limbs'));
  hypothesise('Amniota', habitat.id, terrId, 'high', tr('羊膜卵', 'Amniotic egg'));
  hypothesise('Theropoda', limb.id, digId, 'high', tr('兽脚类后肢', 'Theropod hindlimbs'));

  project.events = [
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: tetrapoda,
      label: tr('四肢与趾型', 'Limbs with digits'),
      note: tr('从鳍到四肢的转变，使脊椎动物得以登陆。', 'Transition from fins to limbs enabling vertebrate terrestrialization.'),
      confidence: 'high',
      support: tr('Tiktaalik 过渡化石', 'Tiktaalik transitional fossil'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: amniota,
      label: tr('羊膜卵', 'Amniotic egg'),
      note: tr('羊膜卵使脊椎动物完全脱离水生繁殖。', 'Amniotic egg freed vertebrates from aquatic reproduction.'),
      confidence: 'high',
      support: tr('蛋壳化石', 'Eggshell fossils'),
      triggers: [],
    },
    {
      id: newId(),
      typeId: 'key-innovation',
      target: 'branch',
      nodeId: birds,
      label: tr('飞行', 'Powered flight'),
      note: tr('鸟类飞行的起源，与羽毛演化密切相关。', 'Origin of powered flight, closely tied to feather evolution.'),
      confidence: 'medium',
      support: tr('始祖鸟化石', 'Archaeopteryx fossil'),
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
      note: tr('非鸟类恐龙灭绝', 'Non-avian dinosaur extinction'),
    },
  ];

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
    id: 'archaea',
    label: '古菌域演化',
    labelEn: 'Archaeal domain evolution',
    desc: '古菌三大门类的代谢途径与温度适应性演化',
    descEn: 'Metabolic pathways and temperature adaptation across archaeal phyla',
    build: createArchaeaSample,
  },
  {
    id: 'bacteria',
    label: '细菌域演化',
    labelEn: 'Bacterial domain evolution',
    desc: '细菌革兰氏反应、氧需求与蓝细菌产氧光合作用',
    descEn: 'Gram stain, oxygen requirement, and cyanobacterial oxygenic photosynthesis',
    build: createBacteriaSample,
  },
  {
    id: 'virus',
    label: '病毒演化',
    labelEn: 'Viral evolution',
    desc: 'RNA与DNA病毒基因组类型、宿主范围与逆转录创新',
    descEn: 'RNA/DNA viral genome types, host range, and reverse transcription innovation',
    build: createVirusSample,
  },
  {
    id: 'cetacean',
    label: '鲸类水生适应',
    labelEn: 'Cetacean aquatic transition',
    desc: '鲸类从陆地到水生的栖息地与运动方式转变',
    descEn: 'Cetacean terrestrial-to-aquatic habitat and locomotion transition',
    build: createCetaceanSample,
  },
  {
    id: 'plant',
    label: '植物陆地登陆演化',
    labelEn: 'Plant terrestrialization',
    desc: '维管组织、种子与花的演化，从轮藻到被子植物',
    descEn: 'Vascular tissue, seed, and flower evolution from charophytes to angiosperms',
    build: createPlantSample,
  },
  {
    id: 'animal',
    label: '四足动物陆地演化',
    labelEn: 'Tetrapod terrestrialization',
    desc: '从肉鳍鱼到四肢、羊膜卵、飞行与哺乳动物的演化',
    descEn: 'From lobe-finned fish to limbs, amniotic egg, flight, and mammals',
    build: createAnimalSample,
  },
];
