# CladeForge

**An Interactive Phylogenetic Tree Editor for Evolutionary Scenario Construction and Hypothesis Generation**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23053393.svg)](https://doi.org/10.5281/zenodo.23053393)

---

[English](./README.md) | [中文说明](./README_ZH.md)

---

CladeForge is a local-first, cross-platform desktop application for building, annotating, and exporting phylogenetic trees with an integrated evolutionary semantic layer. It reframes the phylogenetic tree as a "hypothesis scaffold"—a canvas for constructing, comparing, and refining evolutionary scenarios.

Built on **Tauri v2 + React 18 + TypeScript + Vite** with a Rust backend.

## Features

- **Interactive tree editing** — Rooted trees with binary/ternary/polytomy branching, node and branch styling, collapse/expand, rerooting, ladderize.
- **Multiple layouts** — Rectangular cladogram, rectangular phylogram, time-calibrated (with geological era bands), and circular; four orientations (LR/RL/TB/BT); auto and manual layout modes.
- **Character/state system** — Discrete and continuous characters with color-blind-friendly palettes; Sankoff step matrices for asymmetric evolutionary costs.
- **Evolutionary events** — 15 built-in event types across six groups (Speciation, Extinction, Key evolution, Gene flow, Biogeography, and a General group whose single member is the user-definable custom event), each marked with a distinct two-letter code and colour, with causal-chain links.
- **Hypothesis layers** — Manage multiple competing hypotheses on a shared topology; tip states shared, internal-node hypotheses diverge.
- **Inference assistant (advisory)** — Sankoff parsimony suggestions, Mk-model probabilistic ASR (log-space numerically stable), consistency checks, character-correlation hints (Jaccard co-change).
- **DTL reconciliation** — Gene-tree/species-tree analysis with a dynamic-programming solver, manual refinement, validation, and side-by-side reconciliation view.
- **Time calibration** — Fossil calibration points, geological era bands, and environmental event overlays.
- **Import/Export** — Newick and Nexus import (with NHX metadata round-tripping); project files in `.cladeforge.json`; image export to SVG/PNG/PDF with auto-generated legends; hypothesis JSON export.
- **Undo/redo** with structural sharing via Immer; bilingual UI (English/中文).

## System Requirements

| Platform | Minimum OS | Architecture | Disk Space | RAM |
|----------|-----------|-------------|-----------|-----|
| macOS | 11.0 (Big Sur) | arm64, x86_64 | 12.4 MiB measured (v0.1.0, arm64 bundle; installer image 4.6 MiB) | 512 MB |
| Windows | 10 (64-bit) | x86_64 | not yet measured — no Windows build has been produced | 512 MB |
| Linux | glibc ≥ 2.28 | x86_64 | not yet measured — no Linux build has been produced | 512 MB |

The application ships no browser engine of its own, but it renders into the operating system's
own web view (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), which must therefore
be present on the host; no other runtime (Java, Python, or Node.js) is needed to run the app.

## Installation

### Pre-built binaries

Pre-built installers are attached to GitHub Releases once a release has been published:

- **macOS**: `.dmg` (both Apple Silicon and Intel)
- **Windows**: `.msi` (x64)
- **Linux**: `.deb` or AppImage

If the Releases page carries no build for your platform yet, use the source build below: it is
the primary installation path and produces the same installers.

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

**Prerequisites for source build:** Node.js ≥ 18, Rust toolchain ≥ 1.70, npm.

## Quick Start

1. Open or create a project (`.cladeforge.json`).
2. Edit the tree in the main canvas — right-click a node for topology operations (add branches, insert parent, reroot, delete, collapse).
3. Use the side panels to define characters, assign states, place events, manage hypothesis layers, and set calibration points.
4. Run inference assistants (parsimony, Mk ASR, consistency checks) for advisory suggestions.
5. Export via the export panel: SVG/PNG/PDF for figures, Newick/Nexus for trees, JSON for hypothesis archival.

## Project File Format

CladeForge projects are stored as JSON (`.cladeforge.json`), schema version `0.1.0`.

## Documentation

- [User Manual (English)](./docs/MANUAL_EN.md) — the complete feature-by-feature reference
- [用户手册（中文）](./docs/MANUAL_ZH.md) — 完整的功能详解手册
- [Contributing Guide](./CONTRIBUTING.md) · [贡献指南（中文）](./CONTRIBUTING_ZH.md)

## Roadmap

- [x] Gene-tree/species-tree reconciliation (DTL-style)
- [ ] Reconciliation polish: drag-to-map in the side-by-side view, multi-gene aggregate overlays
- [ ] Embedded reconciliation layout (project gene trees onto the species tree canvas)
- [ ] Forward simulation engine for hypothesis testing
- [ ] Plugin architecture for third-party inference tools
- [ ] Collaborative workspaces

## License

Released under the [MIT License](./LICENSE).

## Citation

Every tagged release is archived on Zenodo with its own citable DOI. Cite the version you ran; the
concept DOI always resolves to the newest archived version.

- **Concept DOI (all versions):** [10.5281/zenodo.23053393](https://doi.org/10.5281/zenodo.23053393)
- **v0.1.0 (this release):** [10.5281/zenodo.23053394](https://doi.org/10.5281/zenodo.23053394)

> Zeng, Z. (2026). *CladeForge* (Version v0.1.0) [Computer software]. Zenodo.
> https://doi.org/10.5281/zenodo.23053394

No journal citation is available yet. The machine-readable form is in [`CITATION.cff`](./CITATION.cff).

## Funding

This project has received funding from national research programmes. Grant identifiers will be
listed in this section once they can be disclosed.
