// Independent-reference tests for the reconstruction algorithms: correctness
// evidence, not just speed.
//
// Every oracle here is written from the *definition* of the algorithm and shares
// no code with the implementation it checks:
//
//   * Sankoff / fixed parsimony   → exhaustive enumeration of every internal-node
//     state assignment; minimum total step cost, tie sets and the chosen path are
//     recomputed by hand.
//   * Mk / ER marginal states     → exhaustive enumeration of every internal
//     assignment, joint probability built from the ER transition matrix and
//     marginalised directly (no pruning, no belief propagation).
//   * consensus tree              → clades recomputed as tip-set partitions by an
//     independent walk, support counted by hand, assembly checked against the
//     laminar-set definition instead of the builder's own helpers.
//   * DTL reconciliation          → exhaustive enumeration of gene-node →
//     species-node placements with explicit loss / transfer decisions, priced
//     under the cost model the solver documents, compared with the DP optimum.
//   * r choice                    → the shipped sample projects re-analysed at
//     r = 1/mean(branch length) and at an ML-estimated r (grid + golden section on
//     the site likelihood), reporting how many marginals move.
//
// Machine-readable evidence: every measurement is pushed onto `evidence` and
// printed by the last test with an `EVIDENCE|` prefix. That last test also
// fails if any leg produced no evidence, so no oracle can be skipped in silence.

import { describe, it, expect } from 'vitest';
import { parsimony } from './parsimony';
import { reconstructMk, DEFAULT_ASR_OPTIONS } from './asr';
import {
  buildConsensusTree,
  checkConsensusInputs,
  cladeSetsOf,
  cladeSupports,
  rootedCladeKeys,
  type ConsensusMethod,
} from './consensus';
import { solveDtl, dtlScenarioToAssumptions } from './dtl';
import { createEmptyProject, SAMPLE_PROJECTS } from './sampleTree';
import { addChildren, newId, renameNode } from './treeOps';
import type { Character, NodeId, Project, ReconCosts, TreeNode } from './types';

// ═════════════════════════════════════════════════════════════════════════════
// evidence registry (consumed by the guard test at the bottom)
// ═════════════════════════════════════════════════════════════════════════════

type Leg = 'sankoff' | 'mk' | 'consensus' | 'dtl' | 'r-sensitivity';

interface Evidence {
  leg: Leg;
  case: string;
  metric: string;
  value: string | number | boolean;
  detail?: string;
}

const evidence: Evidence[] = [];

/** Minimum number of evidence rows each leg has to produce. */
const REQUIRED: Array<[Leg, number]> = [
  ['sankoff', 12],
  ['mk', 12],
  ['consensus', 12],
  ['dtl', 15],
  ['r-sensitivity', 10],
];

function record(leg: Leg, testCase: string, metric: string, value: string | number | boolean, detail?: string): void {
  evidence.push({ leg, case: testCase, metric, value, detail });
}

/**
 * How many cases were found where the single reconstruction the app reports is
 * NOT a most-parsimonious one (checked on every Sankoff case: fixed, sample and
 * randomised). The guard test at the bottom asserts it stays 0.
 */
let suboptimalPathCases = 0;

/** Enumeration budget: k^(free nodes) structures. Bigger cases are refused. */
const ENUM_BUDGET = 500_000;

// ═════════════════════════════════════════════════════════════════════════════
// a self-contained tiny Newick reader + Project builder
//
// Deliberately NOT src/io/newick.ts: an oracle must not inherit a defect from the
// code it checks.
// Grammar: node := ( '(' node (',' node)* ')' )? label? (':' number)?
// ═════════════════════════════════════════════════════════════════════════════

interface Parsed {
  label: string;
  len: number | undefined;
  kids: Parsed[];
}

function parseMiniNewick(input: string): Parsed {
  const src = input.trim().replace(/;+$/, '');
  let i = 0;
  const delim = (ch: string) => ',():;'.includes(ch);
  const parseNode = (): Parsed => {
    const kids: Parsed[] = [];
    if (src[i] === '(') {
      i += 1;
      for (;;) {
        kids.push(parseNode());
        if (src[i] === ',') {
          i += 1;
          continue;
        }
        if (src[i] === ')') {
          i += 1;
          break;
        }
        throw new Error(`mini-newick: expected ',' or ')' at ${i} of "${src}"`);
      }
    }
    let label = '';
    if (src[i] === "'") {
      i += 1;
      while (i < src.length && src[i] !== "'") label += src[i++];
      i += 1;
    } else {
      while (i < src.length && !delim(src[i])) label += src[i++];
    }
    let len: number | undefined;
    if (src[i] === ':') {
      i += 1;
      let num = '';
      while (i < src.length && !delim(src[i])) num += src[i++];
      len = Number(num);
      if (!Number.isFinite(len)) throw new Error(`mini-newick: bad branch length "${num}"`);
    }
    return { label: label.trim(), len, kids };
  };
  const tree = parseNode();
  if (i !== src.length) throw new Error(`mini-newick: trailing input at ${i} of "${src}"`);
  return tree;
}

/** Build a fresh Project from a Newick string; nodes are addressable by label. */
function projectFromNewick(nwk: string, name = 'reference-case'): Project {
  const parsed = parseMiniNewick(nwk);
  const project = createEmptyProject(name);
  if (parsed.label) project.nodes[project.rootId].label = parsed.label;
  const grow = (spec: Parsed, parentId: NodeId): void => {
    for (const kid of spec.kids) {
      const [id] = addChildren(project, parentId, 1);
      renameNode(project, id, kid.label || (kid.kids.length > 0 ? `n_${newId()}` : `t_${newId()}`));
      if (typeof kid.len === 'number') project.nodes[id].branchLength = kid.len;
      grow(kid, id);
    }
  };
  grow(parsed, project.rootId);
  return project;
}

/** A k-state discrete character whose state ids are `s0 … s{k-1}`. */
function makeCharacter(k: number, costMatrix?: number[][]): Character {
  const id = `char_${newId()}`;
  return {
    id,
    name: id,
    type: 'discrete',
    states: Array.from({ length: k }, (_, i) => ({ id: `s${i}`, label: `State ${i}`, color: '#000000' })),
    ...(costMatrix ? { costMatrix } : {}),
  };
}

/** Assign states by node label: declared ids, or the '?' / '-' missing codes. */
function setStates(project: Project, char: Character, table: Record<string, string>): void {
  for (const [label, state] of Object.entries(table)) {
    const node = Object.values(project.nodes).find((n) => n.label === label);
    if (!node) throw new Error(`setStates: no node labelled "${label}"`);
    node.charStates = { ...node.charStates, [char.id]: state };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// flat view of a Project, shared by all oracles
// ═════════════════════════════════════════════════════════════════════════════

interface Flat {
  ids: NodeId[];
  at: Map<NodeId, number>;
  parent: number[]; // -1 for the root
  kids: number[][];
  /** Branch length into the node, resolved by the documented asr convention. */
  len: number[];
  label: string[];
  isTip: boolean[];
  /** How many non-root lengths had to be substituted (0 keeps comparisons clean). */
  substituted: number;
}

function resolveLength(node: TreeNode): { len: number; substituted: boolean } {
  const bl = node.branchLength;
  if (bl === undefined) return { len: 1, substituted: true };
  if (typeof bl !== 'number' || Number.isNaN(bl) || !Number.isFinite(bl)) return { len: 1, substituted: true };
  if (bl < 0) return { len: 1, substituted: true };
  return { len: bl, substituted: false };
}

function flatten(project: Project): Flat {
  const ids: NodeId[] = [];
  const seen = new Set<NodeId>();
  const queue: NodeId[] = [project.rootId];
  while (queue.length) {
    const id = queue.shift() as NodeId;
    if (seen.has(id) || !project.nodes[id]) continue;
    seen.add(id);
    ids.push(id);
    for (const c of project.nodes[id].childrenIds) queue.push(c);
  }
  const at = new Map<NodeId, number>(ids.map((id, i) => [id, i] as const));
  const parent = new Array<number>(ids.length).fill(-1);
  const kids: number[][] = ids.map(() => []);
  const len = new Array<number>(ids.length).fill(0);
  let substituted = 0;
  ids.forEach((id, i) => {
    const node = project.nodes[id];
    const p = node.parentId !== null ? at.get(node.parentId) : undefined;
    if (p !== undefined) {
      parent[i] = p;
      kids[p].push(i);
    }
    const resolved = resolveLength(node);
    if (p !== undefined && resolved.substituted) substituted += 1;
    len[i] = p === undefined ? 0 : resolved.len;
  });
  return {
    ids,
    at,
    parent,
    kids,
    len,
    label: ids.map((id) => project.nodes[id].label),
    isTip: kids.map((l) => l.length === 0),
    substituted,
  };
}

/**
 * Observed state index per node; `null` = no observation. Only TIPS constrain a
 * reconstruction (both algorithms document that internal-node hypotheses are
 * ignored on purpose), and anything that is not a declared state id — unset,
 * '?' or '-' — counts as missing data.
 */
function observations(flat: Flat, project: Project, char: Character): (number | null)[] {
  const index = new Map(char.states.map((s, i) => [s.id, i]));
  return flat.ids.map((id, i) => {
    if (!flat.isTip[i]) return null;
    const raw = project.nodes[id].charStates?.[char.id];
    if (typeof raw !== 'string') return null;
    const idx = index.get(raw);
    return idx === undefined ? null : idx;
  });
}

/**
 * Sankoff step cost, from the documented convention: `matrix[i][j]` when present
 * and finite, else 0 on the diagonal / 1 off it (Fitch). Every matrix used below
 * is complete, so the fallback only reproduces the "no matrix ⇒ uniform" default.
 */
function stepCost(matrix: number[][] | undefined, i: number, j: number): number {
  const v = matrix?.[i]?.[j];
  return typeof v === 'number' && Number.isFinite(v) ? v : i === j ? 0 : 1;
}

/** ER (equal-rates Mk) transition probabilities over time t. */
function erMatrix(k: number, rate: number, t: number): number[][] {
  const e = Math.exp(-k * rate * t);
  const diag = 1 / k + ((k - 1) / k) * e;
  const off = 1 / k - e / k;
  return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? diag : off)));
}

function logSumExp(values: number[]): number {
  let max = -Infinity;
  for (const v of values) if (v > max) max = v;
  if (max === -Infinity) return -Infinity;
  return max + Math.log(values.reduce((a, b) => a + (b === -Infinity ? 0 : Math.exp(b - max)), 0));
}

/** The rate the app uses internally: 1 / mean(non-root resolved branch length). */
function appRate(flat: Flat): number {
  const lens = flat.ids
    .map((_, i) => i)
    .filter((i) => flat.parent[i] >= 0)
    .map((i) => flat.len[i]);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 1;
  return mean > 0 ? 1 / mean : 1;
}

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE 1 — exhaustive Sankoff parsimony
// ═════════════════════════════════════════════════════════════════════════════

const MAX_MIN_ASSIGNMENTS = 20_000;

interface BruteParsimony {
  cost: number;
  explored: number;
  /** Every assignment achieving `cost` (capped; see `truncated`). */
  minAssignments: number[][];
  truncated: boolean;
}

/** Enumerate EVERY assignment of a state to the free nodes; take the minimum. */
/**
 * The cheapest Sankoff cost over assignments that pin `node` to state `want`.
 *
 * A deliberately different program shape from what `parsimony()` does for
 * `mpStates` (which adds a downpass row to an uppass row): this re-runs a whole
 * minimisation with one node forced, so it cannot inherit an error in that
 * derivation — and unlike enumerating assignments it stays affordable on the
 * shipped projects, the cases where the union is not otherwise exercised.
 */
