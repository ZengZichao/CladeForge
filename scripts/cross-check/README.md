# Cross-checking CladeForge against ape and phangorn

> 中文版：[README_ZH.md](./README_ZH.md)

Correctness of the three reconstruction algorithms rests on two independent kinds
of evidence:

1. **self-contained oracles** — does the TypeScript compute the *right answer*,
   checked against a brute-force enumeration written from the definition of each
   algorithm, plus the sensitivity of the Mk marginals to the fixed rate
   `r = 1/mean(branch length)`;
2. **third-party comparison** — does an established implementation produce the same
   numbers on the same data.

## Where each half lives

| | self-contained oracles | third-party harness (this directory) |
| --- | --- | --- |
| code | `src/model/independentReference.test.ts` | `dump-fixtures.ts` + `dump-fixtures.mjs` + `ape_agreement.R` + `run-cross-check.mjs` |
| command | `npx vitest run src/model/independentReference.test.ts` | `node scripts/cross-check/run-cross-check.mjs` |
| dependencies | Node plus the repository's own dev dependencies | R with the `ape` and `phangorn` packages; the per-leg totals below were checked against R 4.5.3, ape 5.8.1, phangorn 2.12.1 |

## 1. Dump the fixtures (Node only, no new dependencies)

```sh
cd cladeforge
node scripts/cross-check/dump-fixtures.mjs                  # → scripts/cross-check/fixtures/
node scripts/cross-check/dump-fixtures.mjs /tmp/cf-fixtures # or an explicit directory
```

`dump-fixtures.mjs` is a plain-Node wrapper: it executes `dump-fixtures.ts` with
the repository's own `vite-node` (already installed as a `vitest` dependency), so
the fixtures are produced by the *same* modules the application uses
(`sampleTree`, `parsimony`, `asr`, `scriptExport`, `io/newick`) rather than by a
re-implementation. If `vite-node` is absent it says so and exits 2 without
writing anything.

Per project — the six built-in samples (`archaea`, `bacteria`, `virus`,
`cetacean`, `plant`, `animal`) plus the `er-control` control document described
under "The `er-control` control document" — it writes ten files, plus
`manifest.tsv` and `names.tsv` at the top:

| file | content | what the R leg does with it |
| --- | --- | --- |
| `tree.nwk` | Newick exactly as the app exports it (`serializeNewick`), internal labels included | kept for reference; **not** what the harness parses (see "Notes on ape and phangorn behaviour") |
| `tree_rescaled.nwk` | same tree, every branch length divided by their mean | not consumed by the harness (ape fits its own rate); exported so a reader can check CladeForge's scale-invariance claim |
| `characters.tsv` | character id, name, type, state index, state label, colour | state alphabet |
| `matrix.tsv` | tip × character matrix; `?` = no observation (unset, `?` or `-`) | the data to be reconstructed |
| `costs.tsv` | the Sankoff step matrix, where the project declares one | tells the harness which characters are priced with uniform costs |
| `nodes.tsv` | `node_key`, label, parent key, raw and rescaled length, tip count | **the topology the harness rebuilds the tree from** |
| `asr_posteriors.tsv` | CladeForge's ER-Mk marginal posterior per node × state | marginal-state comparison |
| `parsimony.tsv` | chosen state, **both** tie sets — `tie_state_indexes` (what survives the resolved ancestor path) and `mp_state_indexes` (every state in some optimal reconstruction, the set `phangorn::MPR` returns) — plus the change-branch flag; min cost in `summary.tsv` | parsimony comparison |
| `summary.tsv` | mean branch length, `r = 1/mean`, minimum parsimony cost | cost comparison |
| `cladeforge_analysis.R` | **the app's own exported reproducible script** (`buildRScript`), verbatim | runs standalone under `Rscript`; kept as the "second implementation" evidence |

