// Hypothesis consistency checks + character-correlation hints.
//
// These SURFACE possible logical tensions in the user's hypotheses; they never
// auto-correct and are phrased as prompts, not verdicts. All checks operate on
// the asserted states plus a parsimony baseline. Correlation is a descriptive
// co-change hint, deliberately NOT a causal claim.
//
// Five check categories exist and each one can fire — the type union and the
// implementation are kept in step:
//   C1 local-mismatch   a node conflicts with all of its assigned children
//   C2 excess-changes   the user's own hypothesis costs more steps than the MP
//                       minimum under the SAME step matrix — and, under the same
//                       EVIDENCE: the gap is attributed to the internal
//                       states the user asserted instead of being charged to them
//   C3 homoplasy        a state arises independently ≥2 times in the MP solution
//   C4 ambiguous        a node has several equally parsimonious states
//   C5 missing-data     tips with no observation, and values that are not states
//                       at all ('?' / '-' codes, ids of deleted states)
//
// What a node "knows" is decided by `isObservedState`: a declared state of the
// character. Missing-data codes from the matrix dialog are not observations —
// treating them as one would turn absence of data into evidence.

import { tr } from '../ui/strings';
import type { Character, NodeId, Project, TreeNode } from './types';
import { isObservedState, stateLabel } from './characters';
import { costOf, parsimony } from './parsimony';
import { holmAdjustFamily, type HolmAdjusted } from './stats';

export type IssueSeverity = 'info' | 'warning';

export type ConsistencyIssueKind =
  | 'local-mismatch'
  | 'excess-changes'
  | 'homoplasy'
  | 'ambiguous'
  | 'missing-data';

export interface ConsistencyIssue {
  kind: ConsistencyIssueKind;
  severity: IssueSeverity;
  nodeId?: NodeId;
  message: string;
  /** Human-readable tag label for the issue kind. */
  tag: string;
}

/**
 * The five categories, with the tags the UI shows for them.
 *
 * A function, not a module-level array: the tags are translated, and a
 * module-level `tr(...)` freezes whichever language is active at import time, so
 * switching language afterwards would leave these tags in the language the switch
 * replaced. `EventLayer` and `hypothesisExport` keep their translated labels
 * inside functions for the same reason.
 */
export function consistenceCheckCategories(): { kind: ConsistencyIssueKind; tag: string }[] {
  return [
    { kind: 'local-mismatch', tag: tr('局部不一致', 'Local inconsistency') },
    { kind: 'excess-changes', tag: tr('过多变化', 'Excess changes') },
    { kind: 'homoplasy', tag: tr('同塑', 'Homoplasy') },
    { kind: 'ambiguous', tag: tr('模糊重建', 'Ambiguous reconstruction') },
    { kind: 'missing-data', tag: tr('缺失数据', 'Missing data') },
  ];
}

const INF = Number.POSITIVE_INFINITY;

/**
 * Minimum cost over the assignments that honour EVERY state the user asserted —
 * tips and internal nodes alike (`parsimony` deliberately ignores the internal
 * ones, so its cost is a tips-only bound). Same Sankoff DP, plus a pin at each
 * asserted node; always ≥ `parsimony(...).cost`, and equal to the cost of the
 * user's own hypothesis once every node is asserted.
 */
