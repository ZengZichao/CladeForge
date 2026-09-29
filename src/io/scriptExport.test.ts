import { describe, it, expect } from 'vitest';
import { buildRScript } from './scriptExport';
import { createSampleProject, createEmptyProject } from '../model/sampleTree';
import { addChildren } from '../model/treeOps';

describe('buildRScript', () => {
  it('embeds the topology, characters and tip states as R literals', () => {
    const p = createSampleProject();
    const script = buildRScript(p);
    // Topology — assembled from vectors, not parsed back out of Newick; the
    // label-fidelity test below pins why that choice is load-bearing.
    expect(script).toContain('class = \"phylo\"');
    expect(script).toContain('tip.label = c(');
    expect(script).toContain('Nnode = ');
    expect(script).not.toContain('read.tree');
    expect(script).toContain('Pakicetus');
    // Character + state labels present (app language defaults to Chinese)
    expect(script).toContain('栖息地');
    expect(script).toContain('陆生');
    // The step matrix travels into the script as one row-major literal
    // read with `byrow = TRUE`. Pin the whole emitted line against the project's
    // OWN matrix — hard-coded numbers would be a snapshot of one sample and break
    // the moment that sample matrix changes. Row-major
    // plus `byrow = TRUE` is what keeps an asymmetric matrix from being silently
    // transposed (which would invert every step cost in the re-run).
    const habitat = p.characters.find((c) => c.name === '栖息地')!;
    expect(habitat.costMatrix).toBeTruthy();
    const flat = habitat.costMatrix!.map((row) => row.join(', ')).join(', ');
    expect(script).toContain(
      `matrix(c(${flat}), nrow = ${habitat.states.length}, byrow = TRUE)`,
    );
    expect(script).not.toContain('cost = NULL'); // the character does declare one
    // Named tip assignment (R syntax)
    expect(script).toMatch(/"Pakicetus" = "陆生"/);
  });

  it('only depends on ape and defines the parsimony + Mk ASR functions', () => {
    const script = buildRScript(createSampleProject());
    expect(script).toContain('library(ape)');
    expect(script).toContain('sankoff <- function');
    expect(script).toContain('mk_asr <- function');
    expect(script).toContain('cairo_pdf("cladeforge_reconstruction.pdf"');
    // No absolute paths or side-car files: everything is embedded.
    expect(script).not.toMatch(/read\.(csv|table)\(/);
  });

  it('handles a project without characters or states', () => {
    const p = createEmptyProject();
    const script = buildRScript(p);
    expect(script.startsWith('#!/usr/bin/env Rscript')).toBe(true);
    expect(script).toMatch(/characters <- list\(\s*\)/);
  });

  /**
   * `rate <- 1 / mean(bl)` must survive alongside the unit-length fallback: if the
   * binding goes missing, `rate` is UNBOUND and the exported script dies with
   * "object 'rate' not found" on EVERY project — worse than the branch-length-free
   * case it was written to handle. Grepping for function definitions cannot see
   * that, so this checks every name `mk_asr` actually uses is bound somewhere.
   */
  it('binds every script-level name mk_asr reads, rate included', () => {
    const script = buildRScript(createSampleProject());
    const body = /mk_asr <- function\(([^)]*)\)\s*\{([\s\S]*?)\n\}\n/.exec(script);
    expect(body, 'mk_asr must be emitted as a single top-level function').toBeTruthy();
    const [, params, code] = body!;

    // Top-level bindings the generated script actually creates.
    const assigned = new Set<string>();
    for (const m of script.matchAll(/^([A-Za-z._][\w.]*)\s*<?-?\s*<-\s/gm)) assigned.add(m[1]);

    // The names mk_asr reads from OUTSIDE itself. `bl` and `rate` are the two that
    // must never be dropped; `p_er` is the helper defined above it.
    for (const name of ['bl', 'rate', 'p_er']) {
      expect(code, `mk_asr should still call/use ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
      expect(assigned.has(name), `${name} is read by mk_asr but never bound`).toBe(true);
    }
    expect(params.replace(/\s/g, '')).toBe('tree,tip_states,states');
    // The rate definition and the fallback it depends on. Averaging only the
    // positive lengths would let a project with a recorded 0 (a synchronous
    // divergence, which the application keeps and averages over) or an unset
    // length reconstruct at a DIFFERENT rate than the app
    // reports. The lengths are resolved before they are emitted, so the
    // mean runs over all of them.
    expect(script).toMatch(/^rate <- 1 \/ mean\(bl\)$/m);
    expect(script).toMatch(/^bl <- tree\$edge\.length$/m);
    expect(script).toMatch(/^\s*bl <- rep\(1, nrow\(tree\$edge\)\)$/m);
    // `rate` must be bound BEFORE mk_asr is ever invoked, i.e. at script level.
    expect(script.indexOf('rate <- 1')).toBeLessThan(script.indexOf('mk_asr(tree'));
  });

  it('announces the unit-length fallback and the figure caveat', () => {
    const noLengths = buildRScript(createEmptyProject());
    expect(noLengths).toMatch(/is\.null\(bl\)/);
    expect(noLengths).toMatch(/bl <- rep\(1, nrow\(tree\$edge\)\)/);
    expect(noLengths).toMatch(/Branch lengths: ABSENT/);
    expect(noLengths).toMatch(/rate <- 1 \/ mean\(bl\)/);
    const withLengths = buildRScript(createSampleProject());
    expect(withLengths).toMatch(/Branch lengths: present/);
    // The header states its own scope: the PDF reproduces the graphic, not more.
    expect(withLengths).toMatch(/It is NOT a pixel copy of the on-screen figure/);
    expect(withLengths).toMatch(/REPRODUCED/);
    expect(withLengths).toMatch(/APPROXIMATED/);
  });

  it('keeps a spaced tip label byte-exact in the emitted tree', () => {
    // ape 5.8.1's own Newick reader returns "Tobaccomosaicvirus" for a quoted
    // label containing spaces. The script keys its character `tips` on the
    // ORIGINAL labels, so an affected tip would vanish into "missing data"
    // without a word: on the shipped virus sample that is 6 of 21 tips, with the
    // host character's Sankoff cost printing 1 where the application reports 3.
    // Building the tree from vectors removes the reader from the path entirely,
    // so the label the script carries must be the label the project has.
    const p = createEmptyProject('Label fidelity');
    const [a, b] = addChildren(p, p.rootId, 2);
    p.nodes[a].label = 'Tobacco mosaic virus';
    p.nodes[b].label = 'Gracilicutes (GN)';
    const script = buildRScript(p);
    expect(script).toContain('"Tobacco mosaic virus"');
    expect(script).toContain('"Gracilicutes (GN)"');
    expect(script).not.toContain('Tobaccomosaicvirus');
    expect(script).not.toContain('read.tree');
  });

  it('numbers nodes so the script\'s own loops stay valid', () => {
    // sankoff()/mk_asr() walk internal nodes in DESCENDING id order and rely on
    // that visiting children before parents; ape's convention additionally
    // expects the root to be Ntip + 1. Both follow from breadth-first numbering.
    const script = buildRScript(createSampleProject());
    const edge = /edge = matrix\(c\(([\d,\s-]+)\), ncol = 2/.exec(script);
    expect(edge).not.toBeNull();
    const nums = (edge as RegExpExecArray)[1].split(',').map((v) => Number(v.trim()));
    const nNode = Number(/Nnode = (\d+)L/.exec(script)![1]);
    const nTip = (/tip.label = c\(([^)]*)\)/.exec(script)![1].match(/"(?:[^"]*)"/g) ?? []).length;
    // Tips hold the LOW ids (1..Ntip), so a parent outweighs a tip child. The
    // invariant the descending loop actually needs is that an internal node's
    // internal children carry larger ids, i.e. they were processed already.
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (nums[i + 1] > nTip) expect(nums[i]).toBeLessThan(nums[i + 1]);
    }
    expect(Math.max(...nums)).toBe(nTip + nNode);
    expect(nums[0]).toBe(nTip + 1); // the first edge leaves the root
    // Every node except the root appears exactly once as a child.
    const children = nums.filter((_, i) => i % 2 === 1);
    expect(new Set(children).size).toBe(nTip + nNode - 1);
    expect(children.length).toBe(nTip + nNode - 1);
  });


  it('resolves branch lengths the way the application does before emitting them', () => {
    // Zero is data, not absence: reconstructMk averages a recorded 0 into the
    // mean and uses it as a real zero-length branch. An unset / negative /
    // non-finite length becomes 1 there. Both rules have to be visible in the
    // emitted edge.length, because the script's rate is now mean(whole vector).
    const p = createEmptyProject('Mixed lengths');
    const [a, b, c] = addChildren(p, p.rootId, 3);
    p.nodes[a].branchLength = 0;
    p.nodes[b].branchLength = -5;
    p.nodes[c].branchLength = 7;
    const script = buildRScript(p);
    const emitted = (/edge\.length = c\(([^)]*)\)/.exec(script)![1]).split(',').map((v) => Number(v.trim()));
    expect(emitted).toEqual([0, 1, 7]); // zero kept, negative replaced by 1
    expect(script).not.toMatch(/NA_real_/);
    // The rate the script will compute, and the rate the application computes.
    const appLens = Object.values(p.nodes)
      .filter((n) => n.parentId)
      .map((n) => (typeof n.branchLength === 'number' && Number.isFinite(n.branchLength) && n.branchLength >= 0 ? n.branchLength : 1));
    const scriptRate = 1 / (emitted.reduce((x, y) => x + y, 0) / emitted.length);
    const appRate = 1 / (appLens.reduce((x, y) => x + y, 0) / appLens.length);
    expect(scriptRate).toBeCloseTo(appRate, 12);
    expect(script).toContain('were unset, negative or non-finite and are analysed as 1');
  });

  // A hole in the step matrix must not be flattened straight into the literal:
  // `Array.flat()` keeps the gap, `join(', ')` renders it as nothing, and the
  // emitted `matrix(c(0, , 3), …)` is a parse error in R — which would kill the one
  // artefact this app produces to prove its own results are reproducible.
  it('writes a parseable matrix when the step matrix has holes', () => {
    const p = createSampleProject();
    const c = p.characters.find((x) => x.costMatrix && x.states.length >= 3)!;
    const rows = c.costMatrix!.map((r) => [...r]);
    rows[0][1] = undefined as unknown as number; // unfilled cell
    rows[1][0] = Number.NaN; // non-numeric
    rows[2][0] = -4; // negative
    c.costMatrix = rows;
    const script = buildRScript(p);
    expect(script).not.toMatch(/c\([^)]*,\s*,/); // no empty argument anywhere
    expect(script).not.toMatch(/,\s*NaN\s*,|NaN\s*\)/);
    const block = script.match(/cost = matrix\(c\(([^)]*)\), nrow = (\d+)/)!;
    const cells = block[1].split(',').map((s) => s.trim());
    expect(cells.length).toBe(Number(block[2]) ** 2);
    for (const cell of cells) expect(cell).toMatch(/^\d+(\.\d+)?$/);
    // And the substitution is declared in the file, not hidden.
    expect(script).toContain('priced as one step');
  });

  // The R script keys its `tips` vectors on the tip LABEL, so two tips sharing a
  // name would collapse into one entry and the second one's states would drop
  // silently — the same class of loss NEXUS already guards against.
  it('de-duplicates repeated and blank tip labels the way NEXUS does', () => {
    const p = createSampleProject();
    const tips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0);
    const char = p.characters.find((x) => x.type === 'discrete' && x.states.length > 0)!;
    tips[0].label = 'Escherichia';
    tips[1].label = 'Escherichia'; // deliberate collision
    tips[2].label = ''; // deliberate blank
    for (const t of tips) t.charStates = { ...t.charStates, [char.id]: char.states[0].id };
    const script = buildRScript(p);
    const labels = script.match(/tip\.label = c\(([^)]*)\)/)!;
    const names = labels[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    expect(new Set(names).size).toBe(names.length); // every tip still addressable
    const stateKeys = [...script.matchAll(/tips = c\(([^)]*)\)/g)].flatMap((m) =>
      m[1]
        .split(',')
        .map((kv) => kv.split('=')[0].trim().replace(/^"|"$/g, ''))
        .filter(Boolean),
    );
    for (const n of names) expect(stateKeys).toContain(n);
    expect(names).toContain('Escherichia_2');
  });
});
