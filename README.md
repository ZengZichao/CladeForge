<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# CladeForge

**An Interactive Phylogenetic Tree Editor for Evolutionary Scenario Construction and Hypothesis Generation**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23053393.svg)](https://doi.org/10.5281/zenodo.23053393)
[![CI](https://github.com/ZengZichao/CladeForge/actions/workflows/ci.yml/badge.svg)](https://github.com/ZengZichao/CladeForge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![ORCID](https://img.shields.io/badge/ORCID-0000--0001--6553--970X-a6ce39?logo=orcid&logoColor=white)](https://orcid.org/0000-0001-6553-970X)

---

[English](./README.md) | [中文说明](./README_ZH.md)

---

CladeForge is a local-first, cross-platform desktop application for building, annotating, and exporting phylogenetic trees with an integrated evolutionary semantic layer. It reframes the phylogenetic tree as a "hypothesis scaffold"—a canvas for constructing, comparing, and refining evolutionary scenarios.

Built on **Tauri v2 + React 18 + TypeScript + Vite** with a Rust backend.

## Features

- **Interactive tree editing** — Rooted trees with binary/ternary/polytomy branching, node and branch styling, collapse/expand, rerooting, ladderize.
- **Multiple layouts** — Rectangular cladogram, rectangular phylogram, time-calibrated (with geological era bands), and circular; four orientations (LR/RL/TB/BT); auto and manual layout modes.
- **Character/state system** — Discrete and continuous characters with color-blind-friendly palettes; Sankoff step matrices for asymmetric evolutionary costs.
- **Evolutionary events** — 27 built-in event types across nine groups (26 predefined + 1 custom): Speciation (4), Extinction (2), Evolutionary innovations (3), Gene flow (2), Biogeography (3), Microbial (9), Gene family evolution (2), Deep time (1), General (1). Each type has a unique two-letter code; the palette may reuse colours. Events link into causal chains.
- **Hypothesis layers** — Manage multiple competing hypotheses on a shared topology; tip states shared, internal-node hypotheses diverge.
- **Inference assistant (advisory)** — Sankoff parsimony suggestions, Mk-model probabilistic ASR (log-space numerically stable), consistency checks, character-correlation hints (Jaccard co-change).
- **DTL reconciliation** — Gene-tree/species-tree analysis with a dynamic-programming solver, manual refinement, validation, and two canvas layouts: the side-by-side view and the embedded view (thick species tubes with the gene lineages nested inside, Alt+click path building, and embedded-figure SVG export).
- **Time calibration** — Fossil calibration points, geological era bands, and environmental event overlays.
- **Import/Export** — Newick and NEXUS import (NEXUS reads `TREES` **and** `DATA`/`CHARACTERS`/`ASSUMPTIONS` blocks; Newick keeps bracket comments verbatim and interprets `&support`, `&R/&U`, BEAST `height`/`height_95%_HPD`/`posterior` and NHX tags — other comment text is preserved as text, not interpreted); CSV/TSV character-matrix and annotation tables in, matrix/annotation/template CSVs out; NeXML export; project files in `.cladeforge.json` (schema documented in `docs/FORMAT.md`); image export to SVG/PNG/PDF with an export-settings dialog (DPI control, opt-in support values, scale bar, legend toggle) and auto-generated legends; hypothesis JSON + Markdown narrative + a self-contained R analysis script.

**Scope statement.** CladeForge is a hypothesis-editing and argumentation
workbench. It does NOT build trees, align sequences, fit Bayesian dating
models, or search topologies; every inference it shows is conditional on the
single, user-edited topology in the document. The Mk reconstruction fits a
one-dimensional rate by maximum likelihood but implements only the
equal-rates (ER) sub-model.
- **Undo/redo** with structural sharing via Immer; bilingual UI (English/中文).

## System Requirements

| Platform | Minimum OS | Architecture | Disk Space | RAM |
|----------|-----------|-------------|-----------|-----|
| macOS | 11.0 (Big Sur) | arm64, x86_64 | 12.8 MiB measured (v0.2.0 arm64 bundle; installer 4.8 MiB); v0.3.0 not re-measured | 512 MB |
| Windows | 10 (64-bit) | x86_64 | v0.2.0 release includes `.msi`; size not measured | 512 MB |
| Linux | glibc ≥ 2.28 | x86_64 | v0.2.0 release includes `.deb`/AppImage; size not measured | 512 MB |

The application ships no browser engine of its own, but it renders into the operating system's
own web view (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), which must therefore
be present on the host; no other runtime (Java, Python, or Node.js) is needed to run the app.

## Installation

### Pre-built binaries

What is actually attached to a release varies by version, so this is stated per release rather
than promised for all of them. Check the [Releases page](https://github.com/ZengZichao/CladeForge/releases)
for what a given tag carries.

- **Unreleased (working tree)** — the built-in samples are reduced from seven to three
  feature-oriented demos (`feature-tour`, `large-tree`, `recon-family`) with all real biological
  background removed; numeric structure is unchanged and the cross-check fixtures were regenerated.
  See the [Unreleased] section of the CHANGELOG for details.
- **v0.3.0** — tagged release line, published with artifacts from
  `.github/workflows/release.yml` (see the [Releases page](https://github.com/ZengZichao/CladeForge/releases/tag/v0.3.0)).
- **v0.2.0** — release page assets: `.dmg` for macOS on both Apple Silicon and Intel, `.msi`
  for Windows x64, and `.deb` plus an AppImage for Linux x86_64 (macOS bundle 12.8 MiB;
  installer 4.8 MiB; Windows/Linux sizes not measured). This version repairs the
  window-drag regions, rebuilds all sample projects around strictly binary fictional taxa
  named `Taxon_*`, and adds per-event marker customisation (shape / size / colour / inner text).
- **v0.1.0** — one artifact only: `CladeForge_0.1.0_aarch64.dmg` (macOS, Apple Silicon).
  No Intel, Windows or Linux build was produced for this version, and it was built by hand
  rather than by `.github/workflows/release.yml`.

These artifacts are **unsigned**. macOS Gatekeeper will refuse to open them on first launch;
see the note below.

If the Releases page carries no build for your platform, use the source build below: it is a
supported path and produces the same installers locally.

<details>
<summary>macOS: opening an unsigned build</summary>

Right-click the `.dmg` → **Open** → confirm. Or, to trust it for this machine only:

```bash
xattr -d com.apple.quarantine CladeForge.app   # after copying it out of the dmg
```

</details>

### Build from source

```bash
git clone https://github.com/ZengZichao/CladeForge.git
cd CladeForge
npm install
npm run dev            # web dev server (no Rust needed)
npm run tauri dev      # desktop dev build (requires Rust)
npm run build          # type-check + build the web frontend
npm run typecheck      # TypeScript strict check
npm test               # run the Vitest suite
npm run tauri build    # build the packaged .app / installer
```

**Prerequisites for source build:** Node.js ≥ 20.19, Rust toolchain ≥ 1.90, npm. The Node floor is
`>=20.19` in `package.json` and is the same version CI builds with — see the note in
`ci.yml` on why it is 20 rather than a newer major.

## Quick Start

1. Open or create a project (`.cladeforge.json`).
2. Edit the tree in the main canvas — right-click a node for topology operations (add branches, insert parent, reroot, delete, collapse).
3. Use the side panels to define characters, assign states, place events, manage hypothesis layers, and set calibration points.
4. Run inference assistants (parsimony, Mk ASR, consistency checks) for advisory suggestions.
5. Export via the export panel: SVG/PNG/PDF for figures, Newick/NEXUS for trees, JSON for hypothesis archival.

## Project File Format

CladeForge projects are stored as JSON (`.cladeforge.json`), schema version `0.2.0`.

## Documentation

- [User Manual (English)](./docs/MANUAL_EN.md) — the complete feature-by-feature reference
- [用户手册（中文）](./docs/MANUAL_ZH.md) — 完整的功能详解手册
- [Contributing Guide](./CONTRIBUTING.md) · [贡献指南（中文）](./CONTRIBUTING_ZH.md)

## Roadmap

- [x] Gene-tree/species-tree reconciliation (DTL-style)
- [ ] Reconciliation polish: drag-to-map in the side-by-side view, multi-gene aggregate overlays
- [x] Embedded reconciliation layout (project gene trees onto the species tree canvas): thick species tubes with nested gene lineages, Alt+click path building and SVG export
- [ ] Forward simulation engine for hypothesis testing
- [ ] Plugin architecture for third-party inference tools
- [ ] Collaborative workspaces

## License

Released under the [MIT License](./LICENSE).

## Citation

Every tagged release is archived on Zenodo with its own citable DOI. Cite the version you ran; the
concept DOI always resolves to the newest archived version.

- **Concept DOI (all versions):** [10.5281/zenodo.23053393](https://doi.org/10.5281/zenodo.23053393)
- **v0.1.0:** [10.5281/zenodo.23053394](https://doi.org/10.5281/zenodo.23053394)
- **v0.2.0:** the version DOI is assigned by Zenodo when the release is archived.
- **v0.3.0:** [10.5281/zenodo.24108672](https://doi.org/10.5281/zenodo.24108672) (archived 2026-11-10).

> Zeng, Z. (2026). *CladeForge* (Version v0.3.0) [Computer software]. Zenodo.
> https://doi.org/10.5281/zenodo.24108672

No journal citation is available yet. The machine-readable form is in [`CITATION.cff`](./CITATION.cff).

## Funding

This project has received funding from the National Natural Science Foundation of China
(grant nos. 42422209 and 42272354) and the National Key Research and Development Program of
China (grant no. 2023YFC3108600).