export function parsimonyCostGivenAssertions(project: Project, character: Character): number {
  const root = project.nodes[project.rootId];
  if (!root || character.type !== 'discrete' || character.states.length === 0) return 0;
  const k = character.states.length;
  const index = new Map(character.states.map((s, i) => [s.id, i] as const));
  const childrenOf = (n: TreeNode) =>
    n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[];
  const pinnedIndex = (n: TreeNode): number => {
    const sid = n.charStates?.[character.id];
    return typeof sid === 'string' && index.has(sid) ? (index.get(sid) as number) : -1;
  };

  const post: TreeNode[] = [];
  const stack: TreeNode[] = [root];
  const reached = new Set<NodeId>([root.id]);
  while (stack.length) {
    const n = stack.pop() as TreeNode;
    post.push(n);
    for (const c of n.childrenIds.map((id) => project.nodes[id]).filter(Boolean) as TreeNode[]) {
      if (reached.has(c.id)) continue;
      reached.add(c.id);
      stack.push(c);
    }
  }
  post.reverse();

  const g = new Map<NodeId, number[]>();
  for (const n of post) {
    const pinned = pinnedIndex(n);
    const arr = new Array<number>(k);
    for (let i = 0; i < k; i += 1) arr[i] = pinned >= 0 && pinned !== i ? INF : 0;
    for (const c of childrenOf(n)) {
      const gc = g.get(c.id) as number[];
      for (let i = 0; i < k; i += 1) {
        let best = INF;
        for (let j = 0; j < k; j += 1) {
          const v = gc[j] + costOf(character.costMatrix, i, j);
          if (v < best) best = v;
        }
        arr[i] += best;
      }
    }
    g.set(n.id, arr);
  }
  const at = g.get(root.id) as number[];
  return Math.min(...at);
}