function minCostWith(
  flat: Flat,
  k: number,
  obs: (number | null)[],
  matrix: number[][] | undefined,
  node: number,
  want: number,
): number {
  const INF = Number.POSITIVE_INFINITY;
  const root = flat.parent.findIndex((par) => par < 0);
  const all = Array.from({ length: k }, (_, i) => i);
  // Post-order, built iteratively: the downpass needs children before parents.
  const order: number[] = [];
  const seen = new Set<number>([root]);
  const stack: number[] = [root];
  while (stack.length) {
    const v = stack.pop() as number;
    order.push(v);
    for (const c of flat.kids[v]) {
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(c);
    }
  }
  order.reverse();
  const g = new Map<number, number[]>();
  for (const v of order) {
    // The only difference from an ordinary Sankoff downpass: this node may take
    // one state, everything else stays free. A tip that carries an observation is
    // fixed BY THE DATA, so pinning it to a different state is not a feasible
    // assignment at all — the constrained minimum is +∞, not whatever the pin
    // happens to say.
    const observed = flat.isTip[v] ? obs[v] : null;
    let allowed: number[];
    if (v === node) allowed = observed === null || observed === want ? [want] : [];
    else if (observed !== null) allowed = [observed];
    else allowed = all;
    const row = new Array<number>(k).fill(INF);
    for (const i of allowed) {
      if (flat.isTip[v]) {
        row[i] = 0;
        continue;
      }
      let sum = 0;
      for (const c of flat.kids[v]) {
        const child = g.get(c) as number[];
        let best = INF;
        for (let j = 0; j < k; j += 1) {
          const v2 = stepCost(matrix, i, j) + child[j];
          if (v2 < best) best = v2;
        }
        sum += best;
      }
      row[i] = sum;
    }
    g.set(v, row);
  }
  return Math.min(...(g.get(root) as number[]));
}

/** Every state that still lets the whole tree reach `cost`, by re-minimisation. */
function mpStatesByPinning(
  flat: Flat,
  k: number,
  obs: (number | null)[],
  matrix: number[][] | undefined,
  cost: number,
  node: number,
): number[] {
  const out: number[] = [];
  for (let s = 0; s < k; s += 1) {
    if (minCostWith(flat, k, obs, matrix, node, s) === cost) out.push(s);
  }
  return out;
}

function bruteParsimony(
  flat: Flat,
  k: number,
  obs: (number | null)[],
  matrix: number[][] | undefined,
): BruteParsimony | 'over-budget' {
  const free: number[] = [];
  const st = new Array<number>(flat.ids.length).fill(0);
  obs.forEach((o, i) => {
    if (o === null) free.push(i);
    else st[i] = o;
  });
  let space = 1;
  for (let i = 0; i < free.length; i += 1) space *= k;
  if (space > ENUM_BUDGET) return 'over-budget';

  let best = Number.POSITIVE_INFINITY;
  const minAssignments: number[][] = [];
  let truncated = false;
  let explored = 0;

  const rec = (idx: number): void => {
    if (idx === free.length) {
      explored += 1;
      let sum = 0;
      for (let v = 0; v < flat.ids.length; v += 1) {
        const p = flat.parent[v];
        if (p < 0) continue;
        sum += stepCost(matrix, st[p], st[v]);
        if (sum > best) return; // branch and bound: cannot beat the incumbent
      }
      if (sum < best) {
        best = sum;
        minAssignments.length = 0;
        truncated = false;
      }
      if (sum === best) {
        if (minAssignments.length < MAX_MIN_ASSIGNMENTS) minAssignments.push(st.slice());
        else truncated = true;
      }
      return;
    }
    const node = free[idx];
    for (let s = 0; s < k; s += 1) {
      st[node] = s;
      rec(idx + 1);
    }
    st[node] = 0;
  };
  rec(0);
  return { cost: best, explored, minAssignments, truncated };
}

function assignmentCost(flat: Flat, assign: number[], matrix: number[][] | undefined): number {
  let sum = 0;
  for (let v = 0; v < flat.ids.length; v += 1) {
    const p = flat.parent[v];
    if (p < 0) continue;
    sum += stepCost(matrix, assign[p], assign[v]);
  }
  return sum;
}

/** States a node can take in a minimum-cost assignment, optionally with its
 *  parent pinned to a given state. */
function statesInMinAssignments(
  minAssignments: number[][],
  node: number,
  parent: number,
  parentState: number | null,
): number[] {
  const out = new Set<number>();
  for (const a of minAssignments) {
    if (parentState !== null && a[parent] !== parentState) continue;
    out.add(a[node]);
  }
  return [...out].sort((x, y) => x - y);
}

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE 2 — exhaustive Mk / ER marginalisation, plus a rate-injecting pruner
// ═════════════════════════════════════════════════════════════════════════════

interface BruteMk {
  probs: number[][];
  logLik: number;
  explored: number;
}

/** p(node = i | data) by summing the joint over all assignments. Direct, no DP. */
function bruteMk(flat: Flat, k: number, obs: (number | null)[], rate: number): BruteMk | 'over-budget' {
  const free: number[] = [];
  const st = new Array<number>(flat.ids.length).fill(0);
  obs.forEach((o, i) => {
    if (o === null) free.push(i);
    else st[i] = o;
  });
  let space = 1;
  for (let i = 0; i < free.length; i += 1) space *= k;
  if (space > ENUM_BUDGET) return 'over-budget';

  const P = flat.len.map((t) => erMatrix(k, rate, t)); // P[v]: parent(v) → v
  const marg = flat.ids.map(() => new Array<number>(k).fill(0));
  let total = 0;
  let explored = 0;

  const rec = (idx: number): void => {
    if (idx === free.length) {
      explored += 1;
      let w = 1 / k; // stationary (= uniform) root prior
      for (let v = 1; v < flat.ids.length; v += 1) w *= P[v][st[flat.parent[v]]][st[v]];
      if (w === 0) return;
      total += w;
      for (let v = 0; v < flat.ids.length; v += 1) marg[v][st[v]] += w;
      return;
    }
    const node = free[idx];
    for (let s = 0; s < k; s += 1) {
      st[node] = s;
      rec(idx + 1);
    }
    st[node] = 0;
  };
  rec(0);

  const probs = marg.map((row) => {
    const sum = row.reduce((a, b) => a + b, 0);
    return sum > 0 ? row.map((x) => x / sum) : row.map(() => 1 / k);
  });
  return { probs, logLik: Math.log(total), explored };
}

/**
 * Felsenstein pruning with an INJECTABLE rate. Needed because `reconstructMk`
 * hard-codes r = 1/mean(branch length), and that choice has to be compared with an
 * ML-estimated rate. Own implementation (log-space, per-message scaling),
 * validated against `bruteMk` (small trees) and against `reconstructMk` (app rate)
 * before any r-sensitivity number is taken from it.
 */
function pruneMk(flat: Flat, k: number, obs: (number | null)[], rate: number): { probs: number[][]; logLik: number } {
  const n = flat.ids.length;
  const Ls: number[][] = Array.from({ length: n }, () => new Array<number>(k).fill(0));
  const offL = new Array<number>(n).fill(0);
  const Gs: number[][] = Array.from({ length: n }, () => new Array<number>(k).fill(0));
  const offG = new Array<number>(n).fill(0);
  const rootLogPrior = -Math.log(k);

  /** log(Σ_j P_ij(t)·exp(logVec_j)); shifting logVec shifts the result equally. */
  const transmit = (t: number, logVec: number[]): number[] => {
    const P = erMatrix(k, rate, t);
    const out = new Array<number>(k).fill(-Infinity);
    for (let i = 0; i < k; i += 1) {
      const terms: number[] = [];
      for (let j = 0; j < k; j += 1) {
        if (logVec[j] === -Infinity || P[i][j] <= 0) continue;
        terms.push(Math.log(P[i][j]) + logVec[j]);
      }
      out[i] = logSumExp(terms);
    }
    return out;
  };

  const scale = (row: number[]): { scaled: number[]; off: number } => {
    const m = Math.max(...row);
    if (!Number.isFinite(m)) return { scaled: row.map(() => 0), off: -Infinity };
    return { scaled: row.map((x) => x - m), off: m };
  };

  const preOrder = flat.ids.map((_, i) => i);
  for (const v of preOrder.slice().reverse()) {
    if (flat.isTip[v]) {
      const o = obs[v];
      Ls[v] = Array.from({ length: k }, (_, i) => (o === null ? 0 : i === o ? 0 : -Infinity));
      offL[v] = 0;
      continue;
    }
    const msgs = flat.kids[v].map((c) => transmit(flat.len[c], Ls[c]));
    const raw = Array.from({ length: k }, (_, i) => msgs.reduce((a, m) => a + m[i], 0));
    const dead = (row: number[]): boolean => row.every((x) => x === -Infinity);
    const s = scale(raw);
    Ls[v] = s.scaled;
    // The true log-message is the scaled one plus every child offset, so the
    // site likelihood is only right if those offsets are carried forward here.
    offL[v] = dead(raw)
      ? -Infinity
      : s.off + flat.kids[v].reduce((a, c, ci) => a + (dead(msgs[ci]) ? 0 : offL[c]), 0);
  }

  Gs[0] = new Array<number>(k).fill(rootLogPrior);
  offG[0] = 0;
  for (const v of preOrder) {
    if (flat.isTip[v]) continue;
    const msgs = flat.kids[v].map((c) => transmit(flat.len[c], Ls[c]));
    flat.kids[v].forEach((c, ci) => {
      let combined = Gs[v].slice();
      let scalar = offG[v];
      msgs.forEach((m, mi) => {
        if (mi === ci) return;
        combined = combined.map((x, i) => x + m[i]);
        scalar += offL[flat.kids[v][mi]];
      });
      const s = scale(transmit(flat.len[c], combined));
      Gs[c] = s.scaled;
      offG[c] = s.off + scalar;
    });
  }

  const probs = flat.ids.map((_, v) => {
    const post = Ls[v].map((x, i) => x + Gs[v][i] + offL[v] + offG[v]);
    const z = logSumExp(post);
    return post.map((x) => (z === -Infinity ? 1 / k : Math.exp(x - z)));
  });
  return { probs, logLik: logSumExp(Ls[0].map((x) => x + offL[0] + rootLogPrior)) };
}

/** grid scan + golden-section refinement of the site likelihood over log10(rate). */
function mlRate(flat: Flat, k: number, obs: (number | null)[]): { rate: number; logLik: number } {
  const f = (logR: number): number => pruneMk(flat, k, obs, 10 ** logR).logLik;
  let bestLog = -12;
  let bestVal = f(-12);
  for (let x = -12; x <= 2.0001; x += 0.25) {
    const v = f(x);
    if (v > bestVal) {
      bestVal = v;
      bestLog = x;
    }
  }
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = bestLog - 0.25;
  let b = bestLog + 0.25;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let iter = 0; iter < 100 && b - a > 1e-10; iter += 1) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  const rate = 10 ** ((a + b) / 2);
  return { rate, logLik: pruneMk(flat, k, obs, rate).logLik };
}

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE 3 — set-based consensus
// ═════════════════════════════════════════════════════════════════════════════

const tipSetOf = (project: Project): string[] =>
  [
    ...new Set(
      Object.values(project.nodes)
        .filter((n) => n.childrenIds.length === 0 && n.label)
        .map((n) => n.label),
    ),
  ].sort();

/** Rooted clades (every internal node but the root) as sorted `A+B+C` keys. */
function oracleCladeKeys(project: Project): { keys: Set<string>; byNode: Map<NodeId, string> } {
  const keys = new Set<string>();
  const byNode = new Map<NodeId, string>();
  const total = new Set(tipSetOf(project)).size;
  const tipsBelow = (id: NodeId): string[] => {
    const out: string[] = [];
    const stack: NodeId[] = [id];
    while (stack.length) {
      const node = project.nodes[stack.pop() as NodeId];
      if (!node) continue;
      if (node.childrenIds.length === 0) {
        if (node.label) out.push(node.label);
      } else {
        for (const c of node.childrenIds) stack.push(c);
      }
    }
    return out;
  };
  for (const node of Object.values(project.nodes)) {
    if (node.childrenIds.length === 0 || node.id === project.rootId) continue;
    const set = [...new Set(tipsBelow(node.id))].sort();
    if (set.length === 0 || set.length >= total) continue;
    const key = set.join('+');
    keys.add(key);
    byNode.set(node.id, key);
  }
  return { keys, byNode };
}

interface OracleConsensus {
  reject: string | null;
  supports: Map<string, number>;
  selected: Map<string, number>;
}

