// scripts/bench_tips.mjs — scalability / interactivity benchmark for CladeForge.
//
// Times the pure-computation operations that dominate interaction latency, so the
// application's behaviour on trees of 100 to 10 000 tips can be re-measured from
// source.
//
// It generates random BALANCED and PECTINATE (comb-like) Newick trees at
// 100 / 250 / 500 / 1 000 / 2 000 / 4 000 / 10 000 tips — both shapes run the full
// range, since a comb is the worst case for the recursive passes — and times, in a
// headless Node process:
//
//   (a) parseNewick        — src/io/newick.ts        (file open / import)
//   (b) computeLayout      — src/layout/autoLayout.ts (every reflow)
//   (c) parsimony          — src/model/parsimony.ts   (Sankoff, k=3)
//   (d) reconstructMk      — src/model/asr.ts         (Mk ASR, k=3)
//   (e) checkConsistency   — src/model/consistency.ts (hypothesis check)
//   (f) buildSVG           — src/io/exportImage.ts    (scene-string build)
//
// The real modules are imported (no re-implementations). This file is plain
// ESM and is executed through vite-node so the TypeScript sources are
// transpiled on the fly by the project's own Vite pipeline:
//
//   npx vite-node scripts/bench_tips.mjs
//
// Optional env knobs: BENCH_REPS (base repetition count), BENCH_SIZES
// (comma-separated tip counts).

import os from 'node:os';

import { parseNewick } from '../src/io/newick.ts';
import { computeLayout } from '../src/layout/autoLayout.ts';
import { parsimony } from '../src/model/parsimony.ts';
import { reconstructMk } from '../src/model/asr.ts';
import { checkConsistency } from '../src/model/consistency.ts';
import { buildSVG } from '../src/io/exportImage.ts';

// ───────────────────────────── deterministic RNG ────────────────────────────

/** mulberry32 — small, fast, reproducible from an integer seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────────── tree generation ──────────────────────────────

/** Add a random branch length to a Newick fragment. */
function bl(rnd) {
  return `:${(0.02 + rnd() * 0.45).toFixed(4)}`;
}

function balancedFragment(labels, rnd, lo, hi) {
  const n = hi - lo;
  if (n === 1) return labels[lo] + bl(rnd);
  const mid = lo + Math.ceil(n / 2);
  const a = balancedFragment(labels, rnd, lo, mid);
  const b = balancedFragment(labels, rnd, mid, hi);
  return `(${a},${b})${bl(rnd)}`;
}

/** Perfectly balanced binary Newick: every split halves the taxon list. */
function balancedNewick(n, rnd) {
  const labels = Array.from({ length: n }, (_, i) => `Taxon_${i + 1}`);
  return `${balancedFragment(labels, rnd, 0, n)};`;
}

/** Comb / pectinate Newick: (((t1,t2),t3),t4)…  — worst case for recursion. */
function pectinateNewick(n, rnd) {
  const labels = Array.from({ length: n }, (_, i) => `Taxon_${i + 1}`);
  const parts = [`(${labels[0]}${bl(rnd)},${labels[1]}${bl(rnd)})${bl(rnd)}`];
  for (let i = 2; i < n; i += 1) {
    parts.push(`(${parts.pop()},${labels[i]}${bl(rnd)})${bl(rnd)}`);
  }
  return `${parts[0]};`;
}

// ─────────────────────── k=3 discrete character ─────────────────────────────

/**
 * Attach a 3-state discrete character with randomly assigned tip states
 * (roughly balanced, some missing data as in a real matrix).
 */
function attachCharacter(project, rnd) {
  const character = {
    id: 'benchK3',
    name: 'Bench character',
    type: 'discrete',
    states: [
      { id: 'k0', label: 'State 0', color: '#ef4444' },
      { id: 'k1', label: 'State 1', color: '#22c55e' },
      { id: 'k2', label: 'State 2', color: '#3b82f6' },
    ],
  };
  project.characters.push(character);
  let tips = 0;
  let assigned = 0;
  for (const node of Object.values(project.nodes)) {
    if (node.childrenIds.length > 0) continue;
    tips += 1;
    if (rnd() < 0.05) continue; // ~5 % missing data, as in a real matrix
    node.charStates = { [character.id]: `k${Math.floor(rnd() * 3)}` };
    assigned += 1;
  }
  return { character, tips, assigned };
}