export function checkConsistency(project: Project, character: Character): ConsistencyIssue[] {
  if (character.type !== 'discrete') return [];
  const nodes = project.nodes;
  const issues: ConsistencyIssue[] = [];
  const childrenOf = (n: TreeNode) =>
    n.childrenIds.map((id) => nodes[id]).filter(Boolean) as TreeNode[];
  const label = (sid: string) => stateLabel(character, sid) ?? sid;
  const name = (n: TreeNode) => n.label || n.id;
  const stateIndex = new Map(character.states.map((s, i) => [s.id, i] as const));

  // C1 — local mismatch: a node asserted as X whose every assigned child is Y ≠ X.
  for (const n of Object.values(nodes)) {
    const state = n.charStates?.[character.id];
    if (!isObservedState(character, state)) continue;
    const kids = childrenOf(n);
    if (kids.length === 0) continue;
    const kidStates = kids
      .map((c) => c.charStates?.[character.id])
      .filter((s): s is string => isObservedState(character, s));
    if (kidStates.length !== kids.length) continue;
    const uniq = new Set(kidStates);
    if (uniq.size === 1 && !uniq.has(state)) {
      issues.push({
        kind: 'local-mismatch',
        severity: 'warning',
        nodeId: n.id,
        message: tr(
          `节点「${name(n)}」假设为「${label(state)}」，但其全部子节点均为「${label(kidStates[0])}」，是否考虑改为后者？`,
          `Node “${name(n)}” is hypothesised as “${label(state)}” but ALL of its children are “${label(kidStates[0])}” — consider the latter?`,
        ),
        tag: tr('局部不一致', 'Local inconsistency'),
      });
    }
  }

  const mp = parsimony(project, character);

  // C2 — excess changes: the baseline shares the hypothesis's own evidence.
  //
  // Two properties keep this check honest.
  // (a) Pricing: both sides run through `costOf(character.costMatrix, …)`, so a
  // weighted character is judged by its own weights (and the check stays
  // reachable on the shipped sample project, whose only fully assigned character
  // carries a matrix).
  // (b) Evidence: the reference is the minimum over the TIPS AND every state the
  // user asserted, i.e. over the same hypothesis space the user proposed — not
  // the minimum over the tips alone, which is a strictly LARGER set. An internal
  // state asserted on evidence must not be charged against the user, so a
  // well-supported hypothesis never comes back as "excess changes, consider
  // simplifying".
  //
  // The gap is ATTRIBUTED rather than just reported. `minGivenAssertions` is the
  // cheapest hypothesis compatible with every state the user asserted, so
  //     userCost − minGivenAssertions  → redundancy their own evidence does not
  //                                     call for (could be simplified away)
  //     minGivenAssertions − mp.cost   → changes DEMANDED by the asserted
  //                                     internal states, i.e. evidence, not error
  // A complete hypothesis always sits in the second class (the two numbers
  // coincide and the first is 0), so the message says so instead of prompting a
  // simplification. For a partially assigned one the hypothesis cannot be priced
  // at all — but the assertions alone can already lift the floor above the
  // tip-only bound, which is worth surfacing.
  //
  // Severity stays `info` throughout: this is a prompt to re-read the evidence,
  // never a verdict.
  {
    let userCost = 0;
    let userChanges = 0;
    let fullyAssigned = true;
    let assertedInternals = 0;
    for (const n of Object.values(nodes)) {
      const s = n.charStates?.[character.id];
      if (n.childrenIds.length > 0 && isObservedState(character, s)) assertedInternals += 1;
      if (!n.parentId) continue;
      const p = nodes[n.parentId]?.charStates?.[character.id];
      if (!isObservedState(character, s) || !isObservedState(character, p)) {
        fullyAssigned = false;
        continue;
      }
      if (s !== p) {
        userChanges += 1;
        userCost += costOf(character.costMatrix, stateIndex.get(p) as number, stateIndex.get(s) as number);
      }
    }
    const minGivenAssertions = parsimonyCostGivenAssertions(project, character);
    const demanded = Math.max(0, minGivenAssertions - mp.cost);
    // For a COMPLETE assignment `minGivenAssertions === userCost`: every node is
    // pinned, so the DP has nothing left to optimise and the whole gap is
    // demanded by the user's own assertions. (Kept as an assertion-free
    // computation, but a "you could simplify" verdict would therefore always be
    // unfounded and is not issued.)
    if (fullyAssigned && userCost > mp.cost) {
      issues.push({
        kind: 'excess-changes',
        severity: 'info',
        message: tr(
          `当前假设需要 ${userChanges} 次状态变化（代价 ${userCost}），仅看尖端数据的简约下限为 ${mp.cost}。这 ${demanded} 的差额由你断言的 ${assertedInternals} 个内部状态本身要求：${minGivenAssertions} 已是与这些断言相容的最低代价，保留证据就没有可省的空间；只有当这些内部赋值缺乏独立证据时才需要重拟，因此这里只是提示，不是判定。`,
          `The hypothesis requires ${userChanges} state changes (cost ${userCost}); the parsimony minimum over the TIPS ONLY is ${mp.cost}. The whole gap of ${demanded} is demanded by the ${assertedInternals} internal state(s) you asserted: ${minGivenAssertions} is already the cheapest hypothesis compatible with them, so there is nothing to shave off while the evidence stands. Re-draft only if those internal assignments lack independent support — this is a prompt, not a verdict.`,
        ),
        tag: tr('过多变化', 'Excess changes'),
      });
    } else if (!fullyAssigned && demanded > 0) {
      issues.push({
        kind: 'excess-changes',
        severity: 'info',
        message: tr(
          `本性状尚未完整赋值，无法为整个假设定价；但仅你已断言的 ${assertedInternals} 个内部状态就已把同一矩阵下的最低代价从尖端数据的 ${mp.cost} 抬高到 ${minGivenAssertions}，值得复核这些断言的依据。`,
          `The hypothesis is not fully assigned, so it cannot be priced as a whole; still, the ${assertedInternals} internal state(s) already asserted raise the minimum cost under this character's own matrix from ${mp.cost} (tips only) to ${minGivenAssertions} — worth re-checking the evidence behind them.`,
        ),
        tag: tr('过多变化', 'Excess changes'),
      });
    }
  }

  // C3 — homoplasy: a state independently arises ≥2 times in the MP reconstruction.
  // Uses the tie-broken MP path (`chosen`), never `states[0]`, so the count
  // follows the documented tie-break instead of state declaration order.
  const gains = new Map<string, number>();
  for (const childId of mp.changeBranches) {
    const to = mp.chosen.get(childId);
    if (to) gains.set(to, (gains.get(to) ?? 0) + 1);
  }
  for (const [sid, count] of [...gains].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (count >= 2) {
      issues.push({
        kind: 'homoplasy',
        severity: 'info',
        message: tr(
          `状态「${label(sid)}」在简约重建下独立出现约 ${count} 次（同塑/回复），可能违反不可逆性，请确认。`,
          `State “${label(sid)}” independently arises ≈${count} times in the MP reconstruction (homoplasy/reversal) — possibly violating irreversibility; please verify.`,
        ),
        tag: tr('同塑', 'Homoplasy'),
      });
    }
  }

  // C4 — ambiguous reconstruction: nodes with multiple equally parsimonious states.
  // `mpStates` is the union over ALL optimal reconstructions. `mp.states` would
  // be the wrong object here: it is conditional on the one ancestor path the
  // tie-break resolved, so it can hide a genuine ambiguity one level down.
  for (const [nid, stateList] of [...mp.mpStates].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (stateList.length > 1) {
      const n = nodes[nid];
      if (!n || n.childrenIds.length === 0) continue;
      issues.push({
        kind: 'ambiguous',
        severity: 'info',
        nodeId: nid,
        message: tr(
          `节点「${name(n)}」存在 ${stateList.length} 个等价最优解（${stateList.map(label).join(' / ')}），请手动确认。`,
          `Node “${name(n)}” has ${stateList.length} equally optimal resolutions (${stateList.map(label).join(' / ')}) — confirm manually.`,
        ),
        tag: tr('模糊重建', 'Ambiguous reconstruction'),
      });
    }
  }

  // C5 — missing data: what the statistics deliberately ignore, stated openly.
  {
    let tipTotal = 0;
    let unassignedTips = 0;
    let staleValues = 0;
    for (const n of Object.values(nodes)) {
      if (n.childrenIds.length > 0) continue;
      tipTotal += 1;
      const v = n.charStates?.[character.id];
      if (isObservedState(character, v)) continue;
      if (typeof v === 'string') staleValues += 1;
      else unassignedTips += 1;
    }
    if (staleValues > 0) {
      issues.push({
        kind: 'missing-data',
        severity: 'warning',
        message: tr(
          `${staleValues} 个尖端记录的值不是本性状的状态（'?'/'-' 缺失符号，或已被删除的状态），简约法、Mk 重建与 CI/RI 均已将其按缺失数据处理。`,
          `${staleValues} tip value(s) are not states of this character ('?'/'-' missing-data codes, or deleted states); parsimony, Mk reconstruction and CI/RI all treat them as missing.`,
        ),
        tag: tr('缺失数据', 'Missing data'),
      });
    }
    if (unassignedTips > 0 && tipTotal > 0) {
      issues.push({
        kind: 'missing-data',
        severity: unassignedTips === tipTotal ? 'warning' : 'info',
        message: tr(
          `${unassignedTips}/${tipTotal} 个尖端尚未赋值：所有推断与统计只使用已赋值的尖端。`,
          `${unassignedTips} of ${tipTotal} tip(s) have no state recorded: every inference and statistic uses only the scored tips.`,
        ),
        tag: tr('缺失数据', 'Missing data'),
      });
    }
  }

  return issues;
}