/** Support counted by hand; selection by the strict / >50% rule. */
function oracleConsensus(projects: Project[], method: ConsensusMethod): OracleConsensus {
  const empty: OracleConsensus = { reject: null, supports: new Map(), selected: new Map() };
  if (projects.length === 0) return { ...empty, reject: 'no trees' };
  const base = tipSetOf(projects[0]);
  if (base.length === 0) return { ...empty, reject: 'no named tips' };
  for (let i = 0; i < projects.length; i += 1) {
    const rawTips = Object.values(projects[i].nodes).filter((n) => n.childrenIds.length === 0);
    if (rawTips.some((n) => !n.label)) return { ...empty, reject: `tree ${i + 1} has unnamed tips` };
    if (tipSetOf(projects[i]).join('|') !== base.join('|')) {
      return { ...empty, reject: `tree ${i + 1} tip set differs` };
    }
    if (new Set(rawTips.map((n) => n.label)).size !== rawTips.length) {
      return { ...empty, reject: `tree ${i + 1} repeats a tip label` };
    }
  }
  const supports = new Map<string, number>();
  for (const p of projects) {
    for (const key of oracleCladeKeys(p).keys) supports.set(key, (supports.get(key) ?? 0) + 1);
  }
  const threshold = method === 'strict' ? projects.length : Math.floor(projects.length / 2) + 1;
  const selected = new Map<string, number>();
  for (const [key, count] of supports) if (count >= threshold) selected.set(key, count);
  return { reject: null, supports, selected };
}

/** Decode the app's index-encoded clade keys into label keys, separator-agnostic. */
function decodeAppKeys(keys: Set<string>, tips: string[]): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const idx = key
      .split(/[^0-9]+/)
      .filter((x) => x !== '')
      .map(Number);
    out.add(idx.map((i) => tips[i]).sort().join('+'));
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// ORACLE 4 — exhaustive DTL enumeration
//
// Search space: every gene node is either ABSENT (its incoming lineage was lost,
// which prunes its whole gene sub-tree) or PLACED on a species node; a placed
// gene tip must sit on its mapped species. Each placed internal gene node then
// takes the cheapest event class compatible with where its children landed,
// under the cost model the solver documents (header of dtl.ts):
//   duplication — both lineages continue inside the SAME species subtree (a
//                 unary duplication additionally loses the surplus copy there);
//   speciation  — lineages continue into two DISTINCT children of the species
//                 node (a unary node passes through into exactly one child);
//   transfer    — one lineage stays inside the node's own subtree, the other is
//                 received from a region that is neither that subtree nor an
//                 ancestor of it (the model's topology-only temporal rule);
//   loss        — a child lineage that does not continue costs one loss.
// The gene root may sit on any species node; `rootFee` prices it elsewhere (the
// solver's `rootTransferCost`, 0 by default).
// ═════════════════════════════════════════════════════════════════════════════

interface DtlTree {
  flat: Flat;
  /** gene node index → species node indices it may occupy (tips: 0 or 1) */
  allowed: number[][];
  root: number;
}

function speciesTree(project: Project): DtlTree {
  const flat = flatten(project);
  return {
    flat,
    allowed: flat.ids.map(() => flat.ids.map((_, s) => s)),
    root: flat.at.get(project.rootId) ?? 0,
  };
}

function geneTree(project: Project, tipMap: Record<string, string>, species: DtlTree): DtlTree {
  const flat = flatten(project);
  const allowed = flat.ids.map((id, i) => {
    if (!flat.isTip[i]) return species.flat.ids.map((_, s) => s);
    const target = tipMap[flat.label[i]];
    const s = target === undefined ? -1 : species.flat.label.indexOf(target);
    return s < 0 ? [] : [s];
  });
  return { flat, allowed, root: flat.at.get(project.rootId) ?? 0 };
}

type EventKey = 'dup' | 'sigma' | 'transfer';

/**
 * Every event class feasible for placed gene node `g` under placement array
 * `place`, with its cheapest price. Shared by the exhaustive search and by the
 * re-pricing of the scenario the DP actually traced.
 */
function feasibleEvents(
  species: DtlTree,
  gene: DtlTree,
  costs: ReconCosts,
  place: number[],
  g: number,
): Map<EventKey, { cost: number; losses: number }> {
  const out = new Map<EventKey, { cost: number; losses: number }>();
  const sp = species.flat;
  const kids = gene.flat.kids[g];
  if (kids.length === 0) return out;
  const s = place[g];
  const inSubtree = (region: number, z: number): boolean => {
    let cur = z;
    for (;;) {
      if (cur === region) return true;
      if (sp.parent[cur] < 0) return false;
      cur = sp.parent[cur];
    }
  };
  const consider = (ev: EventKey, cost: number, losses: number): void => {
    const prev = out.get(ev);
    if (!prev || cost < prev.cost) out.set(ev, { cost, losses });
  };

  // duplication — every child lineage continues inside subtree(s) or is lost
  {
    let losses = kids.length === 1 ? 1 : 0; // surplus copy of a unary duplication
    let ok = true;
    for (const c of kids) {
      if (place[c] < 0) losses += 1;
      else if (!inSubtree(s, place[c])) ok = false;
    }
    if (ok) consider('dup', costs.dup + losses * costs.loss, losses);
  }

  const spKids = sp.kids[s];
  if (kids.length >= 2) {
    // speciation into two distinct species children
    for (let i = 0; i < spKids.length; i += 1) {
      for (let j = 0; j < spKids.length; j += 1) {
        if (i === j) continue;
        const regions = [spKids[i], spKids[j]];
        let losses = 0;
        let ok = true;
        kids.slice(0, 2).forEach((c, ci) => {
          if (place[c] < 0) losses += 1;
          else if (!inSubtree(regions[ci], place[c])) ok = false;
        });
        if (ok) consider('sigma', losses * costs.loss, losses);
      }
    }
    // transfer — one lineage stays, the other arrives from outside
    for (let orient = 0; orient < 2; orient += 1) {
      const stay = kids[orient];
      const leave = kids[1 - orient];
      const lv = place[leave];
      if (lv < 0) continue;
      if (inSubtree(s, lv) || inSubtree(lv, s)) continue; // own subtree or ancestor
      let losses = 0;
      let ok = true;
      if (place[stay] < 0) losses += 1;
      else if (!inSubtree(s, place[stay])) ok = false;
      if (ok) consider('transfer', costs.transfer + losses * costs.loss, losses);
    }
  } else {
    // unary — pass-through into one species child, or relocation out of it
    for (const region of spKids) {
      const c = kids[0];
      if (place[c] < 0) consider('sigma', costs.loss, 1);
      else if (inSubtree(region, place[c])) consider('sigma', 0, 0);
    }
    const lv = place[kids[0]];
    if (lv >= 0 && !inSubtree(s, lv) && !inSubtree(lv, s)) consider('transfer', costs.transfer, 0);
  }
  return out;
}

interface BruteDtl {
  cost: number;
  structures: number;
  bestPlace: number[];
  bestEvents: Map<number, EventKey>;
  bestLosses: number;
}

function bruteDtl(species: DtlTree, gene: DtlTree, costs: ReconCosts, rootFee = 0): BruteDtl | 'over-budget' {
  const order = gene.flat.ids
    .map((_, i) => i)
    .sort((a, b) => depthIndex(gene, a) - depthIndex(gene, b)); // parents first
  let space = 1;
  gene.flat.ids.forEach((_, i) => {
    space *= i === gene.root ? Math.max(1, gene.allowed[i].length) : gene.allowed[i].length + 1;
  });
  if (space > ENUM_BUDGET) return 'over-budget';

  const place = new Array<number>(gene.flat.ids.length).fill(-1);
  let best: BruteDtl | null = null;
  let structures = 0;

  const evaluate = (): void => {
    if (place[gene.root] < 0) return;
    structures += 1;
    let cost = 0;
    let losses = 0;
    const events = new Map<number, EventKey>();
    for (const g of order) {
      if (place[g] < 0) continue; // absent: its fate was priced by its parent
      if (gene.flat.isTip[g]) continue; // tips carry no event of their own
      const options = feasibleEvents(species, gene, costs, place, g);
      if (options.size === 0) return; // infeasible structure
      let pick: { key: EventKey; cost: number; losses: number } | null = null;
      for (const [key, val] of options) {
        if (pick === null || val.cost < pick.cost) pick = { key, ...val };
      }
      if (pick === null) return;
      cost += pick.cost;
      losses += pick.losses;
      events.set(g, pick.key);
    }
    if (rootFee > 0 && place[gene.root] !== species.root) cost += rootFee;
    if (best === null || cost < best.cost) {
      best = { cost, structures, bestPlace: place.slice(), bestEvents: events, bestLosses: losses };
    }
  };

  const rec = (idx: number): void => {
    if (idx === order.length) {
      evaluate();
      return;
    }
    const g = order[idx];
    const parent = gene.flat.parent[g];
    if (g !== gene.root && parent >= 0 && place[parent] < 0) {
      place[g] = -1;
      rec(idx + 1);
      return;
    }
    if (g === gene.root) {
      for (const s of gene.allowed[g]) {
        place[g] = s;
        rec(idx + 1);
      }
      place[g] = -1;
      return;
    }
    place[g] = -1; // this lineage is bought out by one loss
    rec(idx + 1);
    for (const s of gene.allowed[g]) {
      place[g] = s;
      rec(idx + 1);
    }
    place[g] = -1;
  };
  rec(0);

  if (best === null) {
    return { cost: Number.POSITIVE_INFINITY, structures, bestPlace: [], bestEvents: new Map(), bestLosses: 0 };
  }
  return best;
}

function depthIndex(tree: DtlTree, i: number): number {
  let d = 0;
  let cur = tree.flat.parent[i];
  while (cur >= 0) {
    cur = tree.flat.parent[cur];
    d += 1;
  }
  return d;
}

/** Re-price the scenario the DP traced: its placements + declared events. */
function priceTracedScenario(
  species: DtlTree,
  gene: DtlTree,
  costs: ReconCosts,
  placements: Record<NodeId, NodeId>,
  events: Record<NodeId, 'speciation' | 'duplication' | 'transfer'>,
  rootFees: number,
): { cost: number; losses: number; infeasible: string[]; nonCheapest: string[] } {
  const place = gene.flat.ids.map((id) => {
    const sp = placements[id];
    if (sp === undefined) return -1;
    return species.flat.at.get(sp) ?? -1;
  });
  const eventKey: Record<string, EventKey> = { speciation: 'sigma', duplication: 'dup', transfer: 'transfer' };
  let cost = rootFees;
  let losses = 0;
  const infeasible: string[] = [];
  const nonCheapest: string[] = [];
  gene.flat.ids.forEach((id, g) => {
    if (gene.flat.isTip[g]) return;
    if (place[g] < 0) {
      if (g !== gene.root) return;
      infeasible.push(`${gene.flat.label[g]}:unplaced-root`);
      return;
    }
    const options = feasibleEvents(species, gene, costs, place, g);
    const declared = eventKey[events[id] ?? ''] ?? null;
    if (declared === null || !options.has(declared)) {
      infeasible.push(`${gene.flat.label[g]}:${events[id] ?? 'none'}`);
      return;
    }
    const pick = options.get(declared) as { cost: number; losses: number };
    cost += pick.cost;
    losses += pick.losses;
    let cheapest = Number.POSITIVE_INFINITY;
    for (const v of options.values()) cheapest = Math.min(cheapest, v.cost);
    if (pick.cost > cheapest) nonCheapest.push(gene.flat.label[g]);
  });
  return { cost, losses, infeasible, nonCheapest };
}

