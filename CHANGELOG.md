<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# Changelog

All notable changes to CladeForge are documented here. Format: Keep a
Changelog 1.1.0; versions follow [SemVer](https://semver.org) while pre-1.0.

## [Unreleased]

### Added — embedded (nested) reconciliation layout
- **A second reconciliation canvas mode, side-by-side vs nested view** (toolbar labels
  `并排对照`/`嵌套视图` in zh, `Side-by-side`/`Embedded` in EN): the nested view draws the
  species tree as THICK branch tubes (default 18 world px, adaptive up to 32 with an overflow
  badge) plus vertical hub bars, and nests the gene tree's THIN (≈1.25 px) event-coloured
  lineages INSIDE those tubes through an SVG mask — speciation σ sends children into different
  sub-tubes, duplication δ runs parallel lanes within one tube, horizontal transfer τ draws a
  donor→recipient cross-tube arc (dashed when time-infeasible, annotated when time-unchecked),
  and gene loss λ leaves a stub at each path fork. The mode is switchable from the reconciliation
  toolbar; the side-by-side view is unchanged and remains the default.
- **Honest display rules**: internal gene nodes without an assumption are DISPLAY-INFERRED to
  their children's MRCA (dashed, never written into `assumptions`, no change to validation or
  counts — the `recon-family` sample's β4 stays connected); truly unmapped nodes land in a
  labelled orphan gutter instead of vanishing; structural losses distinguish inferred /
  asserted-covered / asserted-below-minimum states (λ, λ, λ!).
- **Path building in the nested view**: Alt + click a species tube maps the selected gene node onto
  that branch AND records the clicked within-branch position (`branchFraction`, persisted);
  the DTL assumption inspector gains a branch-position slider (with an Auto reset) and a
  transfer-donor select (`transferDonor`, persisted). Applying a DTL scenario keeps these visual
  fields only where the mapping target is unchanged; project files clamp `branchFraction` into
  [0, 1] and drop dangling `transferDonor`s on load.
- **Embedded figure export**: the embedded-mode toolbar's **Export figure** button (`导出嵌套图`
  in zh) writes a standalone SVG of the nested figure — same geometry as the canvas, with legend
  and version metadata — for hypothesis documents. The reconciliation Markdown report and NHX
  output now carry a branch-position column (`枝内位置` in zh) and `BF=` / `TD=` tags so
  hand-built paths survive the round trip.
- View options for the nested mode (tube width, lane gap, transfer arcs, loss stubs) live in the
  reconciliation panel's View section (`视图` in zh); "Reset view settings" (`重置视图设置`) no
  longer kicks the user out of the nested mode.
- Documentation updated for the embedded view: README feature bullet + roadmap, the user manuals
  (Chinese and English — new nested-view (`嵌套视图`) sections plus toolbar/inspector
  descriptions), the UI_GLOSSARY/GLOSSARY terms species branch tube, hub bar, lane, branch
  position, transfer donor, loss stub, display-inferred and orphan gutter (their zh forms are the
  glossary rows themselves),
  docs/FORMAT.md optional path fields, and the layout plan marked as implemented.
  New tests: `src/model/reconPlacements.test.ts`, `src/layout/embeddedRecon.test.ts`,
  `src/io/embeddedReconExport.test.ts`.

### Changed — built-in samples reduced to three feature-oriented demos
- **Seven samples → three.** The catalogue now ships `feature-tour` (the default
  first-run project, rebuilt from the former `cetacean` structure), `large-tree`
  (from the former `archaea` structure) and `recon-family` (unchanged, opens straight
  into the reconciliation view). The `bacteria`, `virus`, `plant` and `animal`
  builders were removed. The empty-state grid, sample picker and manuals describe
  three feature-oriented demos rather than seven scientific cases.
- **No real biological background.** Samples demonstrate software features, not
  scientific cases: characters are now Character 1 / Character 2 (`性状 1`/`性状 2` in the zh
  locale) with neutral State A / B / C labels (`状态 A`/`状态 B`/`状态 C`), and events,
  calibrations, environmental markers and hypothesis
  evidence carry neutral code names (Event A, Environmental marker A, Illustrative evidence A …;
  `事件 A`、`环境标记 A`、`示例证据 A` in zh). Taxa stay the
  fictional `Taxon_*` codes. No real taxon, character, geological event or story
  remains in any sample name, description, state, event, calibration or evidence string.
- **Relabel, not rebuild.** Every numeric structure is preserved: tree topology, node
  ages, branch lengths, character/state counts, state assignments, Sankoff cost
  matrices, hypothesis-layer assignments and confidences, event types and triggers,
  calibration ranges, and environmental-event positions and colours are unchanged.
- **Cross-check fixtures regenerated.** The six old fixture directories were removed
  and `feature-tour/` + `large-tree/` regenerated; `recon-family/` and `er-control/`
  are byte-identical. `ape-agreement.tsv` was relabelled to the new sample/character
  ids with every numeric column preserved (the R leg re-runs in CI). The
  manifest↔agreement consistency gate passes and deterministic regeneration is
  byte-stable.