export interface CharacterCorrelation {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** Jaccard overlap of the two characters' MP change-branch sets (0..1). */
  score: number;
  shared: number;
  /** Branches carrying a change of A, of B, and all branches of the tree. */
  aBranches: number;
  bBranches: number;
  totalBranches: number;
  /**
   * Shared change branches expected if the two change sets were exchangeable
   * over the tree's branches: |A|·|B|/|N| with N = ALL branches of the tree;
   * using |A∪B| would inflate the expectation towards the observation and make
   * every deviation look trivial.
   */
  expectedShared: number;
  /** Sample size (number of tips with both characters assigned). */
  sampleSize: number;
}

/**
 * Jaccard overlap of two MP change-branch sets, and the intersection size. The
 * statistic is symmetric in its two arguments — which is exactly the property
 * the permutation null has to share.
 */
function overlapOf(a: Set<NodeId>, b: Set<NodeId>): { inter: number; score: number } {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return { inter, score: union > 0 ? inter / union : 0 };
}

/**
 * Pairwise co-change hint: characters whose state changes tend to fall on the
 * same branches (per parsimony) are flagged. Descriptive only — high overlap
 * suggests a relationship worth investigating, not a proven causal link, and
 * NO p-value is produced here. A χ²-style shortcut is not a probability and
 * has no place in the description; the inferential statement lives in
 * `characterCorrelationTests` below.
 *
 * The ≥ 0.5 screen here is a DISPLAY filter over `testableCharacterPairs`,
 * never the family the multiplicity correction is told about.
 */