// ═════════════════════════════════════════════════════════════════════════════
// deterministic pseudo-randomness for the property legs
// ═════════════════════════════════════════════════════════════════════════════

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Random rooted binary Newick over `labels`. */
function randomNewick(labels: string[], rnd: () => number): string {
  const shuffle = <T,>(a: T[]): T[] => {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const build = (set: string[]): string => {
    if (set.length === 1) return set[0];
    const mixed = shuffle(set);
    const cut = 1 + Math.floor(rnd() * (mixed.length - 1));
    return `(${build(mixed.slice(0, cut))},${build(mixed.slice(cut))})`;
  };
  return `${build(labels)};`;
}

/**
 * Random tree over the same taxa, but with `blocks` forced to be clades in every
 * tree. Independent random trees almost never share a clade at six taxa, so the
 * strict / majority legs would only ever compare empty sets; this keeps the
 * shared clades and randomises everything above them.
 */
function randomNewickWithBlocks(blocks: string[][], rnd: () => number): string {
  const inner = blocks.map((b) => (b.length === 1 ? b[0] : `(${b.join(',')})`));
  const above = randomNewick(inner.map((_, i) => `b${i}`), rnd).replace(/;$/, '');
  let text = above;
  inner.forEach((rep, i) => {
    text = text.replace(new RegExp(`\\bb${i}\\b`, 'g'), rep);
  });
  return `${text};`;
}

const maxAbsDiff = (a: number[], b: number[]): number =>
  a.reduce((m, v, i) => Math.max(m, Math.abs(v - (b[i] ?? 0))), 0);

const argmax = (v: number[]): number => v.reduce((best, x, i) => (x > v[best] ? i : best), 0);

/**
 * True when two posterior vectors genuinely peak at different states. Vectors
 * with a tied top state are NOT counted as disagreeing: which of two exactly
 * equal states an implementation reports is a floating-point coin flip, not a
 * difference of opinion about the reconstruction.
 */
const peaksDiffer = (a: number[], b: number[], tol = 1e-9): boolean => {
  const runnerUp = (v: number[], i: number): number =>
    v.reduce((m, x, j) => (j === i ? m : Math.max(m, x)), -Infinity);
  const ia = argmax(a);
  const ib = argmax(b);
  if (ia === ib) return false;
  return a[ia] - runnerUp(a, ia) > tol && b[ib] - runnerUp(b, ib) > tol;
};

// ═════════════════════════════════════════════════════════════════════════════
// TESTS — 1. Sankoff / fixed parsimony
// ═════════════════════════════════════════════════════════════════════════════

const ORDERED_3 = [
  [0, 2, 3],
  [2, 0, 1],
  [3, 1, 0],
];

const ASYMMETRIC_3 = [
  [0, 10, 1],
  [1, 0, 10],
  [10, 1, 0],
];

interface ParsimonyCase {
  name: string;
  nwk: string;
  k: number;
  matrix?: number[][];
  states: Record<string, string>;
}

const PARSIMONY_CASES: ParsimonyCase[] = [
  {
    name: 'uniform-matrix-2state-4tips',
    nwk: '((A:1,B:1)i1:1,(C:1,D:1)i2:1)root;',
    k: 2,
    states: { A: 's0', B: 's0', C: 's1', D: 's1' },
  },
  {
    name: 'uniform-matrix-3state-5tips',
    nwk: '((A:1,B:1)i1:1,((C:1,D:1)i2:1,E:1)i3:1)root;',
    k: 3,
    states: { A: 's0', B: 's1', C: 's2', D: 's2', E: 's0' },
  },
  {
    name: 'ordered-additive-3state',
    nwk: '((A:1,B:1)i1:1,(C:1,D:1)i2:1)root;',
    k: 3,
    matrix: ORDERED_3,
    states: { A: 's0', B: 's0', C: 's2', D: 's2' },
  },
  {
    name: 'ordered-additive-3state-conflict',
    nwk: '(((A:1,B:1)i1:1,(C:1,D:1)i2:1)i3:1,E:1)root;',
    k: 3,
    matrix: ORDERED_3,
    states: { A: 's0', B: 's2', C: 's1', D: 's2', E: 's0' },
  },
  {
    name: 'asymmetric-3state-cycle',
    nwk: '((A:1,B:1)i1:1,(C:1,D:1)i2:1)root;',
    k: 3,
    matrix: ASYMMETRIC_3,
    states: { A: 's0', B: 's1', C: 's2', D: 's0' },
  },
  {
    name: 'asymmetric-2state-irreversibility',
    nwk: '(((A:1,B:1)i1:1,(C:1,D:1)i2:1)i3:1,E:1)root;',
    k: 2,
    matrix: [
      [0, 7],
      [1, 0],
    ],
    states: { A: 's1', B: 's1', C: 's0', D: 's0', E: 's1' },
  },
  {
    name: 'missing-and-inapplicable-coded',
    nwk: '((A:1,B:1)i1:1,(C:1,D:1)i2:1)root;',
    k: 2,
    states: { A: 's0', B: 's1', C: '?', D: '-' },
  },
  {
    name: 'missing-tip-forces-cheap-branch',
    nwk: '(((A:1,B:1)i1:1,C:1)i2:1,(D:1,E:1)i3:1)root;',
    k: 3,
    matrix: ORDERED_3,
    states: { A: 's0', B: '?', C: 's2', D: '-', E: 's2' },
  },
  {
    name: 'all-tips-missing',
    nwk: '((A:1,B:1)i1:1,C:1)root;',
    k: 3,
    states: { A: '?', B: '?', C: '?' },
  },
  {
    name: 'unary-internal-node',
    nwk: '((A:1,B:1)i1:1)root;',
    k: 2,
    matrix: [
      [0, 1],
      [1, 0],
    ],
    states: { A: 's0', B: 's1' },
  },
  {
    name: 'pectinate-6tips-3state',
    nwk: '(A:1,(B:1,(C:1,(D:1,(E:1,F:1)k:1)j:1)i:1)h:1)root;',
    k: 3,
    states: { A: 's0', B: 's1', C: 's2', D: 's0', E: 's1', F: 's2' },
  },
  {
    name: 'polytomy-5-children',
    nwk: '(A:1,B:1,C:1,D:1,E:1)root;',
    k: 3,
    matrix: ASYMMETRIC_3,
    states: { A: 's0', B: 's1', C: 's2', D: 's0', E: 's1' },
  },
];

describe('Sankoff / fixed parsimony vs exhaustive enumeration', () => {
  for (const c of PARSIMONY_CASES) {
    it(`matches the brute-force minimum, tie sets and chosen path on ${c.name}`, () => {
      const project = projectFromNewick(c.nwk, c.name);
      const char = makeCharacter(c.k, c.matrix);
      setStates(project, char, c.states);
      project.characters.push(char);

      const flat = flatten(project);
      const obs = observations(flat, project, char);
      const oracle = bruteParsimony(flat, c.k, obs, c.matrix);
      expect(oracle, c.name).not.toBe('over-budget');
      const brute = oracle as BruteParsimony;
      const app = parsimony(project, char);
      const indexOf = (id: string | undefined): number => char.states.findIndex((s) => s.id === id);

      // (i) the reported minimum cost
      expect(app.cost, c.name).toBe(brute.cost);
      // (ii) tips keep the observed state; missing codes never echo back
      for (let v = 0; v < flat.ids.length; v += 1) {
        if (!flat.isTip[v]) continue;
        const chosen = app.chosen.get(flat.ids[v]);
        if (obs[v] !== null) expect(chosen, `${c.name} tip ${flat.label[v]}`).toBe(char.states[obs[v] as number].id);
        else expect(char.states.some((s) => s.id === chosen), `${c.name} free tip ${flat.label[v]}`).toBe(true);
      }
      // (iii) the tie set is exactly the set of states occurring in a
      //       minimum-cost assignment consistent with the chosen parent state
      if (!brute.truncated) {
        for (let v = 0; v < flat.ids.length; v += 1) {
          const p = flat.parent[v];
          const chosenIdx = indexOf(app.chosen.get(flat.ids[v]));
          const parentChosen = p < 0 ? null : indexOf(app.chosen.get(flat.ids[p]));
          const allowedByOracle = statesInMinAssignments(brute.minAssignments, v, p, parentChosen);
          const appTies = [...new Set((app.states.get(flat.ids[v]) ?? []).map(indexOf))].sort((x, y) => x - y);
          expect(appTies, `${c.name} tie set at ${flat.label[v]}`).toEqual(allowedByOracle);
          // (iv) the UNCONDITIONAL set: every state occurring in any optimal
          // assignment, which is what the ambiguity warning reports and the
          // fixtures export. Enumerated here without reference to any parent
          // state, so a parent-conditional value cannot satisfy it by accident.
          const globalAtV = [...new Set(brute.minAssignments.map((a) => a[v]))].sort((x, y) => x - y);
          const appGlobal = [...new Set((app.mpStates.get(flat.ids[v]) ?? []).map(indexOf))].sort((x, y) => x - y);
          expect(appGlobal, `${c.name} MP-state union at ${flat.label[v]}`).toEqual(globalAtV);
          // ...and the pinning oracle, which shares no code with either, agrees
          // with the enumeration too — so the shipped-project use below is not
          // the first time this oracle has been exercised.
          expect(
            mpStatesByPinning(flat, char.states.length, obs, char.costMatrix, brute.cost, v),
            `${c.name} pinning oracle at ${flat.label[v]}`,
          ).toEqual(globalAtV);
          expect(chosenIdx).toBeGreaterThanOrEqual(0);
          expect(
            allowedByOracle.includes(chosenIdx),
            `${c.name}: the chosen state at ${flat.label[v]} must lie on a most-parsimonious path`,
          ).toBe(true);
        }
      }
      // (v) the reported change branches match the chosen path's changes
      const states = flat.ids.map((id) => indexOf(app.chosen.get(id)));
      let changes = 0;
      flat.ids.forEach((_, v) => {
        const p = flat.parent[v];
        if (p >= 0 && states[p] !== states[v]) changes += 1;
      });
      expect(app.changeBranches.size, c.name).toBe(changes);
      // (vi) the chosen path can never beat the optimum; equality = optimal path
      const pathCost = assignmentCost(flat, states, c.matrix);
      expect(pathCost, c.name).toBeGreaterThanOrEqual(brute.cost);
      if (pathCost !== brute.cost) suboptimalPathCases += 1;

      record(
        'sankoff',
        c.name,
        'min-cost-agrees',
        app.cost === brute.cost,
        `app=${app.cost} brute=${brute.cost} k=${c.k} nodes=${flat.ids.length} explored=${brute.explored}`,
      );
      record(
        'sankoff',
        c.name,
        'chosen-path-cost',
        pathCost,
        pathCost === brute.cost ? 'optimal' : `SUBOPTIMAL by ${pathCost - brute.cost}`,
      );
      record('sankoff', c.name, 'chosen-path-optimal', pathCost === brute.cost);
    });
  }

  it('matches the brute-force minimum on the shipped sample projects', () => {
    let enumerated = 0;
    let overBudget = 0;
    for (const descriptor of SAMPLE_PROJECTS) {
      const project = descriptor.build();
      for (const char of project.characters) {
        if (char.type !== 'discrete' || char.states.length < 2) continue;
        const flat = flatten(project);
        const obs = observations(flat, project, char);
        const oracle = bruteParsimony(flat, char.states.length, obs, char.costMatrix);
        const app = parsimony(project, char);
        if (oracle === 'over-budget') {
          // Enumeration cannot reach these trees (2^free assignments), which is
          // exactly why the MP-state union went untested on the shipped data.
          // Re-minimising with one node pinned scales to them, so check the
          // union here rather than skipping the character outright.
          overBudget += 1;
          for (let v = 0; v < flat.ids.length; v += 1) {
            const want = mpStatesByPinning(flat, char.states.length, obs, char.costMatrix, app.cost, v);
            const got = [...new Set((app.mpStates.get(flat.ids[v]) ?? []).map((id) => char.states.findIndex((x) => x.id === id)))].sort((x, y) => x - y);
            expect(got, `${descriptor.id}/${char.name} MP-state union at ${flat.label[v]}`).toEqual(want);
          }
          record('sankoff', `sample:${descriptor.id}`, 'enumeration', 'over-budget', `k=${char.states.length} nodes=${flat.ids.length}; MP union checked by pinning instead`);
          continue;
        }
        expect(app.cost, `${descriptor.id}/${char.name}`).toBe(oracle.cost);
        for (let v = 0; v < flat.ids.length; v += 1) {
          const want = mpStatesByPinning(flat, char.states.length, obs, char.costMatrix, oracle.cost, v);
          const got = [...new Set((app.mpStates.get(flat.ids[v]) ?? []).map((id) => char.states.findIndex((x) => x.id === id)))].sort((x, y) => x - y);
          expect(got, `${descriptor.id}/${char.name} MP-state union at ${flat.label[v]}`).toEqual(want);
        }
        const sampleStates = flat.ids.map((id) => char.states.findIndex((x) => x.id === app.chosen.get(id)));
        if (assignmentCost(flat, sampleStates, char.costMatrix) !== oracle.cost) suboptimalPathCases += 1;
        // the samples store hypotheses on internal nodes: they must not constrain
        const internalHypotheses = flat.ids.filter((id, i) => !flat.isTip[i] && project.nodes[id].charStates?.[char.id]).length;
        expect(obs.every((o, i) => flat.isTip[i] || o === null), 'internal nodes are not observations').toBe(true);
        enumerated += 1;
        record(
          'sankoff',
          `sample:${descriptor.id}`,
          'min-cost-agrees',
          true,
          `k=${char.states.length} internal=${flat.ids.length - flat.isTip.filter(Boolean).length} hypotheses-ignored=${internalHypotheses} explored=${oracle.explored} app=${app.cost} brute=${oracle.cost}`,
        );
      }
    }
    expect(enumerated, 'sample characters exhaustively re-checked').toBeGreaterThanOrEqual(8);
    record('sankoff', 'samples', 'enumerated-characters', enumerated, `over-budget (not enumerated): ${overBudget}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TESTS — 2. Mk / ER marginal reconstruction
// ═════════════════════════════════════════════════════════════════════════════

interface MkCase {
  name: string;
  nwk: string;
  k: number;
  states: Record<string, string>;
}

const MK_CASES: MkCase[] = [
  {
    name: 'er-2state-4tips',
    nwk: '((A:1,B:1)i1:1,(C:1,D:1)i2:1)root;',
    k: 2,
    states: { A: 's0', B: 's0', C: 's1', D: 's1' },
  },
  {
    name: 'er-2state-uneven-lengths',
    nwk: '((A:0.2,B:2.5)i1:0.7,(C:1.4,D:0.1)i2:3)root;',
    k: 2,
    states: { A: 's0', B: 's1', C: 's1', D: 's0' },
  },
  {
    name: 'er-3state-5tips',
    nwk: '((A:1,B:1)i1:1,((C:1,D:1)i2:1,E:1)i3:1)root;',
    k: 3,
    states: { A: 's0', B: 's1', C: 's2', D: 's2', E: 's1' },
  },
  {
    name: 'er-3state-missing-tip',
    nwk: '((A:1,B:1)i1:1,(C:1,D:1)i2:1)root;',
    k: 3,
    states: { A: 's0', B: 's2', C: '?', D: '-' },
  },
  {
    name: 'er-2state-zero-length-branch',
    nwk: '((A:1,B:1)i1:0,(C:1,D:1)i2:2)root;',
    k: 2,
    states: { A: 's0', B: 's0', C: 's1', D: 's1' },
  },
  {
    name: 'er-2state-long-branches',
    nwk: '((A:8,B:8)i1:8,(C:8,D:8)i2:8)root;',
    k: 2,
    states: { A: 's0', B: 's1', C: 's0', D: 's1' },
  },
  {
    name: 'er-3state-pectinate-6tips',
    nwk: '(A:1,(B:1.5,(C:0.5,(D:2,(E:1,F:1)k:1)j:1)i:1)h:1)root;',
    k: 3,
    states: { A: 's0', B: 's1', C: 's1', D: 's2', E: 's0', F: 's2' },
  },
  {
    name: 'er-2state-8tips-balanced',
    nwk: '(((A:1,B:1)w:1,(C:1,D:1)x:1)y:1,((E:1,F:1)z:1,(G:1,H:1)q:1)r:1)root;',
    k: 2,
    states: { A: 's0', B: 's0', C: 's1', D: 's1', E: 's0', F: 's1', G: 's1', H: 's1' },
  },
];

describe('Mk / ER marginals vs exhaustive marginalisation', () => {
  for (const c of MK_CASES) {
    it(`matches the exact marginal posteriors node-by-node on ${c.name}`, () => {
      const project = projectFromNewick(c.nwk, c.name);
      const char = makeCharacter(c.k);
      setStates(project, char, c.states);
      project.characters.push(char);

      const flat = flatten(project);
      const obs = observations(flat, project, char);
      expect(flat.substituted, `${c.name}: every branch length explicit`).toBe(0);
      const rate = appRate(flat);
      const oracle = bruteMk(flat, c.k, obs, rate);
      expect(oracle, c.name).not.toBe('over-budget');
      const exact = oracle as BruteMk;

      const app = reconstructMk(project, char, DEFAULT_ASR_OPTIONS);
      expect(app, c.name).not.toBeNull();
      const result = app as NonNullable<typeof app>;
      expect(
        result.warnings.filter((w) => w.kind !== 'zero-branch-length'),
        c.name,
      ).toEqual([]);

      let compared = 0;
      let mismatches = 0;
      let worst = 0;
      for (let v = 0; v < flat.ids.length; v += 1) {
        const row = result.probs.get(flat.ids[v]) as number[];
        expect(row, `${c.name} node ${flat.label[v]}`).toBeDefined();
        expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        const diff = maxAbsDiff(row, exact.probs[v]);
        worst = Math.max(worst, diff);
        compared += 1;
        if (diff > 1e-9 || peaksDiffer(row, exact.probs[v])) mismatches += 1;
        expect(diff, `${c.name} node ${flat.label[v]}`).toBeLessThan(1e-9);
      }
      // the independent rate-injecting pruner has to agree with both
      const pruned = pruneMk(flat, c.k, obs, rate);
      let pruneWorst = 0;
      for (let v = 0; v < flat.ids.length; v += 1) {
        pruneWorst = Math.max(pruneWorst, maxAbsDiff(pruned.probs[v], exact.probs[v]));
      }
      expect(pruneWorst, c.name).toBeLessThan(1e-9);

      record('mk', c.name, 'nodes-compared', compared, `k=${c.k} assignments-enumerated=${exact.explored}`);
      record('mk', c.name, 'node-agreement', `${compared - mismatches}/${compared}`, `max |Δp| app-vs-exact = ${worst.toExponential(2)}`);
      record('mk', c.name, 'pruner-agreement', pruneWorst < 1e-9 ? 'exact' : 'OFF', `max |Δp| pruner-vs-exact = ${pruneWorst.toExponential(2)}`);
      expect(Math.abs(pruned.logLik - exact.logLik), `${c.name}: site log-likelihood`).toBeLessThan(1e-9);
      record('mk', c.name, 'logLik-exact', Number(exact.logLik.toPrecision(10)), `rate=${rate.toPrecision(6)}; independent pruner agrees to ${Math.abs(pruned.logLik - exact.logLik).toExponential(2)}`);
    });
  }

  it('matches the exact marginals on the shipped sample projects within budget', () => {
    let done = 0;
    for (const descriptor of SAMPLE_PROJECTS) {
      const project = descriptor.build();
      const flat = flatten(project);
      for (const char of project.characters) {
        if (char.type !== 'discrete' || char.states.length < 2) continue;
        const obs = observations(flat, project, char);
        const rate = appRate(flat);
        const oracle = bruteMk(flat, char.states.length, obs, rate);
        if (oracle === 'over-budget') continue;
        const exact = oracle as BruteMk;
        const app = reconstructMk(project, char, DEFAULT_ASR_OPTIONS);
        expect(app, `${descriptor.id}/${char.name}`).not.toBeNull();
        const result = app as NonNullable<typeof app>;
        expect(flat.substituted, `${descriptor.id}: branch lengths explicit`).toBe(0);
        let worst = 0;
        let argmaxMismatch = 0;
        for (let v = 0; v < flat.ids.length; v += 1) {
          const row = result.probs.get(flat.ids[v]) as number[];
          worst = Math.max(worst, maxAbsDiff(row, exact.probs[v]));
          if (peaksDiffer(row, exact.probs[v])) argmaxMismatch += 1;
        }
        expect(worst, `${descriptor.id}/${char.name}`).toBeLessThan(1e-9);
        expect(argmaxMismatch, `${descriptor.id}/${char.name}`).toBe(0);
        done += 1;
        record(
          'mk',
          `sample:${descriptor.id}`,
          'node-agreement',
          `${flat.ids.length}/${flat.ids.length}`,
          `${char.name}: max |Δp| = ${worst.toExponential(2)}, assignments=${exact.explored}, k=${char.states.length}`,
        );
      }
    }
    expect(done, 'sample characters exactly marginalised').toBeGreaterThanOrEqual(4);
    record('mk', 'samples', 'enumerated-characters', done);
  });

  it('peaks on the planted ancestral state for every node', () => {
    // All tips in state s0: both implementations must put the highest probability
    // on s0 at every node. Note how far that posterior is from 1 — with the
    // scale-free rate r = 1/mean(branch length) a tree whose tips are as long as
    // its internal branches carries k·r·t = 2 expected changes per branch, so
    // even unanimous data leave the root near 0.54. Recorded, not hidden.
    const project = projectFromNewick('((A:0.1,B:0.1)i1:0.1,(C:0.1,D:0.1)i2:0.1)root;', 'planted');
    const char = makeCharacter(2);
    setStates(project, char, { A: 's0', B: 's0', C: 's0', D: 's0' });
    project.characters.push(char);
    const flat = flatten(project);
    const obs = observations(flat, project, char);
    const exact = bruteMk(flat, 2, obs, appRate(flat)) as BruteMk;
    const app = reconstructMk(project, char, DEFAULT_ASR_OPTIONS) as NonNullable<ReturnType<typeof reconstructMk>>;
    for (const v of flat.ids.map((_, i) => i)) {
      const row = app.probs.get(flat.ids[v]) as number[];
      expect(maxAbsDiff(row, exact.probs[v])).toBeLessThan(1e-9);
      expect(argmax(row)).toBe(0);
      expect(row[0]).toBeGreaterThan(0.5);
    }
    record('mk', 'planted-unanimous', 'root-posterior-s0', Number(exact.probs[0][0].toPrecision(8)), `k=2, every branch carries k·r·t = 2 expected changes: the unanimous state wins everywhere but only at ${exact.probs[0][0].toFixed(3)}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TESTS — 1b/2b. randomised agreement (matrices, topologies, missing data)
// ═════════════════════════════════════════════════════════════════════════

describe('randomised instances vs the two parsimony and Mk oracles', () => {
  it('agrees on 40 random matrices (uniform / additive / asymmetric, with ? and - codes)', () => {
    const rnd = lcg(20260921);
    let checked = 0;
    let costAgree = 0;
    let tieAgree = 0;
    let pathOptimal = 0;
    let totalExplored = 0;
    let missingCodes = 0;
    for (let trial = 0; trial < 40; trial += 1) {
      const tips = 3 + (trial % 4); // 3..6 tips
      const labels = Array.from({ length: tips }, (_, i) => `t${i}`);
      const nwk = randomNewick(labels, rnd);
      const k = 2 + (trial % 2);
      let matrix: number[][] | undefined;
      if (trial % 3 === 0) {
        matrix = undefined; // uniform (Fitch)
      } else if (trial % 3 === 1) {
        // random ADDITIVE (= ordered) matrix: distances along a line of k states
        const step = Array.from({ length: k }, () => 1 + Math.floor(rnd() * 4));
        const dist = (i: number, j: number): number => {
          let d = 0;
          for (let x = Math.min(i, j); x < Math.max(i, j); x += 1) d += step[x];
          return d;
        };
        matrix = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => dist(i, j)));
      } else {
        // genuinely asymmetric: neither symmetric nor additive
        matrix = Array.from({ length: k }, (_, i) =>
          Array.from({ length: k }, (_, j) => (i === j ? 0 : 1 + Math.floor(rnd() * 7))),
        );
      }
      const states: Record<string, string> = {};
      for (const l of labels) {
        const roll = rnd();
        if (roll < 0.12 || roll < 0.2) missingCodes += 1;
        states[l] = roll < 0.12 ? '?' : roll < 0.2 ? '-' : `s${Math.floor(rnd() * k)}`;
      }
      const project = projectFromNewick(nwk, `rand-${trial}`);
      const char = makeCharacter(k, matrix);
      setStates(project, char, states);
      project.characters.push(char);
      const flat = flatten(project);
      const obs = observations(flat, project, char);
      const oracle = bruteParsimony(flat, k, obs, matrix);
      if (oracle === 'over-budget') continue;
      const brute: BruteParsimony = oracle;
      const app = parsimony(project, char);
      const indexOf = (id: string | undefined): number => char.states.findIndex((x) => x.id === id);
      checked += 1;
      totalExplored += brute.explored;
      if (app.cost === brute.cost) costAgree += 1;
      expect(app.cost, `trial ${trial} cost`).toBe(brute.cost);
      let tiesOk = true;
      if (!brute.truncated) {
        for (let v = 0; v < flat.ids.length; v += 1) {
          const par = flat.parent[v];
          const want = statesInMinAssignments(
            brute.minAssignments,
            v,
            par,
            par < 0 ? null : indexOf(app.chosen.get(flat.ids[par])),
          );
          const got = [...new Set((app.states.get(flat.ids[v]) ?? []).map(indexOf))].sort((a, b) => a - b);
          if (got.join() !== want.join()) tiesOk = false;
          expect(got.join(), `trial ${trial} node ${flat.label[v]}`).toEqual(want.join());
          expect(got.length, `trial ${trial} node ${flat.label[v]}: a tie set is never empty`).toBeGreaterThan(0);
        }
      }
      // a missing-data code must never come back as a reconstruction state
      for (const id of flat.ids) {
        const chosenId = app.chosen.get(id);
        expect(['?', '-'].includes(chosenId ?? ''), `trial ${trial}: echoed missing code`).toBe(false);
      }
      if (tiesOk) tieAgree += 1;
      const pathCost = assignmentCost(flat, flat.ids.map((id) => indexOf(app.chosen.get(id))), matrix);
      if (pathCost === brute.cost) pathOptimal += 1;
      else suboptimalPathCases += 1;
      expect(pathCost, `trial ${trial}: the reported path can never beat the optimum`).toBeGreaterThanOrEqual(brute.cost);
    }
    expect(checked).toBe(40);
    expect(costAgree).toBe(checked);
    expect(tieAgree).toBe(checked);
    record(
      'sankoff',
      'randomised-40',
      'min-cost-agrees',
      costAgree === checked,
      `${costAgree}/${checked} instances; ${totalExplored} assignments enumerated in total; ${missingCodes} tips coded ? or -`,
    );
    record(
      'sankoff',
      'randomised-40',
      'tie-set-agrees',
      tieAgree === checked,
      `${tieAgree}/${checked} instances where every node tie set equals the brute-force set`,
    );
    record(
      'sankoff',
      'randomised-40',
      'chosen-path-optimal',
      `${pathOptimal}/${checked}`,
      'instances where the single reported path attains the minimum cost',
    );
  });

  it('agrees with exact marginalisation on 20 random Mk instances', () => {
    const rnd = lcg(97531);
    let checked = 0;
    let nodeWorst = 0;
    let nodes = 0;
    let totalExplored = 0;
    let substitutionTrials = 0;
    for (let trial = 0; trial < 20; trial += 1) {
      const tips = 3 + (trial % 3);
      const labels = Array.from({ length: tips }, (_, i) => `t${i}`);
      const k = 2 + (trial % 3);
      // random tip lengths; the auto-labelled internal nodes carry none, so this
      // loop also proves the documented "missing branch length → 1" substitution
      // is applied to the same set of nodes on both sides
      const raw = randomNewick(labels, rnd).replace(/(t\d+)/g, (m) => `${m}:${(0.1 + rnd() * 3).toFixed(3)}`);
      const project = projectFromNewick(`${raw};`, `randMk-${trial}`);
      const char = makeCharacter(k);
      const states: Record<string, string> = {};
      for (const l of labels) states[l] = rnd() < 0.1 ? '?' : `s${Math.floor(rnd() * k)}`;
      setStates(project, char, states);
      project.characters.push(char);
      const flat = flatten(project);
      const obs = observations(flat, project, char);
      const rate = appRate(flat);
      const oracle = bruteMk(flat, k, obs, rate);
      if (oracle === 'over-budget') continue;
      const exact: BruteMk = oracle;
      const app = reconstructMk(project, char, DEFAULT_ASR_OPTIONS);
      expect(app, `trial ${trial}`).not.toBeNull();
      const result = app as NonNullable<typeof app>;
      let localWorst = 0;
      for (let v = 0; v < flat.ids.length; v += 1) {
        const row = result.probs.get(flat.ids[v]) as number[];
        localWorst = Math.max(localWorst, maxAbsDiff(row, exact.probs[v]));
      }
      const warned = result.warnings
        .filter((w) => w.kind === 'unset-branch-length' || w.kind === 'negative-branch-length' || w.kind === 'invalid-branch-length')
        .reduce((a, w) => a + w.count, 0);
      expect(warned, `trial ${trial}: nodes whose branch length was substituted`).toBe(flat.substituted);
      if (flat.substituted > 0) substitutionTrials += 1;
      expect(localWorst, `trial ${trial}: max |Δp|`).toBeLessThan(1e-9);
      const rootRow = result.probs.get(flat.ids[0]) as number[];
      expect(Math.abs(rootRow.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
      checked += 1;
      nodes += flat.ids.length;
      nodeWorst = Math.max(nodeWorst, localWorst);
      totalExplored += exact.explored;
    }
    expect(checked).toBe(20);
    expect(substitutionTrials).toBeGreaterThan(0);
    record(
      'mk',
      'randomised-20',
      'node-agreement',
      `${nodes}/${nodes}`,
      `worst single-node |Δp| over all instances = ${nodeWorst.toExponential(2)}; ${totalExplored} assignments enumerated`,
    );
    record(
      'mk',
      'randomised-20',
      'instances',
      checked,
      `random topologies, k = 2..4, random tip lengths, 10% of tips coded ?; on ${substitutionTrials}/20 trials unset internal lengths were substituted and the warning count matched the node count`,
    );
  });
});

// TESTS — 3. consensus
// ═════════════════════════════════════════════════════════════════════════════

const CONS_SET_A = ['((A,B),(C,D),E);', '((A,B),(C,D),E);', '((A,B),(C,E),D);'];

describe('consensus vs an independent clade-support count', () => {
  it('rootedCladeKeys reproduces the hand-computed clade partition of each tree', () => {
    const specs = ['((A,B),(C,D),E);', '((A,(B,C)),D);', '(A,(B,(C,(D,E))));', CONS_SET_A[2], '((A,B),(A,C));'];
    for (const spec of specs) {
      const project = projectFromNewick(spec, 'consensus-case');
      const tips = tipSetOf(project);
      const appKeys = decodeAppKeys(rootedCladeKeys(project, tips), tips);
      const oracle = oracleCladeKeys(project).keys;
      expect([...appKeys].sort(), spec).toEqual([...oracle].sort());
      const viaLabels = new Set(cladeSetsOf(project).clades.map((c) => [...c].sort().join('+')));
      expect([...viaLabels].sort(), spec).toEqual([...oracle].sort());
      record('consensus', spec, 'clades-agree', true, `n=${oracle.size} [${[...oracle].join(' ')}]`);
    }
  });

  it('cladeSupports equals support counted by hand', () => {
    const projects = CONS_SET_A.map((s, i) => projectFromNewick(s, `t${i}`));
    const tips = tipSetOf(projects[0]);
    const oracle = oracleConsensus(projects, 'strict');
    expect(oracle.reject).toBeNull();
    const app = cladeSupports(projects, tips);
    expect(app.length).toBe(oracle.supports.size);
    for (const rec of app) {
      const key = [...rec.tips].sort().join('+');
      const count = oracle.supports.get(key);
      expect(count, key).toBeDefined();
      expect(rec.count, key).toBe(count as number);
      expect(rec.support, key).toBe(Math.round((100 * (count as number)) / projects.length));
    }
    for (const [key, count] of oracle.supports) {
      record('consensus', `support:${key}`, 'count', count, `${count}/${projects.length} trees`);
    }
  });

  it('strict and majority consensus assemble exactly the selected clade sets', () => {
    for (const method of ['strict', 'majority'] as ConsensusMethod[]) {
      const projects = CONS_SET_A.map((s, i) => projectFromNewick(s, `t${i}`));
      const oracle = oracleConsensus(projects, method);
      expect(oracle.reject).toBeNull();
      const issues: string[][] = [];
      const consensus = buildConsensusTree(projects, method, `consensus-${method}`, (i) => issues.push(i));
      expect(consensus, method).not.toBeNull();
      const tree = consensus as Project;
      const produced = oracleCladeKeys(tree);
      expect([...produced.keys].sort(), `${method} clade set`).toEqual([...oracle.selected.keys()].sort());
      for (const [nodeId, key] of produced.byNode) {
        expect(oracle.selected.has(key), `phantom clade ${key}`).toBe(true);
        expect(tree.nodes[nodeId].support, key).toBe(
          Math.round((100 * (oracle.selected.get(key) as number)) / projects.length),
        );
      }
      expect(issues.length, method).toBe(0);
      record('consensus', `${method}:3trees`, 'selected-clades', oracle.selected.size, [...oracle.selected.keys()].join(' | '));
      record('consensus', `${method}:3trees`, 'output-equals-selection', produced.keys.size === oracle.selected.size);
    }
    const strict = oracleConsensus(CONS_SET_A.map((s, i) => projectFromNewick(s, `t${i}`)), 'strict');
    const majority = oracleConsensus(CONS_SET_A.map((s, i) => projectFromNewick(s, `t${i}`)), 'majority');
    expect(majority.selected.size).toBeGreaterThan(strict.selected.size);
    record('consensus', 'strict-vs-majority', 'extra-clades-in-majority', majority.selected.size - strict.selected.size);
  });

  it('a single tree is its own consensus (identity property, fixed and random)', () => {
    let checked = 0;
    const rnd = lcg(20260921);
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    for (const spec of ['((A,(B,C)),D);', '(A,(B,(C,(D,E))));', '((A,B),(C,(D,(E,F))));']) {
      for (const method of ['strict', 'majority'] as ConsensusMethod[]) {
        const project = projectFromNewick(spec, 'single');
        const oracle = oracleCladeKeys(project).keys;
        const consensus = buildConsensusTree([project], method, 'c') as Project;
        expect([...oracleCladeKeys(consensus).keys].sort(), `${spec} ${method}`).toEqual([...oracle].sort());
        checked += 1;
      }
    }
    for (let trial = 0; trial < 15; trial += 1) {
      const project = projectFromNewick(randomNewick(labels, rnd), 'random-single');
      const oracle = oracleCladeKeys(project).keys;
      for (const method of ['strict', 'majority'] as ConsensusMethod[]) {
        const consensus = buildConsensusTree([project], method, 'c') as Project;
        expect([...oracleCladeKeys(consensus).keys].sort(), `trial ${trial} ${method}`).toEqual([...oracle].sort());
        expect(Object.values(consensus.nodes).filter((n) => n.childrenIds.length === 0).length).toBe(
          Object.values(project.nodes).filter((n) => n.childrenIds.length === 0).length,
        );
        checked += 1;
      }
    }
    record('consensus', 'single-tree-identity', 'trees-checked', checked, 'strict + majority, fixed and random');
  });

  it('never invents or loses a clade over random tree sets', () => {
    const rnd = lcg(987654);
    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
    let instances = 0;
    let cladesChecked = 0;
    for (let trial = 0; trial < 12; trial += 1) {
      const count = 2 + Math.floor(rnd() * 4);
      const projects = Array.from({ length: count }, () => projectFromNewick(randomNewick(labels, rnd), 'r'));
      for (const method of ['strict', 'majority'] as ConsensusMethod[]) {
        const oracle = oracleConsensus(projects, method);
        expect(oracle.reject).toBeNull();
        const consensus = buildConsensusTree(projects, method, 'c') as Project;
        const produced = oracleCladeKeys(consensus).keys;
        expect([...produced].sort(), `trial ${trial} ${method}`).toEqual([...oracle.selected.keys()].sort());
        const union = new Set<string>();
        for (const p of projects) for (const k of oracleCladeKeys(p).keys) union.add(k);
        for (const k of produced) {
          expect(union.has(k), `phantom clade ${k}`).toBe(true);
          cladesChecked += 1;
        }
        expect(tipSetOf(consensus)).toEqual(labels.slice().sort());
        instances += 1;
      }
    }
    // correlated sets: three tip pairs are clades of every tree, so both the
    // strict and the majority consensus are non-trivial and really compared
    // three tip pairs that every tree in the set must contain as a clade
    const pairs = [['A', 'B'], ['C', 'D'], ['E', 'F']];
    let correlated = 0;
    let correlatedClades = 0;
    for (let trial = 0; trial < 10; trial += 1) {
      const count = 2 + Math.floor(rnd() * 4);
      const projects = Array.from({ length: count }, () =>
        projectFromNewick(randomNewickWithBlocks(pairs, rnd), 'rc'),
      );
      for (const method of ['strict', 'majority'] as ConsensusMethod[]) {
        const oracle = oracleConsensus(projects, method);
        expect(oracle.reject).toBeNull();
        const consensus = buildConsensusTree(projects, method, 'c') as Project;
        const produced = oracleCladeKeys(consensus).keys;
        expect([...produced].sort(), `correlated ${trial} ${method}`).toEqual([...oracle.selected.keys()].sort());
        const union = new Set<string>();
        for (const ps of projects) for (const k of oracleCladeKeys(ps).keys) union.add(k);
        for (const k of produced) expect(union.has(k), `phantom clade ${k}`).toBe(true);
        correlated += 1;
        correlatedClades += produced.size;
        expect(produced.size).toBeGreaterThan(0); // the three pairs guarantee real content
      }
    }
    expect(instances).toBeGreaterThanOrEqual(24);
    record(
      'consensus',
      'random-sets',
      'consensus-trees',
      instances,
      `${cladesChecked} output clades verified against the input union (independent random trees)`,
    );
    record(
      'consensus',
      'correlated-sets',
      'consensus-trees',
      correlated,
      `${correlatedClades} non-trivial clades checked; every tree shares the pairs A+B, C+D, E+F`,
    );
  });

  it('rejects mixed tip sets, unnamed and duplicated tips, like the oracle does', () => {
    const cases: Array<{ name: string; specs: string[] }> = [
      { name: 'missing-tip', specs: ['((A,B),(C,D));', '((A,B),(C,E));'] },
      { name: 'extra-tip', specs: ['((A,B),C);', '((A,B),(C,D));'] },
      { name: 'duplicate-label', specs: ['((A,A),B);', '((A,B),B);'] },
      { name: 'three-trees-one-odd', specs: ['((A,B),(C,D));', '((A,B),(C,D));', '((A,B),(C,E));'] },
      { name: 'all-compatible', specs: ['((A,B),(C,D));', '((C,D),(B,A));'] },
    ];
    for (const c of cases) {
      const projects = c.specs.map((s, i) => projectFromNewick(s, `t${i}`));
      const oracle = oracleConsensus(projects, 'strict');
      const issues: string[][] = [];
      const built = buildConsensusTree(projects, 'strict', 'x', (i) => issues.push(i));
      const check = checkConsensusInputs(projects);
      if (oracle.reject) {
        expect(built, c.name).toBeNull();
        expect(check.ok, c.name).toBe(false);
        expect(issues.length, c.name).toBeGreaterThan(0);
      } else {
        expect(built, c.name).not.toBeNull();
        expect(check.ok, c.name).toBe(true);
      }
      expect(built === null).toBe(oracle.reject !== null);
      record('consensus', c.name, 'rejection-agrees', true, oracle.reject ?? 'accepted');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TESTS — 4. DTL reconciliation
// ═════════════════════════════════════════════════════════════════════════════

interface DtlCase {
  name: string;
  species: string;
  gene: string;
  /** gene tip label → species tip label */
  map: Record<string, string>;
  costs: ReconCosts;
  rootFee?: number;
}

const DTL_CASES: DtlCase[] = [
  {
    name: 'mirror-no-events',
    species: '(A,B)root;',
    gene: '(A,B)g;',
    map: { A: 'A', B: 'B' },
    costs: { dup: 1, transfer: 2, loss: 1 },
  },
  {
    name: 'one-duplication',
    species: '((A,B),C)root;',
    gene: '((gA1,gA2)i,gB)g;',
    map: { gA1: 'A', gA2: 'A', gB: 'B' },
    costs: { dup: 1, transfer: 2, loss: 1 },
  },
  {
    name: 'topology-mismatch-needs-loss',
    species: '((A,B),(C,D))root;',
    gene: '(((gA,gC)i1,gB)i2,gD)g;',
    map: { gA: 'A', gB: 'B', gC: 'C', gD: 'D' },
    costs: { dup: 1, transfer: 2, loss: 1 },
  },
  {
    name: 'cheap-transfer-wins',
    species: '((A,B),(C,D))root;',
    gene: '(((gA,gC)i1,gB)i2,gD)g;',
    map: { gA: 'A', gB: 'B', gC: 'C', gD: 'D' },
    costs: { dup: 5, transfer: 1, loss: 3 },
  },
  {
    name: 'asymmetric-costs',
    species: '(((A,B),C),D)root;',
    gene: '(((gA,gD)i1,gB)i2,gC)g;',
    map: { gA: 'A', gB: 'B', gC: 'C', gD: 'D' },
    costs: { dup: 2, transfer: 1, loss: 4 },
  },
  {
    name: 'trifurcate-species-tree',
    species: '(A,B,C)root;',
    gene: '((gA,gB)ab,gC)g;',
    map: { gA: 'A', gB: 'B', gC: 'C' },
    costs: { dup: 4, transfer: 1, loss: 2 },
  },
  {
    name: 'loss-cheap-transfer-expensive',
    species: '((A,B),(C,D))root;',
    gene: '((gA,gC)ac,(gB,gD)bd)g;',
    map: { gA: 'A', gB: 'B', gC: 'C', gD: 'D' },
    costs: { dup: 3, transfer: 9, loss: 1 },
  },
  {
    name: 'five-species-two-duplications',
    species: '(((A,B),(C,D)),E)root;',
    gene: '(((gA,gA2)aa,(gC,gD)cd)acd,gE)g;',
    map: { gA: 'A', gA2: 'A', gC: 'C', gD: 'D', gE: 'E' },
    costs: { dup: 2, transfer: 3, loss: 1 },
  },
  {
    name: 'gene-covers-all-four-species',
    species: '((A,B),(C,D))root;',
    gene: '((gA,gB)ab,(gC,gD)cd)g;',
    map: { gA: 'A', gB: 'B', gC: 'C', gD: 'D' },
    costs: { dup: 1, transfer: 1, loss: 1 },
  },
  {
    name: 'unbalanced-pectinate-gene',
    species: '(((A,B),C),D)root;',
    gene: '(((gA,gB)i1,gC)i2,gD)g;',
    map: { gA: 'A', gB: 'B', gC: 'C', gD: 'D' },
    costs: { dup: 1, transfer: 4, loss: 2 },
  },
];

function runDtlCase(c: DtlCase) {
  const speciesProject = projectFromNewick(c.species, `${c.name}-species`);
  const geneProject = projectFromNewick(c.gene, `${c.name}-gene`);
  const species = speciesTree(speciesProject);
  const gene = geneTree(geneProject, c.map, species);
  const tipOverride: Record<NodeId, NodeId> = {};
  gene.flat.ids.forEach((id, i) => {
    if (!gene.flat.isTip[i]) return;
    const targets = gene.allowed[i];
    if (targets.length !== 1) throw new Error(`${c.name}: gene tip ${gene.flat.label[i]} is unmapped`);
    tipOverride[id] = species.flat.ids[targets[0]];
  });
  const dp = solveDtl(speciesProject, geneProject, c.costs, tipOverride, {
    rootTransferCost: c.rootFee ?? 0,
  });
  const brute = bruteDtl(species, gene, c.costs, c.rootFee ?? 0);
  return { dp, brute, species, gene, speciesProject, geneProject };
}

describe('DTL reconciliation vs exhaustive placement enumeration', () => {
  for (const c of DTL_CASES) {
    it(`finds the same optimum as brute force on ${c.name}`, () => {
      const { dp, brute, species, gene } = runDtlCase(c);
      expect(dp.error, c.name).toBeUndefined();
      expect(brute, c.name).not.toBe('over-budget');
      const bf = brute as BruteDtl;
      const scenario = dp.scenario as NonNullable<typeof dp.scenario>;
      expect(scenario.cost, `${c.name}: DP ${scenario.cost} vs brute ${bf.cost}`).toBe(bf.cost);

      // the traced scenario, re-priced independently, must be that optimum too
      const audit = priceTracedScenario(species, gene, c.costs, scenario.placements, scenario.events, scenario.rootFees);
      expect(audit.infeasible, `${c.name}: traced placements/events infeasible`).toEqual([]);
      expect(audit.cost, `${c.name}: re-priced traced scenario`).toBe(scenario.cost);
      expect(audit.nonCheapest, `${c.name}: a declared event is not the cheapest feasible one`).toEqual([]);

      const eventCounts = Object.values(scenario.events).reduce<Record<string, number>>((acc, e) => {
        acc[e] = (acc[e] ?? 0) + 1;
        return acc;
      }, {});
      record(
        'dtl',
        c.name,
        'optimum-agrees',
        scenario.cost === bf.cost,
        `dp=${scenario.cost} brute=${bf.cost} structures=${bf.structures} costs=${JSON.stringify(c.costs)}`,
      );
      record(
        'dtl',
        c.name,
        'traced-scenario-cost',
        audit.cost,
        `events=${JSON.stringify(eventCounts)} losses dp=${scenario.totalLosses} brute=${bf.bestLosses} re-priced-losses=${audit.losses}`,
      );
    });
  }

  it('agrees with brute force on randomised small instances', () => {
    const rnd = lcg(24680);
    const taxa = ['A', 'B', 'C', 'D'];
    const costPool: ReconCosts[] = [
      { dup: 1, transfer: 2, loss: 1 },
      { dup: 2, transfer: 1, loss: 3 },
      { dup: 1, transfer: 5, loss: 1 },
      { dup: 3, transfer: 2, loss: 1 },
      { dup: 1, transfer: 1, loss: 2 },
    ];
    let instances = 0;
    let agreed = 0;
    let withTransfer = 0;
    let withDuplication = 0;
    let withLoss = 0;
    for (let trial = 0; trial < 40; trial += 1) {
      const spTaxa = taxa.slice(0, 3 + (trial % 2));
      const speciesNwk = randomNewick(spTaxa, rnd);
      const map: Record<string, string> = {};
      const geneLabels: string[] = [];
      const used = 2 + Math.floor(rnd() * 3);
      for (let t = 0; t < used; t += 1) {
        const label = `g${t}`;
        geneLabels.push(label);
        map[label] = spTaxa[Math.floor(rnd() * spTaxa.length)];
      }
      const c: DtlCase = {
        name: `random-${trial}`,
        species: speciesNwk,
        gene: randomNewick(geneLabels, rnd),
        map,
        costs: costPool[trial % costPool.length],
      };
      const { dp, brute, species, gene } = runDtlCase(c);
      if (dp.error || brute === 'over-budget') continue;
      const bf = brute as BruteDtl;
      const scenario = dp.scenario as NonNullable<typeof dp.scenario>;
      instances += 1;
      expect(scenario.cost, `${c.name}: dp=${scenario.cost} brute=${bf.cost}`).toBe(bf.cost);
      if (scenario.cost === bf.cost) agreed += 1;
      const audit = priceTracedScenario(species, gene, c.costs, scenario.placements, scenario.events, scenario.rootFees);
      expect(audit.infeasible, c.name).toEqual([]);
      expect(audit.cost, c.name).toBe(scenario.cost);
      if (Object.values(scenario.events).includes('transfer')) withTransfer += 1;
      if (Object.values(scenario.events).includes('duplication')) withDuplication += 1;
      if (scenario.totalLosses > 0) withLoss += 1;
    }
    expect(instances).toBeGreaterThanOrEqual(25);
    expect(agreed).toBe(instances);
    record('dtl', 'randomised', 'instances', instances, `${agreed}/${instances} exact optima, all traced scenarios re-priced to the same cost`);
    record('dtl', 'randomised', 'instances-with-transfer', withTransfer);
    record('dtl', 'randomised', 'instances-with-duplication', withDuplication);
    record('dtl', 'randomised', 'instances-with-loss', withLoss);
  });

  it('reports the gene-root fee the same way the enumeration does (rootTransferCost)', () => {
    // The solver's `rootTransferCost` prices "the family arrived here". The
    // exhaustive enumeration charges it for any placement away from the species
    // root and then takes the minimum, so it is a lower bound on what a correct
    // DP must report. Recorded, not fudged: both numbers go into the evidence log.
    const fee = 5;
    const cases: DtlCase[] = [
      {
        name: 'root-fee-a',
        species: '(((A,B),C),D)root;',
        gene: '((gA,gB)ab,gC)g;',
        map: { gA: 'A', gB: 'B', gC: 'C' },
        costs: { dup: 1, transfer: 1, loss: 1 },
        rootFee: fee,
      },
      {
        name: 'root-fee-b',
        species: '((A,B),(C,D))root;',
        gene: '(((gA,gB)ab,(gC,gD)cd)acd)g;',
        map: { gA: 'A', gB: 'B', gC: 'C', gD: 'D' },
        costs: { dup: 2, transfer: 1, loss: 3 },
        rootFee: fee,
      },
    ];
    for (const c of cases) {
      const { dp, brute } = runDtlCase(c);
      expect(dp.error, c.name).toBeUndefined();
      const scenario = dp.scenario as NonNullable<typeof dp.scenario>;
      const bf = brute as BruteDtl;
      record('dtl', c.name, 'root-fee-dp-cost', scenario.cost, `rootTransferCost=${fee}, freeRoot=${scenario.freeRoot}`);
      record('dtl', c.name, 'root-fee-brute-cost', bf.cost, 'enumeration minimises over fee-inclusive placements');
      expect(bf.cost).toBeLessThanOrEqual(scenario.cost);
    }
  });

  it('documents the two dtl.ts deviations this oracle pins as tripwires', () => {
    // (1) `rootTransferCost` is ADDED to the free-root cost instead of the solver
    //     re-comparing "gene root on the species root" against "gene root
    //     elsewhere + fee", so the reported optimum can be worse than a scenario
    //     the solver itself owns.
    const feeCase: DtlCase = {
      name: 'root-fee-tripwire',
      species: '(((A,B),C),D)root;',
      gene: '((gA,gB)ab,gC)g;',
      map: { gA: 'A', gB: 'B', gC: 'C' },
      costs: { dup: 1, transfer: 1, loss: 1 },
      rootFee: 5,
    };
    const fee = runDtlCase(feeCase);
    expect(fee.dp.error).toBeUndefined();
    const feeScenario = fee.dp.scenario as NonNullable<typeof fee.dp.scenario>;
    const feeBrute = fee.brute as BruteDtl;
    expect(feeBrute.cost).toBe(1);
    expect(feeScenario.cost).toBe(5);
    record(
      'dtl',
      'deviation:root-fee',
      'dp-minus-enumeration',
      feeScenario.cost - feeBrute.cost,
      'rootTransferCost=5: the solver reports 5, the fee-aware enumeration reports 1 for the same pair of trees',
    );

    // (2) When a loss is cheaper than a duplication the traced scenario deletes a
    //     whole sampled lineage: the two gene copies mapped onto species A get
    //     neither a placement nor a loss mark naming them, so the document handed
    //     back holds a subset of the gene nodes — while `cost` stays optimal.
    //     Standard DTL solvers (RIANA / Treerecon / CaSpec family) forbid losing a
    //     lineage ancestral to sampled genes; this model does not, which is a
    //     fourth reason its absolute totals read low (dtl.ts lists three others).
    const traceCase: DtlCase = {
      name: 'sampled-lineage-deleted',
      species: '((A,B),C)root;',
      gene: '((gA1,gA2)i,gB)g;',
      map: { gA1: 'A', gA2: 'A', gB: 'B' },
      costs: { dup: 3, transfer: 9, loss: 1 },
    };
    const traced = runDtlCase(traceCase);
    expect(traced.dp.error).toBeUndefined();
    const scenario = traced.dp.scenario as NonNullable<typeof traced.dp.scenario>;
    const bf = traced.brute as BruteDtl;
    expect(scenario.cost).toBe(bf.cost); // the OPTIMUM still agrees: 1 loss vs 1 loss
    const placed = new Set(Object.keys(scenario.placements));
    const marked = new Set(scenario.lossMarks.map((m) => m.geneNode));
    const unaccounted = traced.gene.flat.ids.filter((id) => !placed.has(id) && !marked.has(id));
    const assumptions = dtlScenarioToAssumptions(traced.speciesProject, traced.geneProject, scenario);
    expect(Object.keys(assumptions).length).toBeLessThan(traced.gene.flat.ids.length);
    record(
      'dtl',
      'deviation:sampled-lineage-deleted',
      'gene-nodes-written-vs-total',
      `${Object.keys(assumptions).length}/${traced.gene.flat.ids.length}`,
      `cost ${scenario.cost} agrees with the enumeration; ${unaccounted.length} sampled gene tips carry neither a placement nor a loss mark`,
    );
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// TESTS — 5. r-choice sensitivity on the shipped sample projects
// ═════════════════════════════════════════════════════════════════════════════

describe('Mk posteriors at r = 1/mean(branch length) vs an ML-estimated r', () => {
  it('recomputes every sample project at both rates and quantifies the shift', () => {
    let characters = 0;
    let sensitive = 0;
    let totalShiftingNodes = 0;
    let largestShift = 0;
    for (const descriptor of SAMPLE_PROJECTS) {
      const project = descriptor.build();
      const flat = flatten(project);
      for (const char of project.characters) {
        if (char.type !== 'discrete' || char.states.length < 2) continue;
        const k = char.states.length;
        const obs = observations(flat, project, char);
        const rMean = appRate(flat);
        const atMean = pruneMk(flat, k, obs, rMean);
        const app = reconstructMk(project, char, DEFAULT_ASR_OPTIONS) as NonNullable<
          ReturnType<typeof reconstructMk>
        >;
        expect(flat.substituted, `${descriptor.id}: branch lengths explicit`).toBe(0);
        let appVsPruner = 0;
        flat.ids.forEach((id, v) => {
          appVsPruner = Math.max(appVsPruner, maxAbsDiff(app.probs.get(id) as number[], atMean.probs[v]));
        });
        // The pruner reproduces the app exactly at the app's own rate, so any
        // difference measured below is attributable to the rate, not the code.
        expect(appVsPruner, `${descriptor.id}/${char.name}`).toBeLessThan(1e-9);

        const ml = mlRate(flat, k, obs);
        const atMl = pruneMk(flat, k, obs, ml.rate);
        expect(ml.logLik).toBeGreaterThanOrEqual(atMean.logLik - 1e-9);
        let changed = 0;
        let maxShift = 0;
        let sumShift = 0;
        let changedStrict = 0;
        flat.ids.forEach((_, v) => {
          if (argmax(atMean.probs[v]) !== argmax(atMl.probs[v])) changedStrict += 1;
          if (peaksDiffer(atMean.probs[v], atMl.probs[v])) changed += 1;
          maxShift = Math.max(maxShift, maxAbsDiff(atMean.probs[v], atMl.probs[v]));
          sumShift += atMean.probs[v].reduce((a, x, i) => a + Math.abs(x - atMl.probs[v][i]), 0) / k;
        });
        characters += 1;
        if (maxShift > 0.05) sensitive += 1;
        totalShiftingNodes += changed;
        largestShift = Math.max(largestShift, maxShift);
        record(
          'r-sensitivity',
          `${descriptor.id}/${char.name}`,
          'nodes-changing-marginal-state',
          changed,
          `of ${flat.ids.length} nodes (ties not counted; ${changedStrict} with strict argmax comparison); max |Δp| = ${maxShift.toPrecision(4)}; mean |Δp| = ${(sumShift / flat.ids.length).toPrecision(4)}`,
        );
        record(
          'r-sensitivity',
          `${descriptor.id}/${char.name}`,
          'rate-1-over-mean → ML',
          `${rMean.toPrecision(4)} → ${ml.rate.toPrecision(4)}`,
          `logLik ${atMean.logLik.toPrecision(9)} → ${ml.logLik.toPrecision(9)} (Δ = ${(ml.logLik - atMean.logLik).toPrecision(3)})`,
        );
      }
    }
    expect(characters).toBeGreaterThanOrEqual(11);
    expect(sensitive, 'at least one sample character must be sensitive to the rate choice').toBeGreaterThan(0);
    record('r-sensitivity', 'summary', 'characters-analysed', characters);
    record('r-sensitivity', 'summary', 'characters-with-max-shift-above-0.05', sensitive);
    record('r-sensitivity', 'summary', 'largest-max-shift', Number(largestShift.toPrecision(4)));
    record('r-sensitivity', 'summary', 'total-nodes-changing-marginal-state', totalShiftingNodes);
  });

  it('cross-checks the ML-rate posteriors of the cetacean sample against exact marginalisation', () => {
    const descriptor = SAMPLE_PROJECTS.find((s) => s.id === 'cetacean') as (typeof SAMPLE_PROJECTS)[number];
    const sample = descriptor.build();
    const flat = flatten(sample);
    const char = sample.characters[0];
    const k = char.states.length;
    const obs = observations(flat, sample, char);
    const ml = mlRate(flat, k, obs);
    const exact = bruteMk(flat, k, obs, ml.rate);
    expect(exact).not.toBe('over-budget');
    const bf = exact as BruteMk;
    const pruned = pruneMk(flat, k, obs, ml.rate);
    let worst = 0;
    flat.ids.forEach((_, v) => {
      worst = Math.max(worst, maxAbsDiff(pruned.probs[v], bf.probs[v]));
    });
    expect(worst).toBeLessThan(1e-9);

    // and what the app itself reports (at r = 1/mean) differs from that optimum
    const app = reconstructMk(sample, char, DEFAULT_ASR_OPTIONS) as NonNullable<ReturnType<typeof reconstructMk>>;
    let appChanges = 0;
    let appShift = 0;
    flat.ids.forEach((id, v) => {
      const p = app.probs.get(id) as number[];
      if (peaksDiffer(p, bf.probs[v])) appChanges += 1;
      appShift = Math.max(appShift, maxAbsDiff(p, bf.probs[v]));
    });
    record('r-sensitivity', 'cetacean/habitat-at-ML-rate', 'ml-pruner-vs-exact', worst < 1e-9 ? 'exact' : 'OFF', `r_ML = ${ml.rate.toPrecision(4)}, assignments = ${bf.explored}`);
    record('r-sensitivity', 'cetacean/habitat-at-ML-rate', 'app-at-1-over-mean-vs-ML-exact', appChanges, `nodes changing marginal state; max |Δp| = ${appShift.toPrecision(4)}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TESTS — 6. the no-silent-skip guard
// ═════════════════════════════════════════════════════════════════════════════

describe('guard: no oracle may be skipped silently', () => {
  it('every leg produced measured evidence, and agreement was actually achieved', () => {
    const counts = new Map<Leg, number>();
    for (const row of evidence) counts.set(row.leg, (counts.get(row.leg) ?? 0) + 1);
    for (const row of evidence) {
      // eslint-disable-next-line no-console
      console.log(
        `EVIDENCE|leg=${row.leg}|case=${row.case}|metric=${row.metric}|value=${row.value}${row.detail ? `|${row.detail}` : ''}`,
      );
    }
    const missing: string[] = [];
    for (const [leg, min] of REQUIRED) {
      const have = counts.get(leg) ?? 0;
      if (have < min) missing.push(`${leg}: ${have} rows, needs ${min}`);
    }
    expect(missing, `oracle legs with too little evidence (skipped?): ${missing.join('; ')}`).toEqual([]);

    const agreement = (leg: Leg, metric: string): Array<Evidence> =>
      evidence.filter((e) => e.leg === leg && e.metric === metric);
    const sankoff = agreement('sankoff', 'min-cost-agrees');
    expect(sankoff.length).toBeGreaterThanOrEqual(12);
    expect(sankoff.filter((e) => e.value === true).length).toBe(sankoff.length);
    const mk = agreement('mk', 'node-agreement');
    expect(mk.length).toBeGreaterThanOrEqual(8);
    expect(mk.every((e) => typeof e.value === 'string' && e.value.split('/')[0] === e.value.split('/')[1])).toBe(true);
    const dtl = agreement('dtl', 'optimum-agrees');
    expect(dtl.length).toBeGreaterThanOrEqual(10);
    expect(dtl.filter((e) => e.value === true).length).toBe(dtl.length);
    const consensus = agreement('consensus', 'clades-agree').length + agreement('consensus', 'rejection-agrees').length;
    expect(consensus).toBeGreaterThanOrEqual(6);
    expect(evidence.filter((e) => e.value === 'SKIPPED').length).toBe(0);
    // no case anywhere in this file produced a reported reconstruction whose own
    // step total exceeded the true minimum
    expect(suboptimalPathCases, 'Sankoff cases whose reported path is not most parsimonious').toBe(0);
    // the coverage claims themselves must be present, so a leg cannot quietly
    // stop enumerating the sample projects and still call itself green
    expect(evidence.filter((e) => e.metric === 'enumerated-characters').length).toBe(2);
    for (const row of evidence.filter((e) => e.metric === 'enumerated-characters')) {
      expect(Number(row.value)).toBeGreaterThanOrEqual(8);
    }
  });
});