- **Legacy `sampleId` archives are preserved, never migrated.** A document carrying an
  old `sampleId` (`cetacean`, `archaea`, `bacteria`, `virus`, `plant`, `animal`) is no
  longer rebuilt on a locale switch: the catalogue lookup fails and the document stays
  as an ordinary user project. No schema migration and no user-data cleaning.
- Test contracts synced to the three-sample catalogue; the brute-force reference
  coverage guards now reflect it (Sankoff enumerated characters 6→2, exact Mk
  marginals 4→2, rate-sensitivity characters 11→4), with `er-control` and the
  synthetic trees unchanged.

### Fixed — review-report verification and repair round (2026-11-12/13)
Every finding of the 2026-11-12 review report (`CladeForge-审查报告-2026-11-12.md`, the
author's archive, not checked in) verified against the working tree — data-path findings
reproduced with throwaway scripts before touching code. Per-finding detail in
`docs/AI_PROVENANCE.md` (2026-11-13 row).
- **NEXUS matrix read-back**: `{…}` uncertainty cells parse as state sets at both consumers of
  `parseNexusMatrix`; the MATRIX keyword match uses a word boundary and a mis-scoped
  single-row warning is fixed; COSTMATRIX is reshaped as a flat row-major matrix — the app can
  re-import its own `COSTMATRIX=(0 2 3 0)` export.
- **Workspace autosave is non-finite-safe**: the `cf-nonfinite` tagged encoding applies to the
  autosave path too, and a self-reporting load-time repair fixes non-numeric/NaN cost-matrix
  cells. `docs/FORMAT.md` documents the wire format.
- **Embedded-reconciliation segments carry unique ids** (`edge#step`), eliminating React
  duplicate-key warnings; exports confirmed not to consume the raw id.
- **Project-aware custom event types** flow through display, legend, editor, narrative and SVG
  exports; the SVG arrow-marker fill is colour-sanitised.
- **Node deletion prunes stored-layer events/states/meta**, and layer write-back filters
  orphan events.
- **Desktop writes over 16 MB show a busy overlay** during the IPC hop.
- **`collapseBelowSupport` thresholds are on the 0–100 scale**; stochastic maps sample in log
  space (no underflow bias); NEXUS import honours the declared support convention.
- **Copy/export hardening**: CSV escaping in the matrix template, five export actions build
  their payload once, drop-path size pre-checks, a cancelled drag no longer marks a clean tab
  dirty, and switching the interface language no longer resets zoom/pan.
- **Desktop shell**: launch arguments are pre-filtered by the file-association extension table
  (with a Rust unit test); a failed staging write removes its tmp file.
- Documentation round in the same change: `docs/UI_GLOSSARY_EN.md` created as the mandatory
  English companion of `docs/UI_GLOSSARY.md`, the bilingual documentation audited and repaired,
  and `docs/AI_PROVENANCE.md` updated.
- Nine regression tests added; vitest suite green (97 files, 1201 passed / 6 skipped);
  `tsc --noEmit` and `vite build` clean.

### Fixed — the explicit transfer-donor assumption is honoured in the nested view (2026-11-13)
- **`resolveTransferDonor` read its explicit argument as a gene-child id, while the stored
  `assumptions.transferDonor` is a node of the outer species tree** — that is what the load-time
  repair in `src/io/projectIO.ts` validates it against, what `docs/FORMAT.md` documents, what the
  inspector's own hint says, and what `TD=` in the NHX export labels. The explicit value therefore
  never matched any child, and both embedded-layout call sites silently fell back to "the first
  child outside the recipient subtree": a gene tree with more than one placeable child drew one
  donor arc on the canvas while exporting another. The parameter is now
  `explicitDonorSpeciesNode`, matched against the children's effective placements, so the assumption
  wins when it names an outside species node some child occupies and auto-derivation still applies
  when it does not. `docs/EMBEDDED_RECON_LAYOUT_PLAN_EN.md` / `_ZH.md` §5.1 follow the signature.
- **Stale churn estimate in the sample-character comment** (`src/model/sampleTree.ts`): the pinned
  character ids hold the `character` column of thirteen committed fixture tables stable
  (`manifest.tsv`, `ape-agreement.tsv` and the per-character tables of the `feature-tour` and
  `large-tree` samples, ~300 data lines), not "five fixture files / ~1 500 lines".

### Changed — bilingual documentation translation audit round 2 (2026-11-13)

Every markdown EN↔ZH pair re-audited by a six-agent cluster with the code and the normative
glossary (`docs/UI_GLOSSARY.md`) as arbiters; structural equivalence (headings, tables, code
fences, links, anchors, numeric tokens, paragraph blocks) proven before and after by
independent scripts.

- `scripts/cross-check/README.md` + `README_ZH.md`: the join-failure condition was stated
  backwards on both sides — it fires when unresolved tips **exceed** the fixture's declared
  missing count (`ape_agreement.R` `sum(is.na(codes)) > declared_missing`), not when the lookup
  resolves fewer; corrected in both languages.
- `CONTRIBUTING.md` + `CONTRIBUTING_ZH.md`: documentation-language matrix completed (rows for
  `docs/AI_PROVENANCE.md`, `docs/FORMAT.md`, `CHANGELOG.md`); the "when those files land"
  cross-link statement updated to present reality; Rules 3/4 enumerations synced with the
  matrix; the CFF sentence corrected against the published CFF 1.2.0 schema (no language field
  for the record itself — `languages` exists only on `references` entries); ZH "在 20.19 以下
  无法运行" tightened to "在低于 20.19 的版本上无法运行".
- `docs/EMBEDDED_RECON_LAYOUT_PLAN_EN.md` + `_ZH.md`: the normative §5.1 signature aligned with
  the shipped `explicitDonorGeneChild?: NodeId` on both sides; the ZH fence comment
  「事件尚未解析」→「事件未定」 per the glossary's ban on 「未解析」.
- `docs/AI_PROVENANCE.md`: the "git log has seven commits" claim qualified as the 2026-10-08
  snapshot, and this round recorded.
- `docs/UI_STYLE_GUIDE.md` §3.8: the ShortcutsDialog wheel-row status updated to the shipped
  spaced form (`Ctrl/⌘ + wheel`).

### Security — dependency advisory triage (2026-11-13)

- **tokio patched to 1.53.3** (#64, `src-tauri/Cargo.lock`). RUSTSEC-2026-0386 covers `AsyncFd`'s
  safe constructors — `new`, `with_interest`, `try_new`, `try_with_interest` — as an I/O-safety
  violation with a use-after-free behind it, fixed from 1.53.3. No code under `src-tauri/src`
  constructs an `AsyncFd`, but `tauri`, `hyper`, `reqwest`, `tower` and
  `tauri-plugin-single-instance` all run on tokio, so the lock now carries the patched release. The
  `desktop (linux)`, `desktop (macos)` and `desktop (windows)` jobs compile and test it.
- **glib stays at 0.18.5, with the reason recorded** (`SECURITY.md`). RUSTSEC-2024-0429 /
  GHSA-wrw7-89jp-8q8g — Dependabot alert #36, medium — is unsound `VariantStrIter` iteration,
  patched only from glib 0.20. Tauri 2.12.5, the newest stable release, still requires `gtk ^0.18`
  on Unix, so no update reachable from this repository leaves the 0.18.x band, and no CladeForge
  code touches the affected iterators. The alert is dismissed as a tolerable risk
  (`tolerable_risk`) rather than quietly ignored — and deliberately not as `not_used`, because
  Tauri's own use of the GTK stack was never audited for that API — with the condition for
  revisiting it written into the security policy.
- How the triage was done, so it can be repeated without credentials: `npm audit` against
  `package-lock.json` (0 findings); the eleven pinned workflow actions checked against the GitHub
  advisory database for the `actions` ecosystem (no match); all 414 packages in
  `src-tauri/Cargo.lock` matched against a fresh clone of `RustSec/advisory-db` by explicit
  `patched` / `unaffected` range comparison (two hits, the two above).

## [0.3.0] — 2026-11-10

Published release line. Pre-built artifacts were produced by `.github/workflows/release.yml`
(unsigned); the entries below are the changes since v0.2.0.

### Review round A/B/C (the three review reports `CladeForge-评审报告-A/B/C`, zh for "review report A/B/C"; author’s archive, not checked in) — 2026-11-10. Every finding of
the three independent reviews repaired: 19 A-items, 8 H + 24 M B-items and the
28 C-item list, plus the component-level test gap the reviews flagged (H6).

#### Fixed — statistics honesty
- **Polymorphic tips no longer corrupt CI/RI (A-13)**: the shared observation
  guard `isObservedState` carried a `value is string` predicate while accepting
  arrays, so `discreteSignal` keyed its state counts on array OBJECTS — every
  polymorphic tip (e.g. the `(AB)` records a CSV import writes) became its own
  "state", inflating m (hence CI) and deflating g (hence RI) with no warning.
  A polymorphic tip now splits its evidence evenly across its member states,
  the guard returns a plain boolean so the compiler exposes string/array
  mix-ups, and the UI prints "N tips carry a polymorphic record" next to CI/RI.
- **ASR refuses to fabricate numbers (A-14/H7)**: a character with fewer than
  two scored tips, or whose rate profile is exactly flat (e.g. every tip the
  same all-state polymorphic set), is refused with a bilingual reason instead
  of printing r = 1e-12 with a 95% CI of [1e-24, 1e+14]. A profile-likelihood
  bound that leaves the scan bracket is reported as "undetermined", not as the
  bracket edge. The one-click parsimony baseline refuses on a character with
  zero scored tips instead of filling every internal node with the first
  declared state.
- **Rate-sensitivity argmax counts DISTINCT nodes** (a node flipping in both
  the 0.5× and 2× round counted twice); the copy states the semantics (A-19).
- **Permutation-test description corrected** (C#16): the UI said the test
  shuffles character B only, while the implementation (correctly) permutes
  BOTH characters — the copy now matches the method and the manual.
- **ASR threshold label** says ≥ (the implementation shows p == t), and the
  weighted-cost label no longer equates cost with change count (A-19).

#### Fixed — desktop shell (the "double-click / close" paths)
- **Unsaved-changes close guard (A-01/C#1)**: `CloseRequested` (window ×,
  Alt+F4, ⌘Q) now holds for a webview decision once the UI is up; a dirty tab
  shows the standard confirm, a clean workspace closes straight through. A
  close that arrives before the webview registered its listeners falls through,
  so a failed frontend load can never wedge the window shut.
- **File associations wired (A-02/C#3)**: launch arguments are collected and
  routed through the same open pipeline as ⌘O; the single-instance plugin folds
  a second launch into the running window, forwards its document paths and
  brings the window to front. Double-clicking an associated file no longer
  opens an empty app.
- **Desktop drag-and-drop repaired (C#2)**: the window sets
  `dragDropEnabled: false` so the HTML5 drop events the canvas already handles
  reach the webview; a legal Newick in a `.txt` file is now accepted (M21).
- **read/write hardening (M19/C#14)**: `read_text_file`/`read_binary_file`
  refuse non-regular files (a FIFO in an allowed directory used to block
  forever); `write_binary_file` carries a 512 MB ceiling; non-fatal write
  outcomes (parent-dir flush failure, leftover staging directory) travel back
  as warnings the webview toasts instead of disappearing into stderr.

#### Fixed — import/export correctness
- **Parse errors carry line/column and the offending line, bilingually**
  (H5/C#6): the Newick tokenizer keeps token positions and `parseErrorAt`
  reports "line L, column C, near: …"; NEXUS structural errors are bilingual
  and an unclosed `[` names itself as the root cause instead of surfacing as a
  misleading "No TREES block found" (M5); a failing NEXUS matrix read is
  reported instead of swallowed with its issues (C#18).
- **GBK/GB18030 files decode with a fallback and a notice (H4/C#7)**: browser
  opens decode strictly as UTF-8 and fall back to GB18030 (Chinese-locale
  Excel's default) with an explicit "re-save as UTF-8" note; the desktop path
  re-reads the bytes via a new `read_binary_file` command and decodes in the
  webview instead of dying on "stream did not contain valid UTF-8".
- **CSV/TSV structural problems are reported, never silently repaired (C#5)**:
  ragged rows (cell count ≠ header), key-empty skipped rows and a single stray
  cell flipping a mostly-numeric column from continuous to discrete all
  produce named, actionable notes.
- **Import report dialog (A-03/M4/C#15)**: the full note list survives the
  toasts (which now linger 12 s) and every truncation toast carries a
  "View all import notes" action opening a reviewable, copyable dialog.
- **projectIO/exportImage errors are bilingual** (A-04/C#20), the NEXUS matrix
  failure reports instead of vanishing (C#18), and the clipboard failure no
  longer points at a dialog that does not exist (C#11).
- **Export feedback is uniform (A-08/C#9/M20)**: every export toast names the
  file and its size (PDF/Newick/NEXUS/hypothesis/narrative/recon report
  previously got a bare "Exported" (`已导出` in zh); the correlation CSV goes through the same
  native save pipeline as every other export (A-06); the R-script export runs
  under the busy veil and its toast says what RUNNING the script needs
  (local R + ape, outputs land in the working directory) (M13).
- **NeXML polymorphic cells are announced** (C#10), the DTL worker fallback
  tells the user the solve moved to the main thread (M6), and
  `setAssumption` no longer silently deletes an assumption row on an invalid
  species target (M6).
- **Project files round-trip non-finite step-matrix costs** (∞ = forbidden
  transition) via a tagged encoding; `JSON.stringify(Infinity)` used to write
  `null` and poison the matrix on re-read.

#### Fixed — interaction and feedback
- **Analysis dialog is navigable (A-07/M1)**: a chip jump-nav scrolls to each
  statistics block (ASR included), and the run history is a native collapsible.
- **Command palette no-ops speak up (M3)**: reroot/collapse/extract-subtree
  with no selection say what is missing instead of closing silently.
- **Character and event deletion confirm, with the ⌘Z story stated (M7)**.
- **Backdrop clicks no longer destroy work (M11)**: the gene-tree builder
  confirms before discarding its draft; the analysis dialog confirms before
  discarding unsaved test results; the confirm dialog learned `onCancel`.
- **The ASR threshold slider takes effect immediately** (M9): the display set
  is re-derived from the stored posterior on every commit.
- **Interaction bookkeeping is defensive (M10)**: `live()` captures an
  interaction base when the caller skipped `beginInteraction` (so commit can
  always push history), and `cancelInteraction` restores the dirty marker the
  same way undo does.
- **ASR and the BM-null simulation show busy states** and disable re-entry
  (H1/A-15); the left analysis panel defers its heavy statistics off the
  interactive path (A-16).
- **Window title follows the active document with a dirty dot** (A-10); the
  language switch warns that the interface reloads, once, with an opt-out
  (A-11); the undo limit is configurable in preferences (100/300/1000) and the
  tooltip says so (A-12); tabs switch on click, not mousedown (M24); the
  single-tab ⌘W chord routes through the close guard on the desktop and explains
  itself in a browser (C#13); the File menu carries the tree-operations entries (`树操作`/`Tree`
  category) for reroot and
  ladderize, breaking the right-click-only entry point (C#27); the character
  editor ends with a forward "what next" prompt (M2); binary-export toasts name
  the chosen path and the browser save toast says "downloaded" instead of
  implying a path-bound file (C#9/C#19); sliders
  show their numeric value (M15) and the add-children clamp announces itself
  (M15); in-place saves ask before overwriting a file modified outside the app
  (M12, via a new `stat_file_mtime` command); the export panel always states
  which mode (follow-view vs preset) its buttons will use (A-05) and PNG honours
  the DPI setting in follow-view mode too (M8); a transparent-PNG option joins
  the export settings (M22).

#### Fixed — copy and docs
- DTL scope/ambiguity strings that existed but never rendered are now rendered
  next to the DP numbers they qualify (A-17); the four (1,2,1) cost fallbacks
  now reference `DEFAULT_RECON_COSTS` (A-09); the palette categories say the glossary term
  `协调` ("reconciliation", H3); the pseudo-plural `branch length(s)`, the `兄弟`/`同级`
  ("sibling" vs "peer") split and the
  zh/en sentence asymmetry are repaired (C#28).
- MANUAL_ZH terminology, quoted as the Chinese strings that were changed: `协同`→`协调`
  (reconciliation) throughout (UI_GLOSSARY compliance), `支持率`→`支持度` (support),
  `最近共祖`→`最近共同祖先` (most recent common ancestor), `多分叉`→`多歧枝` (polytomy);
  the support-threshold section now
  describes the control that actually exists in the style panel and its
  canvas+export effect (H2); version header 0.1.0→0.2.0; seven samples, not
  six; the TOC anchor and the `「场景 › 映射与事件」` ("Scenario › Mapping and events") pointer
  repaired (M14/C#17).
  MANUAL_EN: version header, sample count, and the residual Chinese in the
  shortcut table.
- CITATION.cff carries a bare version; a new `versionConsistency.test.ts`
  pins package.json / Cargo.toml / tauri.conf.json / CITATION.cff to one
  value (C#21).
- `yuleBalanceZScores` refuses a degenerate null instead of writing NaN into
  the result (M18); `consensus` clade stats drop a hidden O(clades × trees)
  indexOf (M23); `sampleStochasticMap` defaults to 100 samples (M16); the
  chars-as-bytes read ceiling is documented as deliberately conservative
  (C#22).

#### Added
- **Desktop backend compiled and unit-tested**: `cargo check` and `cargo test` now run in the
  development environment — the close guard, the `read_binary_file` / `stat_file_mtime` commands,
  the single-instance wiring and the widened write signatures compile clean, and the 11 `lib.rs`
  path-policy / atomic-write tests pass against the changed code.
- **Component-level tests (H6)**: `reviewComponentTests.test.ts` renders the
  Toaster, ConfirmDialog (onCancel contract), AnalysisDialog (jump-nav, no-data
  guard, busy disable), ImportReportDialog and the close-guard dirty test —
  the UI layer's first render-level suite, via the existing createRoot/jsdom
  pattern.
- Model-layer regression tests for the A-13 polymorphic counting, the A-14
  guards and the undetermined CI bound.

### Reconciliation-view lag (performance analysis `性能分析-协调视图卡顿`, zh for "reconciliation-view
performance analysis"; author’s archive, not checked in) — 2026-11-09. Every finding
of that analysis (§3.1–§3.5) repaired.

#### Fixed
- **Hover cascade**: the reconciliation panes now render nodes, edges and guide
  stubs as `React.memo` children whose props are world-space primitives, and
  the bridge layer memoises each path by value. Moving the pointer across the
  tree reconciles only the two nodes whose emphasis changed and their mapping
  lines instead of the whole canvas (thousands of SVG elements); selection
  membership uses a `Set` rather than a per-node `Array.includes`.
- **Pan/zoom**: wheel and pointermove events accumulate into a ref and commit
  at most once per animation frame — the same coalescing pattern as the main
  canvas (`21ec332`) — so a 125–1000 Hz input device no longer drives one React
  render per event; an interrupted gesture flushes the painted transform.
  Mapping lines are split into a world-space anchor pass (scope/emphasis/
  bundling decided without pane geometry) and a pure projection pass, so pans
  and zooms only re-project instead of re-running the rules.
- **Render scale**: both panes cull to the viewport plus one screen of buffer,
  so off-screen subtrees no longer mount; labels keep the existing zoom-based
  LOD. Pan/memoised rows mean a hover or pan touches a bounded number of DOM
  elements regardless of the imported tree size.
- **Repeated edit work**: `geneTreeRows` is cached per immutable project
  reference, so the panel, inspector and status bar share one
  validateScenario/scenarioSummary/mapTipsByLabel pass per edit; the
  reconciliation canvas reuses that row's summary and label-matched tip
  mappings instead of running its own copies.
- **DP freeze**: the DTL solver (including the polytomy replicate sweep) runs
  on a dedicated Web Worker with a synchronous fallback for environments
  without workers. Both DP buttons show a solving state, disable re-entry, and
  discard a result computed against a document that changed meanwhile.

#### Added
- Regression tests: world-space anchors/projection equivalence, per-project
  `geneTreeRows` cache identity, viewport-culling maths, mounted-pane wheel/pan
  coalescing and memoised hover (jsdom), hover → single emphasised bridge line
  integration (jsdom), async-DTL fallback equivalence, and the Worker protocol
  (request kind, worker reuse, error → synchronous fallback) — 5 new test files
  plus 2 extended ones (17 cases).

### Scientific-correctness and functional-test review round — 2026-11-07/08. Every
finding of that review (13 S-items, 28 M-items and the minor
§4 list) repaired, with 12 new regression-test files (66 cases) pinning the
review's independent reference values.

#### Fixed
- **Reroot edge identity**: the reversal now carries split support
  (value/kind/scale), branch style and branch-target events with the physical
  edge; node-anchored evidence stays on the vertex. A unifurcate old root is
  suppressed for 0 and 1 remaining children (no more fake unlabelled tip), an
  unknown length propagates as unknown instead of silently 0, and a root
  calibration follows the root rather than being re-read as a tip age.
- **Support-scale inference** reads only bare numbers directly after `)`, so a
  branch length of 12 or numeric tip names can no longer misclassify a file of
  0–1 posteriors as percent.
- **NEXUS matrices**: rows without TAXLABELS are one taxon per line; quoted
  TAXA keep their rows; interleaved chunks concatenate instead of overwriting;
  compact `01` cells expand to one column per character with `(`/`{`
  polymorphism groups intact; STATELABELS bind by declared symbol position;
  declared MISSING/GAP codes are honoured; CHARSTATELABELS is no longer
  misread as STATELABELS; SYMBOLS is read from the raw (unmasked) text. The
  writer emits a numbered STATELABELS and parenthesised polymorphs.
- **Project reload** preserves every known-but-optional field (custom event
  types, analysis runs, recon options, provenance, save path, timestamps,
  sampleId) — analysis history and the custom event catalogue survive a
  save/open cycle; a real migration re-stamps the schema version.
- **Statistics**: faithPd counts the connecting internal branches with an
  explicit root convention (picante-style); Fritz–Purvis D is rebuilt on
  sister-tip contrasts with declared-order binarisation and the standard
  (obs − BM)/(rand − BM) scale; Blomberg K uses the published GLS-centred
  estimator (661/600 on the review's asymmetric-tree counterexample) and the
  BM simulation computes the same statistic (two-sided p = 1/401 invariant
  under a change of units); NRI/NTI carry the standard
  positive-is-clustered sign.
- **Analysis engines**: stochastic mapping samples child states from
  transition × subtree likelihood and jump counts from the exact
  endpoint-conditioned uniformised law (a recorded zero branch stays zero);
  infeasible step matrices are reported (`feasible: false`) instead of scored
  0; model:'dollo' runs a true single-gain-per-tree DP (losses allowed, no
  re-gain) instead of an irreversible matrix wearing the name; DTL includes
  the root fee in the fixed-vs-free comparison and never buys a sampled
  lineage off with one loss (the exhaustive reference oracle was moved to the
  same standard convention); reconciliation losses follow junction arity
  (m−1 per hard polytomy, 0 through a unifurcation) and transfer timing is an
  interval-overlap check; a single-tree consensus keeps tip lengths.
- **Import**: matrix-only NEXUS files land as characters instead of dying on
  "No TREES block"; CSV tables honour quoted newlines, keep leading-zero
  identifiers as text, treat `(AB)` as a polymorphic set and escape state
  labels on export; Newick refuses unterminated quotes and truncating branch
  lengths; nested bracket comments parse; an explicitly rooted trifurcation
  round-trips via `[&R]`; BEAST brace-set HPD intervals and colon-separated
  NHX fields parse.
- **Layout/export**: exports reuse the layout's unknown-branch sets (a
  cladogram or fully dated time tree no longer exports dashed "unmeasured"
  branches the screen draws solid); the PDF computes grey colours explicitly
  (svg2pdf ignores SVG filters), renders CJK labels through the browser font
  engine (legible instead of garbage glyphs), clamps the page to jsPDF's
  14400-unit MediaBox, and PNGs carry a pHYs DPI chunk; transition markers and
  support text anchor ON elbow polylines; the scale bar reads the layout's own
  depthScale and is labelled substitutions/site (sqrt/log axes draw none);
  negative ages are unknown; the circular time wheel scales by visible nodes
  only and parks undated nodes on their topological level; deep trees no
  longer overflow the export, sort or consensus-decoration stacks.
- **Store**: undoing back to the saved document reports it clean; an `apply`
  inside an unfinished interaction folds into the interaction's single undo
  step (no half-finished drag resurrects on undo); cancelling restores the
  view; bulk sort-by-state runs inside the Immer draft and is usable again.

#### Added
- `npm run test:coverage` (opt-in; `@vitest/coverage-v8`, no thresholds):
  coverage is a gap visualiser, never a gate — the scientific oracles remain
  the correctness evidence. Total line coverage 63.2%, with the report
  exposing the UI-layer blind spots the review predicted.
- 12 regression-test files (66 cases) pinning the review's acceptance matrix:
  reroot identity, NEXUS matrix semantics, project-field persistence, the
  statistics oracles above, Dollo/feasibility, stochastic mapping, store
  history, export geometry, table handling, reconciliation losses, consensus
  lengths and the PDF export under real jsPDF/svg2pdf.

#### Notes
- The two timing-gate failures on a loaded workstation (2 000-tip `mkAsr`
  against the 400 ms budget) are unchanged by this round — the hot path was
  not touched; per the review, the budget needs recalibration on fixed
  hardware before it belongs in CI.

### UI design review round — 2026-11-06. Fresh headless-browser review of the
shipped UI (4 layouts × 2 themes × 2 languages × 5 viewports, all dialogs,
both workspaces) plus a code-level pass over the chrome; every confirmed
finding repaired.

#### Fixed
- Toasts no longer cover or click-block open menus: the toast stack sat above
  the dropdown/context-menu layers, so the layout-proposal toast hid the
  Preferences panel's language items for its whole TTL. Menus now layer above
  toasts (`.dropdown-panel`, `.context-menu`).
- Time panel · environmental events: the colour-hex readout overlapped the
  name input in the ~200 px rows (hex hidden there; the swatch already edits
  the colour), and the two per-field "Ma" chips squeezed both number inputs
  below two-digit width — "34"/"33.9" rendered clipped. One shared unit chip
  now follows the pair and the spin-button space is reclaimed.
- Time panel: the "Fill relative ages from topological depth (heuristic)"
  button overflowed the panel into the canvas; long panel buttons may now
  wrap (`.btn-multiline`).
- Switching layout type or orientation no longer keeps the previous zoom/pan:
  switching to Circular on the dated sample left most of the tree outside the
  viewport. Both switches fit the view, like the Re-layout button.
- Circular layout on a dated tree is the time wheel, and now matches its own
  description: the root sits at the CENTRE and present-day tips fall on the
  rim. The previous mapping put the root on the rim and collapsed every
  age-0 tip onto one shared centre point (overlapping markers/labels); the
  on-canvas notice and the Layout panel hint (now conditional on `hasAges`)
  describe the actual geometry. Stale comments corrected.
- **"Export options…"** (`导出选项…` in zh) is reachable again: the export-settings dialog
  (preset mode, DPI, support values, legend, scale bar, grayscale,
  background) was registered but no UI called it, so every figure button
  exported directly. Added to the top of the Export panel and the File
  menu's FIGURES group.

#### Added
- Regression test: the circular time wheel keeps the root at the centre and
  same-age tips on separate rim positions (`autoLayout.test.ts`).

### Review round 2 — fixes for the four review reports (PM / domain expert /
journal editor / postdoc), grouped by theme. Every entry closes one or more
numbered findings from the four review reports (author’s archive, not checked in).

#### Added
- CSV/TSV in and out: character-matrix import with a four-state label-join
  report (exact/normalised/unmatched/duplicate), annotation-table join,
  calibration-table import, matrix export, annotation export and an empty
  template export; Newick paste from the clipboard; matrix copy to clipboard.
  (PM-04/05/06/08/30/31, B8, U1, §10.1…)
- NEXUS is no longer a one-way door: `DATA`/`CHARACTERS`/`ASSUMPTIONS`
  (STANDARD + CONTINUOUS, SYMBOLS/STATELABELS, polymorphic `(xy)` cells,
  cost matrices) are read back; matrix-only files import as character sets;
  the exported NEXUS now carries a TRANSLATE table. (I1, §10.1, X9)
- NeXML export with the semantic layer (events, hypothesis layers, custom
  edges) as `cladeforge:` annotations. (I6)
- Robinson–Foulds / weighted-RF tree distances + tree-set spread
  (`model/treeDistance.ts`), surfaced through the command palette and usable
  against other open tabs and embedded gene trees. (B11, §7.1, P0-1)
- Hypothesis layers grew a body: statement, prediction, lifecycle status,
  evidence pointers, author, timestamps; per-layer record cards; an A/B diff
  view (per-node state differences + event adds/removes, click-to-focus).
  (PM-27/28, §2.8b, D5, U13)
- Analysis results are first-class: completed runs can be recorded into the
  project (method, parameters, fingerprint, software version), listed as a run
  history, cited (copyable method fingerprint) and exported to CSV. (PM-36/41,
  B4, §2.3)
- Mk rate is now ESTIMATED by maximum likelihood (1-D profile search),
  reporting r̂, lnL, a profile-likelihood 95% CI and a rate-sensitivity
  summary (max TV distance and argmax flips at 0.5×/2×); the moment
  convention stays available and labelled. ASR also gained joint (MAP)
  reconstruction, stochastic character maps, polymorphic-tip support and a
  missing-branch guard with an explicit unit-length fallback. (B3/M1, §5.1–5.7)
- Comparative methods: BM-simulation p-value for Blomberg's K, Yule-standardised
  Sackin/Colless z-scores, root-to-tip regression (RHD), Faith PD,
  MPD/MNTD/NRI/NTI, Fritz–Purvis D. (§8.1–8.3)
- Parsimony: ACCTRAN/DELTRAN optimisation options, MPR branch-rate sampling,
  polymorphic tip encoding, tolerant co-optimality (fractional step matrices),
  `Infinity` as a legal forbidding cost, cycle-guarded traversal, model presets
  (unordered/Wagner/Dollo). (§4.1–4.7, §3.1–3.2)
- DTL: random polytomy resolution with replicate spread reporting; gene-tree
  re-rooting; age-aware transfer feasibility; cost presets incl. an unbiased
  (1,1,1) default; tie-priority option; free-root now opt-in; ΔE placement-cost
  lists for pseudo-posteriors; many-to-one tip-mapping table import. (P0-5/6/7,
  §6.1–6.9, R5, PM-43)
- Figure export: settings dialog decoupled from the live view, DPI control for
  PNG with an explicit clamp notice, opt-in support-value printing, branch-length
  scale bar, dashed unmeasured branches, collapsed-clade +N badges, legend
  on/off, explicit white background, SVG/PDF metadata stamps. (PM-57…61,
  B12/F1, F9, PM-60)
- Error boundaries at the root and per workspace with copyable diagnostics.
  (B10, PM-55)
- Save in place (⌘S) with a remembered `sourcePath`, Save As (⌘⇧S), Revert to
  disk; real dirty flags on tabs (dot) and status bar; same-file tab dedup.
  (PM-49/51/52, U7)
- Context menu is keyboard-operable (⇧F10 opens it) with `role="menu"`;
  marquee selection (Shift/Alt + background drag); F2 rename; ⌘0 fit, ⌘W close
  tab, ⌘1–7 module jumps, ⌘/ shortcuts; collapse arrow is its own click target;
  trackpad pan/pinch semantics; screen-space hit-radius floor. (PM-17/18/21/65,
  §11.4–11.6, §6.5–6.8)
- Bulk structure ops (collapse/expand all, sort tips by character state);
  independent time-axis length + sqrt/log depth mappings; circular time-wheel
  layout; calibrated-age fitting (isotonic with fossil windows); derive branch
  lengths from ages. (§3.1/3.2, §9.1/9.2/9.5, §11.7/11.8, PM-25 partial)
- Event catalogue: microbial & deep-time presets (endosymbiosis, genome
  reduction, plasmid gain, CRISPR, HGT-from-unsampled-donor, …),
  user-defined event types stored in the project, CVD-safe default pairing of
  shape + code on every badge. (§4.7, M11, PM-32, §11.1)
- Preferences: UI scale, colour-vision-friendly mode, copy diagnostics, clear
  local data. (PM-80/89)
- Publication guardrails: topology-conditional statement on every statistics
  surface; ICS chart version stamp; geological ERAS rank + de-conflicted eon
  colours + Silurian boundary fix (443.4). (B4/M2, F5, §3.3)

#### Fixed
- Re-rooting no longer destroys non-active hypothesis layers' events and notes;
  layer pruning is counted and reported on load. (B1/D1, PM-29)
- A 1% bootstrap support value can no longer be read as 100%: support carries
  `kind` + `scale`, the import asks the convention, and one shared conversion
  replaced the two diverging heuristics. (B2/D4/P0-9)
- The correlation-test family is defined only by "a statistic exists"; the
  dialog's score-ranked cap is gone, replaced by a deterministic-key cap with
  "tested X of Y" disclosure, matching the manual. (B13/M4/X1)
- AnalysisDialog computes nothing while closed; every number declares its
  single-topology conditionality; consistency entries jump without closing.
  (PM-34/40, B4)
- ASR results go stale (visible, re-runnable) instead of vanishing on the next
  edit; switching characters no longer discards a run silently. (PM-36/37,
  §12.2)
- Newick: net-evolution syntax (`#H1`, `>H1`) is detected and loudly reported
  instead of silently dropped; BEAST `height`/`height_95%_HPD`/`posterior` /
  `ufboot` annotations and the app's own NHX tags parse into structured fields;
  the polymoties typo is gone. (P0-3, §5.2, §6.12)
- Layer state keys are stable (no more reset-on-rename drift), and section
  state survives renames via explicit storage keys. (PM-91)
- IO errors are bilingual through the string table. (PM-46)
- Dialog-approved working folders persist across restarts (desktop). (PM-53)

#### Changed
- Schema version 0.1.0 → 0.2.0 with a seeded migration; `appVersion` +
  timestamps stamped on save; unknown keys preserved and reported.
  (I9, §5.4, §1.5)
- DTL default costs are the unbiased unit vector (1,1,1); the conservative
  preset keeps the old behaviour. (P0-7)
- Event badges show their two-letter code by default (opt out per event).
  (PM-32/§4.7)
- CI gained a cross-check job (R + ape/phangorn, fresh agreement table,
  manifest↔agreement staleness gate) and the tip-scaling benchmark. (B6/E2/E3)

## [0.2.0] — 2026-10-29

Tag created 2026-10-26; release published 2026-10-29. `CITATION.cff` date-released
`2026-10-25` is the UTC date of the tag.

Initial tagged release line: local interactive phylogenetic tree editor with
character/event/hypothesis layers, time calibration, DTL reconciliation,
Sankoff/Mk inference assists, SVG/PNG/PDF export, zh/en UI.

## [0.1.0] — earlier
Internal development line (single-arm64 build).
