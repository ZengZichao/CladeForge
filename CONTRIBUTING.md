# Contributing to CladeForge

> 中文版：[CONTRIBUTING_ZH.md](./CONTRIBUTING_ZH.md)

Thanks for your interest in contributing. This document covers setup and the conventions we follow.

## Development setup

- **Node.js >= 18** and the **Rust toolchain** (for the desktop shell).
- Install dependencies: `npm install`
- Start developing: `npm run dev` (web) or `npm run tauri dev` (desktop).

## Conventions

- **TypeScript strict mode** — `npm run typecheck` must pass with zero errors.
- **Tests** — we use Vitest. Add tests for any new pure-model logic (see `src/model`, `src/io`). Run with `npm test`.
  - Component tests are written as `*.test.ts` (not `.test.tsx`): `vite.config.ts` collects `src/**/*.test.ts` only, so a `.test.tsx` file is never run. Render with `createElement` and `createRoot`, and put `// @vitest-environment jsdom` on the first line.
  - No test may assert on wall-clock time. Prove a complexity claim with a work counter (node visits, height writes, ancestor hops) instead. The handful of timing guards that are kept for profiling are behind `CLADEFORGE_TIMING_GATE=1` and report as skipped in a normal run — set the variable to run them locally, never in CI.
- **UI strings** — all user-facing text lives in `src/ui/strings.ts` + `src/ui/i18n.ts` and must be provided in both English and 中文.
- **Commits** — descriptive and imperative ("Add reconciliation validation", "Fix layout overflow").

## Pull requests

1. Fork and branch from `main`.
2. Keep changes focused; reference the relevant issue when applicable.
3. Ensure `npm run typecheck` and `npm test` pass before opening a PR.
4. For large design changes, open an issue first to discuss the approach.

## Use of generative AI

Generative-AI assistants were used in two ways while developing this software: (1) assisting
code writing, modification and refactoring, and (2) language polishing of the documentation
and of this repository's own text. Every generated patch was reviewed, executed against the
test suite and is owned by the maintainers, who take full responsibility for the result. The
assistants used were mainstream commercial code and text models; since those models are
updated continuously, no pinned version list is kept here.

No generative AI runs inside CladeForge. Every computation the application performs —
Sankoff parsimony, Mk/ER ancestral-state reconstruction, DTL reconciliation, consensus
trees, layout and export — is deterministic local code in `src/model`, `src/layout` and
`src/io`, and the tool works offline.

Contributors are asked to state, in the PR description, whether a generative-AI tool
produced any part of the change, and for what.

## Scope note

The **reconciliation** module is complete and shipped with this version, but it remains the part of CladeForge whose interaction design has not settled yet (see the "Reconciliation polish" item under Roadmap in [README.md](./README.md)). Please open an issue before changing that module, so that effort is not spent on a design that is still moving.

## User documentation

The feature-by-feature reference lives in the [User Manual (English)](./docs/MANUAL_EN.md) and the [用户手册（中文）](./docs/MANUAL_ZH.md).