Results are joined on a topological key, not on labels: `T:<tip label>` for tips
and `N:<sorted tip set>|<number of nodes in that sub-tree>` for internal nodes.
The sub-tree-size term is not decoration: in the cetacean project
*Basilosauridae* and *Neoceti* cover exactly the same two tips, so a tip-set key
alone would silently compare the wrong pair of nodes. Because `nodes.tsv` carries
those keys, the tree is rebuilt from the node table rather than parsed from
Newick — which also sidesteps the two ape reader bugs noted below.

## 2. Run the third-party comparison (needs R + ape + phangorn)

```sh
Rscript scripts/cross-check/ape_agreement.R
# or end to end (re-dumps fixtures, verifies them, then calls R):
node scripts/cross-check/run-cross-check.mjs
# non-PATH binary:
RSCRIPT_BIN=/opt/R/4.4.2/bin/Rscript node scripts/cross-check/run-cross-check.mjs
```

`run-cross-check.mjs` never fakes the second half: it re-dumps the fixtures,
checks that all ten files exist for every project directory and that each Newick
parses to ≥ 2 tips, then looks for an `Rscript` — in `$RSCRIPT_BIN`, then `PATH`,
then the framework/homebrew locations, then the env-manager prefixes under the
home directory (mamba / miniconda / anaconda / miniforge / mambaforge / pixi
`envs` directories), where R usually hides when it was not installed from CRAN.
An installation that cannot `library(ape)` and `library(phangorn)` is reported as
unusable rather than chosen, because "an R exists" is not the precondition for
this leg. If nothing usable is found it writes an explicit "R LEG NOT RUN" message
with what it searched, what it rejected and why, and exits **3**;
`--fixtures-only` stops after step 1 on purpose. An explicit `$RSCRIPT_BIN` is a
request, not a hint: when that binary cannot run the leg the driver stops instead
of substituting a different R. It also gives the R child a UTF-8 `LC_ALL`;
`ape_agreement.R` does not depend on that (see the `read_tsv` comment in that
file), but the child still needs it to echo Chinese labels in its own output.

`ape_agreement.R` writes one row per project × character × leg to
`fixtures/ape-agreement.tsv` and echoes it:

| `leg` | external reference | compared with | verdict |
| --- | --- | --- | --- |
| `step-count(phangorn::parsimony)` | phangorn's Fitch score, unordered unit costs (branch lengths irrelevant) | `summary.tsv` minimum cost under a uniform matrix | **gated** — exact match |
| `ER-marginals(ape::ace)` | `ape::ace(model = "ER", method = "ML")$lik.anc`, joined to `asr_posteriors.tsv` on the clade key | CladeForge's posteriors | **measured only — `compared` stays 0** |
| `exported-R-script-Sankoff` | the app's own `cladeforge_analysis.R`, re-run with `Rscript` in a throwaway directory | `manifest.tsv` minimum cost, per project | **gated** — exact match |

The ER leg cannot be an agreement test, and that is a fact about ape rather than
a hedge: `ace(model = "ER")` **estimates** the transition rate by maximum
likelihood — its documented return values include `rates` and `se` — while
CladeForge fixes the rate at `1/mean(branch length)`. Posteriors depend on that
rate, so a deviation here mixes an implementation gap with a model choice and
would score either way for the wrong reason. The row therefore reports ape's
fitted rate, the worst and mean posterior deviation, and how often the most
likely state coincides — with `compared = 0`, which keeps it out of every
agreement total. The rate-free third-party test that *is* available is phangorn's
Fitch parsimony, and that is leg 1.

The ER leg joins on the clade key rather than on row position, and refuses to
guess: `ape::ace` may work on a reordered copy of the tree, so each of its rows is
re-identified by the tip set beneath it and the size of that sub-tree. A key that
does not resolve one-to-one, a matrix whose rows do not sum to 1, or a state that
no tip shows (fewer factor levels than CladeForge reports posteriors for) all end
the measurement with a reason instead of a number. `lik.anc` is what ape's
documentation calls the discrete-ML ancestral likelihoods; `states` and `probs`
are accepted for other builds, the component actually used is named in the
output, and so is whether it covered the internal nodes only or all nodes.