export function characterCorrelations(project: Project): CharacterCorrelation[] {
  const discrete = discreteCharacters(project);
  const changeSets = changeSetMap(project);
  const totalBranches = Object.values(project.nodes).filter((n) => n.parentId !== null).length;

  // Count tips with both characters assigned for sample size.
  const tipCount = (aId: string, bId: string): number => {
    let n = 0;
    for (const node of Object.values(project.nodes)) {
      if (node.childrenIds.length > 0) continue;
      const a = node.charStates?.[aId];
      const b = node.charStates?.[bId];
      if (isObservedState(characterOf(project, aId) as Character, a) &&
          isObservedState(characterOf(project, bId) as Character, b)) n++;
    }
    return n;
  };

  const out: CharacterCorrelation[] = [];
  for (const pair of enumerateTestablePairs(discrete, changeSets)) {
    const A = changeSets.get(pair.a.id) as Set<NodeId>;
    const B = changeSets.get(pair.b.id) as Set<NodeId>;
    const { inter, score } = overlapOf(A, B);
    if (score >= 0.5) {
      out.push({
        aId: pair.a.id,
        bId: pair.b.id,
        aName: pair.a.name,
        bName: pair.b.name,
        score,
        shared: inter,
        aBranches: A.size,
        bBranches: B.size,
        totalBranches,
        expectedShared: (A.size * B.size) / Math.max(1, totalBranches),
        sampleSize: tipCount(pair.a.id, pair.b.id),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.aId.localeCompare(b.aId) || a.bId.localeCompare(b.bId));
}

/** An unordered pair of characters that carries a statistic at all. */
export interface TestableCharacterPair {
  a: Character;
  b: Character;
  /** Descriptive Jaccard overlap — NOT a flag, just the testing order. */
  score: number;
}

/**
 * THE family: every unordered pair of discrete characters the permutation test
 * CAN be run on (both sides carry at least two MP change branches). Called
 * "testable" rather than "interesting": membership is decided by whether a
 * statistic exists, never by a p-value or an overlap threshold, so m cannot
 * depend on the data it is correcting.
 *
 * Both the model path (`characterCorrelationTests`) and the UI path enumerate
 * the family through this function; it is also where the `A.size < 2` /
 * `B.size < 2` screens live, so the descriptive pass and the dialog share one
 * definition and never diverge.
 */
export function testableCharacterPairs(project: Project): TestableCharacterPair[] {
  return enumerateTestablePairs(discreteCharacters(project), changeSetMap(project));
}

/** The enumeration over change sets a caller has already computed. */
function enumerateTestablePairs(
  discrete: Character[],
  changeSets: Map<string, Set<NodeId>>,
): TestableCharacterPair[] {
  const out: TestableCharacterPair[] = [];
  for (let i = 0; i < discrete.length; i += 1) {
    for (let j = i + 1; j < discrete.length; j += 1) {
      const A = changeSets.get(discrete[i].id) as Set<NodeId>;
      const B = changeSets.get(discrete[j].id) as Set<NodeId>;
      // Two changes on each side is the floor for a co-change statistic: with
      // one, "shared branch" is a coincidence with nothing to compare against.
      if (A.size < 2 || B.size < 2) continue;
      out.push({ a: discrete[i], b: discrete[j], score: overlapOf(A, B).score });
    }
  }
  return out;
}

function discreteCharacters(project: Project): Character[] {
  return project.characters.filter((c) => c.type === 'discrete' && c.states.length > 0);
}

function changeSetMap(project: Project): Map<string, Set<NodeId>> {
  const changeSets = new Map<string, Set<NodeId>>();
  for (const c of discreteCharacters(project)) {
    changeSets.set(c.id, parsimony(project, c).changeBranches);
  }
  return changeSets;
}

function characterOf(project: Project, id: string): Character | undefined {
  return project.characters.find((c) => c.id === id);
}

// --- tree-aware co-evolution test -------------------------------------------

/**
 * A permutation test for "do these two characters change on the same branches
 * more often than chance", built on an explicit evolutionary null:
 *
 *   NULL HYPOTHESIS — the two characters evolve INDEPENDENTLY on THIS tree, each
 *   with its own observed state frequencies: the tip states of EACH character are
 *   re-shuffled, independently of the other, over the tips that are scored for
 *   that character (so both marginal state counts and both missing-data patterns
 *   stay untouched), and for every replicate BOTH characters' most-parsimonious
 *   change-branch sets are recomputed on the SAME topology and the SAME step
 *   matrices. The statistic is the Jaccard overlap of the two change-branch
 *   sets, exactly as reported descriptively above.
 *
 *   p = (1 + #{replicate statistic ≥ observed}) / (permutations + 1)
 *
 * so the smallest reportable p is 1/(permutations+1) — the UI must print
 * "p < that bound" rather than "p = 0" or a fabricated floor.
 *
 * Permuting BOTH label vectors is what makes the test symmetric in its inputs.
 * Freezing character A and re-randomising only B would generate the replicate
 * cloud AROUND A'S OBSERVED change set, so the p-value would depend on which
 * character the caller passed first — the same pair coming out different one
 * way versus the other. Under this null the two
 * characters are exchangeable, so the procedure has to be too: every choice the
 * test makes (which vector is drawn first, and which pairs a capped family run
 * keeps) is taken from `canonicalPair`, never from argument order or from the
 * order the characters happen to appear in `project.characters`.
 *
 * Multiplicity is NOT applied here. `characterCorrelationTests` is the entry
 * point that tests a whole family and adjusts it; a lone call to this function
 * returns an uncorrected per-pair p.
 *
 * Known limits, stated rather than hidden: this null permutes OBSERVATIONS, not
 * evolutionary PATHWAYS, so it is conservative w.r.t. within-character
 * phylogenetic autocorrelation (a replicate's step count can differ from the
 * observed one) and it is NOT Pagel's (1994) likelihood-ratio test of
 * correlated transition rates, which CladeForge does not implement.
 */
export interface CorrelationTestOptions {
  /** Number of permutations (clamped to the work budget below). */
  permutations?: number;
  /** PRNG seed — the same seed always yields the same p-value. */
  seed?: number;
  /**
   * Cap on how many pairs one whole-family run tests (see `MAX_TESTED_PAIRS`).
   * It is applied to the ordered family BEFORE the adjustment, so m is always
   * the number of tests that were actually run.
   */
  maxPairs?: number;
}

export interface CorrelationTest extends CharacterCorrelation {
  /** One-sided permutation p-value (P(null overlap ≥ observed)). */
  pValue: number;
  /** Replicates actually run (the work budget may cut the request down). */
  permutations: number;
  /** Smallest p this run can report: 1/(permutations+1). */
  resolution: number;
  /** Replicates whose statistic reached or exceeded the observed one. */
  exceeded: number;
  /** Mean statistic across replicates (the null's centre). */
  nullMean: number;
  /** Name of the procedure, for the UI to print next to the number. */
  method: string;
}

/** A correlation test carrying its Holm partner and the family size behind it. */
export type AdjustedCorrelationTest = HolmAdjusted<CorrelationTest>;

const DEFAULT_PERMUTATIONS = 999;
/** Default seed: the same seed always replays the same p-value. */
const DEFAULT_PERMUTATION_SEED = 20260919;
/** Work budget: ≈ this many (node × parsimony-solve) steps per call. */
const PERMUTATION_WORK_BUDGET = 400_000;
/**
 * How many pairs one family run tests. The permutation test costs one
 * parsimony solve per replicate PER CHARACTER, so an unbounded screen of a
 * many-character project would freeze the window; the cap keeps the click
 * interactive, and because it is applied to the ordered family before the
 * adjustment, m still counts exactly what was run.
 */
export const MAX_TESTED_PAIRS = 24;

/** mulberry32 — tiny deterministic PRNG, so permutation p-values are replayable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Change-branch sets of every discrete character, keyed by character id. */
function changeSetOf(project: Project, character: Character): Set<NodeId> {
  return parsimony(project, character).changeBranches;
}

/**
 * The unordered pair in a stable, data-independent order (lexicographic by
 * character id). Two calls that differ only in which character came first then
 * run the IDENTICAL procedure and return the identical p-value.
 */
function canonicalPair(a: Character, b: Character): readonly [Character, Character] {
  return a.id <= b.id ? [a, b] : [b, a];
}

/** One side of the permutation: what is held fixed, and what is re-drawn. */
interface PermutationSide {
  character: Character;
  /** Observed MP change-branch set. */
  observed: Set<NodeId>;
  /** Tips scored for this character — the states move within this set only. */
  tips: NodeId[];
  /** The tips' observed states, in the same order as `tips`. */
  states: string[];
}

function permutationSide(project: Project, character: Character): PermutationSide {
  const tips: NodeId[] = [];
  const states: string[] = [];
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    const v = n.charStates?.[character.id];
    // Permuting within the scored tips keeps the missing-data pattern — and the
    // number of observations — exactly as recorded.
    if (isObservedState(character, v)) {
      tips.push(n.id);
      states.push(v);
    }
  }
  return { character, observed: changeSetOf(project, character), tips, states };
}

/** Fisher–Yates over an index list: a uniformly random permutation of it. */
function shuffledIndices(length: number, random: () => number): number[] {
  const order = new Array<number>(length).fill(0).map((_, i) => i);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Test one pair. Returns null when the pair cannot be tested (fewer than two
 * change branches on either side, fewer than three scored tips on either side —
 * BOTH vectors have to be re-drawable — or a tree too large for the permutation
 * budget to leave a usable number of replicates).
 *
 * `aId`/`bId`/`aName`/`bName`/`aBranches`/`bBranches` follow the CALLER's order,
 * because the panels match rows by those ids; the statistic, the null and the
 * p-value follow `canonicalPair`, so they do not.
 */
export function correlationPermutationTest(
  project: Project,
  a: Character,
  b: Character,
  options: CorrelationTestOptions = {},
): CorrelationTest | null {
  if (a.type !== 'discrete' || b.type !== 'discrete') return null;
  if (a.id === b.id) return null; // a character cannot co-vary with itself
  const [first, second] = canonicalPair(a, b);
  const sideA = permutationSide(project, first);
  const sideB = permutationSide(project, second);
  if (sideA.observed.size < 2 || sideB.observed.size < 2) return null;
  if (sideA.states.length < 3 || sideB.states.length < 3) return null;

  const { inter, score: observed } = overlapOf(sideA.observed, sideB.observed);

  const nodeCount = Object.keys(project.nodes).length || 1;
  const requested = Math.max(1, Math.floor(options.permutations ?? DEFAULT_PERMUTATIONS));
  // Two parsimony solves per replicate (one per character), so the same work
  // budget buys half as many replicates as a one-sided test would need.
  const permutations = Math.min(requested, Math.floor(PERMUTATION_WORK_BUDGET / (2 * nodeCount)));
  if (permutations < 30) return null; // too few replicates for an honest p-value

  // One cloned document whose two state columns we rewrite per replicate;
  // `parsimony` never mutates, so the clone is only needed to hold the permuted
  // states.
  const scratch: Project = { ...project, nodes: { ...project.nodes } };
  for (const side of [sideA, sideB]) {
    for (const id of side.tips) scratch.nodes[id] = { ...project.nodes[id] };
  }

  const random = rng(options.seed ?? DEFAULT_PERMUTATION_SEED);
  let exceeded = 0;
  let nullSum = 0;
  for (let rep = 0; rep < permutations; rep += 1) {
    // Both vectors are re-drawn, in canonical order, from one shared stream: a
    // replicate is a draw from the JOINT null, not a shuffle around one frozen
    // character.
    for (const side of [sideA, sideB]) {
      const order = shuffledIndices(side.states.length, random);
      side.tips.forEach((tipId, i) => {
        const node = scratch.nodes[tipId];
        node.charStates = { ...node.charStates, [side.character.id]: side.states[order[i]] };
      });
    }
    const Ap = changeSetOf(scratch, first);
    const Bp = changeSetOf(scratch, second);
    const stat = overlapOf(Ap, Bp).score;
    nullSum += stat;
    if (stat >= observed - 1e-12) exceeded += 1;
  }

  const totalBranches = Object.values(project.nodes).filter((n) => n.parentId !== null).length;
  let bothScored = 0;
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    if (isObservedState(a, n.charStates?.[a.id]) && isObservedState(b, n.charStates?.[b.id])) bothScored += 1;
  }
  const branchCountOf = (c: Character): number =>
    c.id === first.id ? sideA.observed.size : sideB.observed.size;

  return {
    aId: a.id,
    bId: b.id,
    aName: a.name,
    bName: b.name,
    score: observed,
    shared: inter,
    aBranches: branchCountOf(a),
    bBranches: branchCountOf(b),
    totalBranches,
    expectedShared: (sideA.observed.size * sideB.observed.size) / Math.max(1, totalBranches),
    sampleSize: bothScored,
    pValue: (1 + exceeded) / (permutations + 1),
    permutations,
    resolution: 1 / (permutations + 1),
    exceeded,
    nullMean: permutations > 0 ? nullSum / permutations : 0,
    method: tr(
      '树约束双端尖端态置换（两性状的简约变化枝重叠，Jaccard 统计量）',
      'Tree-constrained two-sided tip-state permutation (MP change-branch overlap of both characters, Jaccard statistic)',
    ),
  };
}

/** Declaration-order-independent identity of an unordered pair. */
function pairKey(a: Character, b: Character): string {
  const [first, second] = canonicalPair(a, b);
  return `${first.id}\u0000${second.id}`;
}

/**
 * The whole family, tested and then adjusted.
 *
 * The family is `testableCharacterPairs` — every pair the permutation test can
 * be run on — NOT the subset the ≥ 0.5 overlap flag happened to like. Holm
 * corrects the family that was TESTED, so the model and the UI have to define it
 * the same way and both do it through `holmAdjustFamily`; the flag is a display
 * filter applied to the rows returned here, never an input to the correction.
 * That is what makes m (carried on every row as `familySize`) independent of the
 * data: if the family and the display flag were the same set, the same pair's
 * adjusted p would move with how many OTHER pairs happened to be flagged.
 *
 * The most-overlapping pairs are tested first, so a capped run drops the least
 * informative ones instead of the most promising (see `MAX_TESTED_PAIRS`); ties
 * break on the canonical pair key, never on declaration order.
 */
export function characterCorrelationTests(
  project: Project,
  options: CorrelationTestOptions = {},
): AdjustedCorrelationTest[] {
  const cap = Math.max(0, Math.floor(options.maxPairs ?? MAX_TESTED_PAIRS));
  const ordered = [...testableCharacterPairs(project)].sort(
    (x, y) => y.score - x.score || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)),
  );
  const tests: CorrelationTest[] = [];
  for (const { a, b } of ordered.slice(0, cap)) {
    const t = correlationPermutationTest(project, a, b, options);
    if (t) tests.push(t);
  }
  return holmAdjustFamily(tests).sort(
    (x, y) =>
      x.adjustedP - y.adjustedP ||
      x.pValue - y.pValue ||
      y.score - x.score ||
      x.aId.localeCompare(y.aId) ||
      x.bId.localeCompare(y.bId),
  );
}