// ───────────────────────────── timing harness ───────────────────────────────

function timeReps(fn, reps) {
  const samples = [];
  let last = 0;
  for (let r = 0; r < reps; r += 1) {
    const t0 = process.hrtime.bigint();
    last = fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  samples.sort((x, y) => x - y);
  return {
    median: median(samples),
    min: samples[0],
    max: samples[samples.length - 1],
    last,
  };
}

/**
 * Even counts take the mean of the two central samples. Taking `samples[n/2]`
 * alone would bias every median upward by half a rank — not a large error in one
 * number, but a systematic one across a table.
 */
function median(sorted) {
  const n = sorted.length;
  if (!n) return Number.NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One timed batch: a discarded warm-up call, then `reps` repetitions, and the
 * median of those.
 *
 * Measuring every case from a single position in the process lets whichever shape
 * runs FIRST pay for tiering the shared code and look slower; running the shapes in
 * the opposite order swaps the balanced/pectinate numbers wholesale, so a shape
 * contrast measured that way is an artefact of order rather than a property of the
 * trees. The driver below interleaves instead: each round visits every shape at
 * every size, and the reported figure is the median of the per-round medians, so no
 * case keeps a first-run penalty.
 */
const RUNS = Math.max(1, Number(process.env.BENCH_RUNS) || 4);

function timeOp(fn, reps) {
  fn(); // warm-up, so the timed loop is not dominated by first-call JIT tiering
  return timeReps(fn, reps);
}

function fmt(ms) {
  if (!Number.isFinite(ms)) return '—';
  return ms >= 100 ? ms.toFixed(0) : ms.toFixed(1);
}

// ─────────────────────────────── one case ───────────────────────────────────

const SIZES = (process.env.BENCH_SIZES || '100,250,500,1000,2000,4000,10000')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 1);
const BASE_REPS = Number(process.env.BENCH_REPS || 20);

function repsFor(n) {
  // Keep the whole run to a sane wall-clock: fewer reps on bigger trees.
  return Math.max(5, Math.round(BASE_REPS / Math.max(1, n / 250)));
}

const results = [];
const notes = [];

/**
 * Per-cell samples across interleaved rounds: key `shape|n|op` → medians.
 * `results` keeps the last round's row for the sanity/diagnostic section; the
 * published table is built from this map so the value is a median over rounds in
 * which every shape held every position once.
 */
const CELLS = new Map();
function record(row) {
  for (const [op, t] of Object.entries(row.ops)) {
    if (!t || !Number.isFinite(t.median)) continue;
    const key = `${row.shape}|${row.n}|${op}`;
    if (!CELLS.has(key)) CELLS.set(key, []);
    CELLS.get(key).push(t.median);
  }
}
function cellMedian(shape, n, op) {
  const list = CELLS.get(`${shape}|${n}|${op}`);
  if (!list || !list.length) return Number.NaN;
  return median([...list].sort((x, y) => x - y));
}
function cellRounds(shape, n, op) {
  return CELLS.get(`${shape}|${n}|${op}`)?.length ?? 0;
}

function runCase(shape, n) {
  const rnd = mulberry32(0xc1a7 + n * 7919 + (shape === 'balanced' ? 1 : 2));
  const newick = shape === 'balanced' ? balancedNewick(n, rnd) : pectinateNewick(n, rnd);
  const row = { shape, n, newickKB: (newick.length / 1024).toFixed(1), ops: {}, ok: true };

  // (a) Newick parse.
  let project;
  try {
    const t = timeOp(() => Object.keys(parseNewick(newick, 'Bench').nodes).length, repsFor(n));
    // The timed repetitions are discarded (identical work); keep one canonical
    // instance for the downstream operations.
    project = parseNewick(newick, 'Bench');
    const nodeCount = Object.keys(project.nodes).length;
    row.parsedNodes = nodeCount;
    if (nodeCount !== 2 * n - 1) {
      notes.push(`${shape}/${n}: parse produced ${nodeCount} nodes, expected ${2 * n - 1}`);
    }
    row.ops['a_parse'] = t;
  } catch (err) {
    row.ok = false;
    row.ops['a_parse'] = null;
    notes.push(`${shape}/${n}: (a) Newick parse FAILED — ${err && err.message}`);
    results.push(row);
    record(row);
    return;
  }

  const { character, tips, assigned } = attachCharacter(project, rnd);
  row.tips = tips;
  row.assignedTips = assigned;

  const jobs = [
    ['b_layout', () => computeLayout(project).positions.size],
    ['c_parsimony', () => parsimony(project, character).cost],
    ['d_mkAsr', () => reconstructMk(project, character).probs.size],
    ['e_consistency', () => checkConsistency(project, character).length],
    [
      'f_buildSVG',
      () =>
        buildSVG(project, {
          activeCharacterId: character.id,
          showTransitions: true,
        }).svg.length,
    ],
  ];

  for (const [key, fn] of jobs) {
    try {
      // `timeOp` warms up before every batch, so the parse leg and these legs are
      // treated identically.
      row.ops[key] = timeOp(fn, repsFor(n));
    } catch (err) {
      row.ok = false;
      row.ops[key] = null;
      notes.push(
        `${shape}/${n}: (${key[0]}) ${key} FAILED — ${err && err.constructor && err.constructor.name}: ${err && err.message}`,
      );
    }
  }

  results.push(row);
  record(row);
  process.stdout.write(`  round ${ROUND} done ${shape} n=${n}\n`);
}

// ────────────────────────────────── main ────────────────────────────────────

process.stdout.write(`CladeForge tip-scalability benchmark\n`);
process.stdout.write(
  `node ${process.version}  ${os.type()} ${os.release()}  ${os.arch()}  ${
    os.cpus()[0] ? os.cpus()[0].model : 'unknown cpu'
  }  ${os.cpus().length} cores\n`
);
process.stdout.write(
  `reps: n=100 -> ${repsFor(100)}, n=2000 -> ${repsFor(2000)}; runs per op: ${RUNS} (median of run medians); seed fixed (mulberry32)\n`,
);
// Print enough to make a re-run comparable: the generator seed per case and a
// cheap checksum of the topology actually timed. Without them a different number
// cannot be told apart from a different tree.
process.stdout.write(`topology checksums (newick length + FNV-1a):\n`);
for (const shape of ['balanced', 'pectinate']) {
  for (const n of SIZES) {
    const rnd = mulberry32(0xc1a7 + n * 7919 + (shape === 'balanced' ? 1 : 2));
    const nw = shape === 'balanced' ? balancedNewick(n, rnd) : pectinateNewick(n, rnd);
    let h = 0x811c9dc5;
    for (let i = 0; i < nw.length; i += 1) {
      h ^= nw.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    process.stdout.write(`  ${shape}/${n}: len=${nw.length} fnv1a=${h.toString(16).padStart(8, '0')}\n`);
  }
}
process.stdout.write('\n');

// Measurement order is configurable so a balanced/pectinate difference can be
// told apart from the bias of being timed first: the JIT tiers the shared code
// on whichever case runs first, which shows up as a real-looking ratio at the
// small sizes where each op takes about as long as the warm-up. `SHAPES` feeds
// the REPORTING tables, which stay in a fixed order regardless.
const SHAPES = (process.env.BENCH_SHAPE_ORDER || 'balanced,pectinate')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
let ROUND = 0;
for (let round = 0; round < RUNS; round += 1) {
  ROUND = round + 1;
  // Alternate which shape takes the first position each round, so the
  // first-case-pays penalty lands on both shapes equally instead of on whichever
  // happens to be listed first.
  const order = round % 2 === 0 ? SHAPES : [...SHAPES].reverse();
  process.stdout.write(`round ${ROUND}/${RUNS}: ${order.join(', ')}\n`);
  for (const shape of order) {
    for (const n of SIZES) runCase(shape, n);
  }
}

const OP_KEYS = ['a_parse', 'b_layout', 'c_parsimony', 'd_mkAsr', 'e_consistency', 'f_buildSVG'];
const OP_LABELS = {
  a_parse: '(a) Newick parse',
  b_layout: '(b) auto-layout',
  c_parsimony: '(c) Sankoff k=3',
  d_mkAsr: '(d) Mk ASR k=3',
  e_consistency: '(e) consistency',
  f_buildSVG: '(f) buildSVG',
};

/** One entry per (shape, size); `results` holds one row per ROUND. */
const CASES = [];
{
  const byKey = new Map();
  for (const row of results) byKey.set(`${row.shape}|${row.n}`, row);
  for (const row of byKey.values()) CASES.push(row);
}

process.stdout.write('\n## Median wall-clock milliseconds per operation\n\n');
process.stdout.write('| Tree shape | Tips | ' + OP_KEYS.map((k) => OP_LABELS[k]).join(' | ') + ' | summed path | reps |\n');
process.stdout.write(
  '|---|---|' + OP_KEYS.map(() => '--:|').join('') + '--:|--:|\n'
);
for (const row of CASES) {
  const cells = OP_KEYS.map((k) => {
    const m = cellMedian(row.shape, row.n, k);
    return Number.isFinite(m) ? fmt(m) : 'FAILED';
  });
  // The summed recompute path is printed alongside the per-stage figures rather
  // than added up by hand elsewhere, so the total and the stages cannot disagree.
  // The bracketed range is the same path summed once per ROUND, which is where the
  // run-to-run spread comes from.
  const rounds = Math.max(...OP_KEYS.map((k) => cellRounds(row.shape, row.n, k)), 1);
  const perRound = new Array(rounds).fill(0);
  let summed = 0;
  for (const k of OP_KEYS) {
    const list = CELLS.get(`${row.shape}|${row.n}|${k}`) ?? [];
    if (Number.isFinite(cellMedian(row.shape, row.n, k))) summed += cellMedian(row.shape, row.n, k);
    for (let i = 0; i < rounds; i += 1) perRound[i] += list[i] ?? 0;
  }
  const lo = Math.min(...perRound);
  const hi = Math.max(...perRound);
  process.stdout.write(
    `| ${row.shape} | ${row.n} | ${cells.join(' | ')} | ${fmt(summed)} (${fmt(lo)}–${fmt(hi)}) | ${repsFor(row.n)} |\n`
  );
}

process.stdout.write('\n## Min / median / max spread (ms) for the three heaviest ops\n\n');
process.stdout.write('| Tree shape | Tips | (b) layout min/med/max | (d) Mk ASR min/med/max | (f) buildSVG min/med/max |\n');
process.stdout.write('|---|---|---|---|---|\n');
for (const row of CASES) {
  const cell = (k) =>
    row.ops[k] ? `${fmt(row.ops[k].min)} / ${fmt(row.ops[k].median)} / ${fmt(row.ops[k].max)}` : 'FAILED';
  process.stdout.write(
    `| ${row.shape} | ${row.n} | ${cell('b_layout')} | ${cell('d_mkAsr')} | ${cell('f_buildSVG')} |\n`
  );
}

process.stdout.write('\n## Full recompute path (parse + layout + Sankoff + Mk + consistency + buildSVG)\n\n');
process.stdout.write('| Tree shape | Tips | Sum of medians (ms) | Dominant op |\n|---|---|---:|---|\n');
for (const row of CASES) {
  let sum = 0;
  let bestKey = '—';
  let best = -1;
  let anyFail = false;
  for (const k of OP_KEYS) {
    // Cross-round median — the same statistic the main table reports. Reading a
    // single round's value here would make this section disagree with the table
    // above it.
    const m = cellMedian(row.shape, row.n, k);
    if (!Number.isFinite(m)) {
      anyFail = true;
      continue;
    }
    sum += m;
    if (m > best) {
      best = m;
      bestKey = OP_LABELS[k];
    }
  }
  process.stdout.write(
    `| ${row.shape} | ${row.n} | ${anyFail ? 'INCOMPLETE ' : ''}${fmt(sum)} | ${bestKey} |\n`
  );
}

process.stdout.write('\nScene-graph sanity (values returned by the last timed call of each op, final round):\n');
for (const row of CASES) {
  const vis = row.ops.b_layout ? row.ops.b_layout.last : '?';
  const svg = row.ops.f_buildSVG ? `${row.ops.f_buildSVG.last.toLocaleString('en-US')} chars` : '?';
  const issues = row.ops.e_consistency ? row.ops.e_consistency.last : '?';
  process.stdout.write(
    `  ${row.shape} n=${row.n}: newick=${row.newickKB} kB nodes=${row.parsedNodes} ` +
      `tips=${row.tips} stateAssigned=${row.assignedTips} layoutVisible=${vis} ` +
      `consistencyIssues=${issues} buildSVG=${svg}\n`
  );
}

process.stdout.write(notes.length ? `\n## NOTES / FAILURES\n\n` : `\n## No failures.\n`);
for (const note of notes) process.stdout.write(`- ${note}\n`);
