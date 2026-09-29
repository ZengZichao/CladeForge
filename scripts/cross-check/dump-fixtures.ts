// Fixture dumper for the third-party (ape / phangorn) cross-check leg.
//
// Writes, for every built-in CladeForge sample project, everything an external
// implementation needs to reproduce the app's numbers:
//
//   tree.nwk                 the Newick the app exports; kept for reference — the
//                            R legs rebuild the topology from nodes.tsv
//   tree_rescaled.nwk        the same tree with every branch length divided by
//                            their mean, which turns CladeForge's ER rate
//                            1 / mean(branch length) into 1 — the form in which
//                            its scale invariance can be checked directly
//   characters.tsv           state alphabet per character
//   matrix.tsv               the tip-by-character data matrix ('?': no observation)
//   costs.tsv                the Sankoff step matrix, when the project declares one
//   nodes.tsv                topology bookkeeping, including the clade signature
//                            every result row is keyed on
//   asr_posteriors.tsv       CladeForge's Mk / ER marginal posteriors
//   parsimony.tsv            CladeForge's Sankoff reconstruction + minimum cost,
//                            both tie sets (parent-conditional and the union over
//                            all optimal reconstructions)
//   summary.tsv              per-character model constants (mean length, rate)
//   cladeforge_analysis.R    the app's OWN exported R script — a second,
//                            independent implementation of the same algorithms
//
// Run through the plain-node wrapper:  node scripts/cross-check/dump-fixtures.mjs
// (it executes this file with the repository's existing vite-node, no new deps).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SAMPLE_PROJECTS } from '../../src/model/sampleTree';
import { parsimony } from '../../src/model/parsimony';
import { reconstructMk, DEFAULT_ASR_OPTIONS } from '../../src/model/asr';
import { escapeName, parseNewick, serializeNewick } from '../../src/io/newick';
import { buildRScript } from '../../src/io/scriptExport';
import type { Character, NodeId, Project } from '../../src/model/types';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ? process.argv[2] : join(here, 'fixtures');

interface Flat {
  ids: NodeId[];
  parent: Map<NodeId, NodeId | null>;
  kids: Map<NodeId, NodeId[]>;
  len: Map<NodeId, number>;
  isTip: Set<NodeId>;
}

function flatten(project: Project): Flat {
  const ids: NodeId[] = [];
  const seen = new Set<NodeId>();
  const queue: NodeId[] = [project.rootId];
  const parent = new Map<NodeId, NodeId | null>();
  const kids = new Map<NodeId, NodeId[]>();
  const len = new Map<NodeId, number>();
  const isTip = new Set<NodeId>();
  while (queue.length) {
    const id = queue.shift() as NodeId;
    if (seen.has(id) || !project.nodes[id]) continue;
    seen.add(id);
    ids.push(id);
    const node = project.nodes[id];
    parent.set(id, node.parentId && project.nodes[node.parentId] ? node.parentId : null);
    const list = node.childrenIds.filter((c) => project.nodes[c]);
    kids.set(id, list);
    if (list.length === 0) isTip.add(id);
    let l = node.branchLength;
    if (typeof l !== 'number' || !Number.isFinite(l) || l < 0) l = 1;
    len.set(id, node.id === project.rootId ? 0 : (l as number));
    for (const c of list) queue.push(c);
  }
  return { ids, parent, kids, len, isTip };
}

/**
 * Stable, label-free identity of a node: the sorted tip set beneath it plus the
 * number of nodes in that sub-tree. The extra term is what makes the key unique
 * for the one-child chains the sample projects contain (in the cetacean project
 * Basilosauridae and Neoceti cover exactly the same tips), and an R reader can
 * recompute both parts from the Newick alone — so results can be joined without
 * trusting node labels.
 */
function signature(project: Project, flat: Flat): Map<NodeId, string> {
  const out = new Map<NodeId, string>();
  const collect = (id: NodeId): string[] => {
    if (flat.isTip.has(id)) return [project.nodes[id].label || id];
    const acc: string[] = [];
    for (const c of flat.kids.get(id) ?? []) acc.push(...collect(c));
    return acc;
  };
  const sizeBelow = (id: NodeId): number =>
    1 + (flat.kids.get(id) ?? []).reduce((a, c) => a + sizeBelow(c), 0);
  for (const id of flat.ids) {
    const tips = collect(id).sort().join('+');
    out.set(id, flat.isTip.has(id) ? `T:${tips}` : `N:${tips}|${sizeBelow(id)}`);
  }
  return out;
}

/** Number of tips beneath each node (used as a sanity column in nodes.tsv). */
function tipCountsBelow(project: Project, flat: Flat): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  const walk = (id: NodeId): number => {
    if (flat.isTip.has(id)) {
      out.set(id, 1);
      return 1;
    }
    const n = (flat.kids.get(id) ?? []).reduce((a, c) => a + walk(c), 0);
    out.set(id, n);
    return n;
  };
  walk(project.rootId);
  return out;
}

function tsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => String(c).replace(/[\t\n\r]/g, ' ')).join('\t')).join('\n') + '\n';
}

function write(rel: string, text: string): string {
  const path = join(outDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return rel;
}

/**
 * A control document whose ONLY purpose is to make the marginal ancestral-state
 * leg comparable at all.
 *
 * `ape::ace(model = "ER")` refuses any tree that is not rooted AND fully
 * dichotomous, and every shipped sample carries stem lineages by design, so none
 * of the six projects lets marginal ASR be compared against a third party.
 *
 * This tree is deliberately built to meet those conditions instead: rooted, every
 * internal node has exactly two children, no single-child nodes, and all tips
 * scored for a two-state character with no `?` codings. It is not a showcase
 * sample and is deliberately kept out of the app's `SAMPLE_PROJECTS` gallery.
 */
function buildErControlProject(): Project {
  const project = parseNewick(
    '(((t1:0.40,t2:0.60)i1:0.30,(t3:0.50,t4:0.20)i2:0.40)i3:0.25,'
    + '((t5:0.70,t6:0.35)i4:0.15,(t7:0.45,t8:0.50)i5:0.30)i6:0.20)i7:0.10;',
    'ER control',
  );
  const character: Character = {
    id: 'erControlChar',
    name: 'Control character',
    type: 'discrete',
    states: [
      { id: 'c0', label: 'C0', color: '#d55e00' },
      { id: 'c1', label: 'C1', color: '#0072b2' },
    ],
  };
  // A pattern that is NOT perfectly confounded with the topology, so the
  // marginals are not degenerate: two independent origins of c1.
  const assignment: Record<string, string> = {
    t1: 'c0', t2: 'c1', t3: 'c1', t4: 'c0',
    t5: 'c0', t6: 'c1', t7: 'c0', t8: 'c0',
  };
  project.characters = [character];
  for (const node of Object.values(project.nodes)) {
    if (node.childrenIds.length === 0 && assignment[node.label]) {
      node.charStates = { [character.id]: assignment[node.label] };
    }
  }
  // Guard the properties that make this document comparable at all. If an edit
  // ever reintroduces a stem lineage, an unresolved tip or a `?` coding, the
  // ER leg silently goes back to zero comparisons — fail here instead.
  const nodes = Object.values(project.nodes);
  const tips = nodes.filter((n) => n.childrenIds.length === 0);
  const unscored = tips.filter((n) => n.charStates?.[character.id] === undefined);
  const nonBinary = nodes.filter((n) => n.childrenIds.length > 0 && n.childrenIds.length !== 2);
  const stems = nodes.filter((n) => n.childrenIds.length === 1);
  if (tips.length !== 8 || unscored.length || nonBinary.length || stems.length) {
    throw new Error(
      `ER control document is no longer comparable to ape::ace: `
      + `tips=${tips.length}, unscored=${unscored.length}, nonBinary=${nonBinary.length}, stems=${stems.length}`,
    );
  }
  return project;
}

const ER_CONTROL = { id: 'er-control', label: 'ER control (no stem lineages)', build: buildErControlProject };


const manifest: (string | number)[][] = [
  ['project', 'character', 'states', 'tips', 'internals', 'mean_branch_length', 'rate_1_over_mean', 'sankoff_min_cost', 'sankoff_matrix'],
];
const written: string[] = [];

for (const descriptor of [...SAMPLE_PROJECTS, ER_CONTROL]) {
  const project = descriptor.build();
  const flat = flatten(project);
  const sig = signature(project, flat);
  const tipsBelow = tipCountsBelow(project, flat);
  const lens = flat.ids.filter((id) => id !== project.rootId).map((id) => flat.len.get(id) as number);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 1;
  const rate = mean > 0 ? 1 / mean : 1;
  const tipCount = flat.ids.filter((id) => flat.isTip.has(id)).length;

  // --- tree, as the app exports it, plus the mean-rescaled form ------------
  written.push(write(`${descriptor.id}/tree.nwk`, `${serializeNewick(project)}\n`));
  const scale = (id: NodeId): string => {
    const kids = flat.kids.get(id) ?? [];
    const inner = kids.length ? `(${kids.map(scale).join(',')})` : '';
    const node = project.nodes[id];
    // byte-identical labels and the fixture node keys keep matching them
    const label = escapeName(node.label || '');
    const raw = flat.len.get(id) as number;
    const bl = id === project.rootId ? '' : `:${(raw / mean).toPrecision(12)}`;
    return `${inner}${label}${bl}`;
  };
  written.push(write(`${descriptor.id}/tree_rescaled.nwk`, `${scale(project.rootId)};\n`));

  // --- nodes ----------------------------------------------------------------
  written.push(
    write(
      `${descriptor.id}/nodes.tsv`,
      tsv([
        ['node_key', 'label', 'parent_key', 'branch_length', 'rescaled_length', 'is_tip', 'tips_below'],
        ...flat.ids.map((id) => [
          sig.get(id),
          project.nodes[id].label || '',
          flat.parent.get(id) ? (sig.get(flat.parent.get(id) as NodeId) as string) : '',
          id === project.rootId ? 0 : flat.len.get(id),
          id === project.rootId ? 0 : (flat.len.get(id) as number) / mean,
          flat.isTip.has(id) ? 1 : 0,
          tipsBelow.get(id),
        ]),
      ]),
    ),
  );

  // --- characters / matrix / costs ------------------------------------------
  const charRows: (string | number)[][] = [['character', 'character_name', 'type', 'state_index', 'state_label', 'color']];
  const matrixRows: (string | number)[][] = [['character', 'tip', 'state_label']];
  const costRows: (string | number)[][] = [['character', 'from_index', 'to_index', 'cost']];
  const asrRows: (string | number)[][] = [['character', 'node_key', 'state_index', 'state_label', 'posterior']];
  const parRows: (string | number)[][] = [['character', 'node_key', 'chosen_state_index', 'tie_state_indexes', 'mp_state_indexes', 'change_on_branch']];
  const summaryRows: (string | number)[][] = [['character', 'mean_branch_length', 'rate_1_over_mean', 'sankoff_min_cost', 'has_step_matrix']];

  for (const char of project.characters) {
    char.states.forEach((s, i) => charRows.push([char.id, char.name, char.type, i, s.label, s.color]));
    for (const id of flat.ids) {
      if (!flat.isTip.has(id)) continue;
      const raw = project.nodes[id].charStates?.[char.id];
      const st = typeof raw === 'string' ? char.states.find((s) => s.id === raw) : undefined;
      matrixRows.push([char.id, project.nodes[id].label || id, st ? st.label : '?']);
    }
    if (char.costMatrix) {
      char.costMatrix.forEach((row, i) => row.forEach((v, j) => costRows.push([char.id, i, j, v])));
    }

    if (char.type !== 'discrete' || char.states.length < 2) continue;
    const asr = reconstructMk(project, char, DEFAULT_ASR_OPTIONS);
    if (asr) {
      for (const id of flat.ids) {
        const probs = asr.probs.get(id);
        if (!probs) continue;
        probs.forEach((p, i) => asrRows.push([char.id, sig.get(id), i, char.states[i].label, p.toPrecision(10)]));
      }
    }
    const par = parsimony(project, char);
    for (const id of flat.ids) {
      const chosen = par.chosen.get(id);
      const ci = char.states.findIndex((s) => s.id === chosen);
      const ties = (par.states.get(id) ?? []).map((id2) => char.states.findIndex((s) => s.id === id2)).join(',');
      // Two different objects, both worth exporting: `tie_state_indexes` is what
      // survives the single ancestor path the app's tie-break resolved, while
      // `mp_state_indexes` is every state occurring in SOME most-parsimonious
      // reconstruction — the set phangorn::MPR returns, and the one the
      // ambiguity warning is allowed to talk about.
      const mpSet = (par.mpStates.get(id) ?? []).map((id2) => char.states.findIndex((s) => s.id === id2)).join(',');
      parRows.push([char.id, sig.get(id), ci, ties, mpSet, par.changeBranches.has(id) ? 1 : 0]);
    }
    summaryRows.push([char.id, mean.toPrecision(10), rate.toPrecision(10), par.cost, char.costMatrix ? 1 : 0]);
    manifest.push([descriptor.id, char.id, char.states.length, tipCount, flat.ids.length - tipCount, mean.toPrecision(10), rate.toPrecision(10), par.cost, char.costMatrix ? 'Sankoff' : 'uniform']);
  }

  written.push(write(`${descriptor.id}/characters.tsv`, tsv(charRows)));
  written.push(write(`${descriptor.id}/matrix.tsv`, tsv(matrixRows)));
  written.push(write(`${descriptor.id}/costs.tsv`, tsv(costRows)));
  written.push(write(`${descriptor.id}/asr_posteriors.tsv`, tsv(asrRows)));
  written.push(write(`${descriptor.id}/parsimony.tsv`, tsv(parRows)));
  written.push(write(`${descriptor.id}/summary.tsv`, tsv(summaryRows)));

  // --- the app's own exported analysis script (verbatim, as the GUI writes it) --
  written.push(write(`${descriptor.id}/cladeforge_analysis.R`, buildRScript(project)));
}

written.push(write('manifest.tsv', tsv(manifest)));
// names are needed only for human readers of the fixtures
write(
  'names.tsv',
  tsv([
    ['project', 'id', 'name'],
    ...[...SAMPLE_PROJECTS, ER_CONTROL].map((d) => [d.id, d.id, d.label]),
  ]),
);

// eslint-disable-next-line no-console
console.log(`CladeForge fixtures written to ${outDir}`);
for (const f of written) // eslint-disable-next-line no-console
  console.log(`  ${f}`);