Exit codes: `0` every attempted comparison agreed; `1` a row FAILED or
disagreed; `2` fixtures missing or nothing comparable. Rows that are excluded,
not comparable, or not yet compared are recorded with their reason and are
**never** counted as agreement.

## On the rate

CladeForge fixes the ER rate at `r = 1/mean(branch length)`, which makes its
posteriors invariant to the absolute scale of the tree. `ape::ace(model = "ER")`
does something different: it has one free rate and **fits it by maximum
likelihood** (`fit$rates`, `fit$se`). Two consequences follow:

* Rescaling every branch length by a constant cannot change ape's answer — the
  fitted rate simply absorbs it — so feeding ape the mean-rescaled tree buys
  nothing. Leg 2 runs on the raw tree.
* The two sides are therefore **not the same model**, and no rescaling makes them
  one. That is why the ER row is measured and never gated (see the leg table).

`tree_rescaled.nwk` and the `rescaled_length` column are still exported: they are
how a reader reproduces CladeForge's own scale-invariance claim.

How far the marginals actually move between `r = 1/mean` and an ML-fitted `r` is a
separate, ape-free question, measured on the shipped projects by the rate-sensitivity
leg of `src/model/independentReference.test.ts`.

## What each leg proves, and what it does not

* The oracle legs prove the TypeScript implementations match the *definitions*
  (Sankoff minimum cost and tie sets, exact ER-Mk marginals, rooted consensus
  clade selection and support, minimum-cost DTL placements) on fixed, randomised
  and shipped data. They prove nothing about how those definitions compare with
  published tools — that is this harness's job.
* `cladeforge_analysis.R` checks CladeForge against its *own* second
  implementation; `ape_agreement.R` checks the application against a third-party
  library.
* The DTL leg is a *parsimony* reconciliation under a topology-only transfer
  constraint. It is compared against a brute-force enumeration of the same
  model, **not** against RIANA / Treerecon / CaSpec: those differ in root and
  arrival fees, in per-junction loss counting, and in age-based temporal
  feasibility (see the header of `src/model/dtl.ts`). Quote its totals as
  "events under this model".

## Reproducing from a clean checkout

```sh
npm install                                              # vite-node comes with vitest
node scripts/cross-check/dump-fixtures.mjs               # regenerate fixtures
npx vitest run src/model/independentReference.test.ts    # oracle legs
Rscript scripts/cross-check/ape_agreement.R              # third-party leg (needs R)
```

`fixtures/` is generated output; it is kept so that a reader who only has R can
run step 2 directly. Regenerating it is byte-identical: sample character ids are
pinned as `sample-char:<project>-<name>` in `src/model/sampleTree.ts` (and
guarded by a test), because the id is the `character` column of five fixture files
plus `manifest.tsv` — leaving it random would rewrite ~1 500 committed lines on
every regeneration without changing a single measurable value. Node and state ids
stay random, because no fixture column carries them.

## Reading the output

The shipped `manifest.tsv` holds 14 project × character rows over seven fixture
documents. The per-leg totals are:

```
step-count(phangorn::parsimony)   compared 10  agreed 10
exported-R-script-Sankoff         compared 14  agreed 14
ER-marginals(ape::ace)            compared 0   agreed 0   (4 measurement rows)
```

Exit status **0**: every comparison the harness attempted agreed.

* **Step counts — 10/10 exact agreement** with `phangorn::parsimony()` over the
  characters that are fully scored and priced with uniform costs. Twelve characters
  reach this leg; ten qualify, because the two `archaea` characters carry `?`
  codings — phangorn's `phyDat` drops such sites and would return 0, so they are
  recorded as `EXCLUDED` rather than reported as a disagreement. The two `cetacean`
  characters declare an explicit Sankoff step matrix and so are not uniform-cost
  material at all. The harness checks that an exclusion is real: a state-label
  lookup that resolves fewer tips than the fixture declares missing is a `join`
  failure, not missing data.
