<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# Changelog

All notable changes to CladeForge are documented here. Format: Keep a
Changelog 1.1.0; versions follow [SemVer](https://semver.org) while pre-1.0.

## [Unreleased]

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
- Export options… (导出选项…) is reachable again: the export-settings dialog
  (preset mode, DPI, support values, legend, scale bar, grayscale,
  background) was registered but no UI called it, so every figure button
  exported directly. Added to the top of the Export panel and the File
  menu's FIGURES group.

#### Added
- Regression test: the circular time wheel keeps the root at the centre and
  same-age tips on separate rim positions (`autoLayout.test.ts`).

### Review round 2 — fixes for the four review reports (PM / domain expert /
journal editor / postdoc), grouped by theme. Every entry closes one or more
numbered findings from `CladeForge-审查文档/`.

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

### [0.2.0] — 2026-10-29
Initial tagged release line: local interactive phylogenetic tree editor with
character/event/hypothesis layers, time calibration, DTL reconciliation,
Sankoff/Mk inference assists, SVG/PNG/PDF export, zh/en UI.

### [0.1.0] — earlier
Internal development line (single-arm64 build).