* **Marginal states — measured on 4 rows, deliberately not counted anywhere.**
  `ape::ace()` refuses any tree that is not rooted **and** fully dichotomous, and
  bacteria, virus, cetacean and animal carry stem lineages by design: those eight
  rows read NOT-COMPARABLE, as do the two `archaea` rows (missing codings).
  Contracting a stem node would make `ace()` run, but it changes *which* node is
  being compared, so the harness does not do it. `plant` (three characters) and
  `er-control` are dichotomous, so four measurement rows come back. CladeForge's
  fixed rate is `1/mean = 0.004806` on plant and `2.642` on er-control; ape's
  ML-fitted rate is `0.1000` for all three plant characters (the optimiser's lower
  bound — on a tree-consistent character it wants no change at all) and `15.1913`
  on er-control (saturation). The most likely state then coincides on 6/13, 5/13,
  10/13 and 6/7 internal nodes. That spread is the point — it is a model
  difference, not an implementation one, and gating on it would score the wrong
  thing.
* **The app's own exported script — 14/14.** Re-running `cladeforge_analysis.R`
  under `Rscript` prints exactly the Sankoff minima `manifest.tsv` records for all
  seven fixture documents, including the two asymmetric `cetacean` matrices — there
  the exported script pays 3 rather than Fitch's 5, so the step matrix really is
  honoured. The reproducibility claim the export makes is therefore executed, not
  inferred.

## The `er-control` control document

`ape::ace` rejects any tree that is not rooted and fully dichotomous, and most
built-in samples carry stem lineages. `dump-fixtures.ts` therefore also emits
**`er-control/`**: a rooted, fully dichotomous, 8-tip document with all tips
scored for a two-state character and no `?` codings. It is deliberately NOT in
the app's `SAMPLE_PROJECTS` gallery; it exists only so
`ace(model = "ER", method = "ML")` has something to run on.

`buildErControlProject()` asserts those properties (tip count, no unscored tips,
no non-binary nodes, no single-child nodes) and throws if an edit breaks them, so
the leg cannot silently fall back to zero comparisons.

## Notes on ape and phangorn behaviour

These are the reasons the harness is written the way it is:

* **`ace()` defaults to `type = "continuous"`**, and `ace.continuous` does not
  know the discrete model name `"ER"`: it returns a list whose only component is
  `call`, with no error and no warning, so every marginal lookup fails silently.
* **`read.delim(fileEncoding = "UTF-8")` under `LC_CTYPE=C`** mangles and drops
  the rows carrying Chinese state labels, which turns a ten-character comparison
  into a silent one-character one. `read_tsv` in `ape_agreement.R` reads the bytes
  and tags them, so the script is correct in either locale.
* **`system2()` cannot build a command line containing a path the native encoding
  cannot represent**, so a repository under a non-ASCII directory makes the
  exported-script leg report "0 cost lines". That leg runs a copy of the script
  from the session's temporary directory and echoes the child's output whenever the
  counts disagree.
* **Two reader bugs** (in ape, not in the exported files): quoted labels
  containing spaces come back mangled, and `"Gracilicutes (GN)"` comes back as
  `GN`, so ape cannot round-trip its own writer's output for such names. Every leg
  of this comparison therefore builds its trees from `nodes.tsv`. The app's own
  exported script does not use `read.tree()` either, for the same reason: it
  assembles the tree from label vectors, because a mangled tip label silently turns
  that tip into missing data in its own analysis.
* **A truncated pipe is not a broken figure.** Piping a run of
  `cladeforge_analysis.R` through `head` kills R with `SIGPIPE`, and the
  half-written `cairo_pdf` output then looks blank (~1 kB, no font resources); the
  same command without the pipe writes ~42 kB. Check for a truncated pipe before
  treating an empty figure as a defect.
