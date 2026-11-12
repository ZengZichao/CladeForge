<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# Contributing to CladeForge

> 中文版：[CONTRIBUTING_ZH.md](./CONTRIBUTING_ZH.md)

Thanks for your interest in contributing. This document covers setup and the conventions we follow.

## Development setup

- **Node.js >= 20.19** (the `engines` floor in `package.json`) and the **Rust toolchain** (for the
  desktop shell). CI builds on the Node 20 line (`.github/workflows/ci.yml`: `node-version: 20`),
  which satisfies that floor; `vite 8` will not run on anything below 20.19.
- Install dependencies: `npm install`
- Start developing: `npm run dev` (web) or `npm run tauri dev` (desktop).

## Conventions

- **TypeScript strict mode** — `npm run typecheck` must pass with zero errors.
- **Tests** — we use Vitest. Add tests for any new pure-model logic (see `src/model`, `src/io`). Run with `npm test`.
  - Component tests are written as `*.test.ts` (not `.test.tsx`): `vite.config.ts` collects `src/**/*.test.ts` only, so a `.test.tsx` file is never run. Render with `createElement` and `createRoot`, and put `// @vitest-environment jsdom` on the first line.
  - No test may assert on wall-clock time. Prove a complexity claim with a work counter (node visits, height writes, ancestor hops) instead. The handful of timing guards that are kept for profiling are behind `CLADEFORGE_TIMING_GATE=1` and report as skipped in a normal run — set the variable to run them locally, never in CI.
- **UI strings** — all user-facing text lives in `src/ui/strings.ts` + `src/ui/i18n.ts` and must be provided in both English and Chinese.
- **Commits** — descriptive and imperative ("Add reconciliation validation", "Fix layout overflow").

## Pull requests

1. Fork and branch from `main`.
2. Keep changes focused; reference the relevant issue when applicable.
3. Run the full CI sequence locally before opening a PR — see below.
4. For large design changes, open an issue first to discuss the approach.

### What CI actually runs, and how to reproduce it

CI runs four jobs: `web`, `desktop`, `cross-check` and `audit`. The first three run on every
push and pull request; `audit` runs on the weekly schedule or by manual dispatch. CodeQL is a
separate workflow. Reproduce the relevant jobs before you push:

```bash
# web job
npm ci
npm run typecheck
npm test
npm run build

# desktop job — needed if you touched anything under src-tauri/
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# cross-check job — fixtures, R, ape/phangorn (needed if sample data or fixtures changed)
node scripts/cross-check/run-cross-check.mjs
```

The `cargo clippy` line is not optional. CI runs clippy with `-D warnings`, so a lint is a hard
failure there even though it looks advisory. If `cargo clippy` reports
`no such command: clippy`, the toolchain is missing the component:

```bash
rustup component add clippy
```

`npm run build` matters separately from `npm run typecheck`: it is the production bundle, and a
type-check plus unit tests will not catch a build-only failure.

## Use of generative AI

Generative-AI assistants were used in two ways while developing this software: (1) assisting
code writing, modification and refactoring, and (2) language polishing of the documentation
and of this repository's own text. Every generated patch was reviewed, executed against the
test suite and is owned by the maintainers, who take full responsibility for the result.

**Tool names, versions and per-file scope are recorded in
[`docs/AI_PROVENANCE.md`](./docs/AI_PROVENANCE.md)**, one row per release — plus rows for
unreleased working-tree batches (the rows labelled "Unreleased working tree …"). Where a file's
history cannot be attributed, that record says so instead of guessing. Two rules follow from it:

- A file listed there as AI-assisted carries a one-line marker in its module header
  (`// AI-PROVENANCE: …` in TypeScript/Rust, `<!-- AI-PROVENANCE: … -->` in Markdown). Strict
  JSON such as `src-tauri/tauri.conf.json` takes no marker — it has no comment syntax, and adding
  one would break the desktop build, which parses that file at compile time (`tauri_build` and
  `tauri::generate_context!`) — so its record lives in the table alone.
- When a change is AI-assisted, add or update the corresponding row in `docs/AI_PROVENANCE.md`
  in the same pull request, together with the tool name and version actually used.

No generative AI runs inside CladeForge. Every computation the application performs —
Sankoff parsimony, Mk/ER ancestral-state reconstruction, DTL reconciliation, consensus
trees, layout and export — is deterministic local code in `src/model`, `src/layout` and
`src/io`, and the tool works offline.

Contributors are asked to state, in the PR description, whether a generative-AI tool
produced any part of the change, and for what.

## Releasing

The tagged commit is what gets archived and cited, so it has to be self-contained. Before
tagging a release, check all of the following on the commit that will carry the tag — not on
`main` afterwards:

1. `npm run typecheck` and `npm test` pass; record the exact summary line (test files and test
   count) in the release notes, and pin any manuscript or README figure to the **tag**, since a
   later commit on `main` can change the count.
2. `CITATION.cff` exists **at the tagged commit** and its `version` / `doi` / `date-released`
   match the release being tagged. `CITATION.cff` was added after `v0.1.0`, so the archived
   `v0.1.0` tree does not contain it; that must not be repeated for a new release, because the
   archive is a machine-generated snapshot of the tag.
3. `docs/AI_PROVENANCE.md` gains a row for the release, with the tool name and version and the
   list of AI-assisted files, and each listed file carries its module-header marker.
4. `src-tauri/tauri.conf.json` `version`, `README.md` / `README_ZH.md` and
   `docs/MANUAL_EN.md` / `docs/MANUAL_ZH.md` state the same platform support floor and the same
   architectures as the artifacts actually produced for the release — a documented capability
   that has not been built is labelled as such (see the macOS arm64 statements in the README
   and the universal `.dmg` footnote in the User Manual).
5. The Zenodo concept and version DOIs resolve, and the version DOI added to `CITATION.cff`,
   `README.md` and `README_ZH.md` is the one minted for this tag.

## Scope note

The **reconciliation** module is complete and shipped with this version, but it remains the part of CladeForge whose interaction design has not settled yet (see the "Reconciliation polish" item under Roadmap in [README.md](./README.md)). Please open an issue before changing that module, so that effort is not spent on a design that is still moving.

## User documentation

The feature-by-feature reference lives in the [User Manual (English)](./docs/MANUAL_EN.md) and the [用户手册（中文）](./docs/MANUAL_ZH.md). The record of AI-assisted files per release is [docs/AI_PROVENANCE.md](./docs/AI_PROVENANCE.md). Security problems are handled outside the issue tracker — see [SECURITY.md](./SECURITY.md).

## Documentation language policy

Bilingual (English / 中文) documentation is a deliverable of this repository, not an afterthought.
Until now the rule existed only as a convention, visible in the cross-links at the top of each pair
of files, which left reviewers with nothing to cite. This section is that rule in writing: what must
ship in both languages, what "in both languages" actually requires, and what is deliberately
single-language — Chinese-only or English-only.

### Documentation language matrix

| Chinese file | English file | Delivery form | Status |
|---|---|---|---|
| `README_ZH.md` | `README.md` | Two files, one per language | Paired — required |
| `CONTRIBUTING_ZH.md` | `CONTRIBUTING.md` | Two files, one per language | Paired — required |
| `docs/MANUAL_ZH.md` | `docs/MANUAL_EN.md` | Two files, one per language | Paired — required |
| `scripts/cross-check/README_ZH.md` | `scripts/cross-check/README.md` | Two files, one per language | Paired — required |
| `docs/UI_GLOSSARY.md` | `docs/UI_GLOSSARY_EN.md` | Two files, one per language | Paired — required (English counterpart synced entry for entry against the Chinese glossary) |
| `docs/EMBEDDED_RECON_LAYOUT_PLAN_ZH.md` | `docs/EMBEDDED_RECON_LAYOUT_PLAN_EN.md` | Two files, one per language | Paired — required |
| `docs/GLOSSARY.md` | — | Chinese only | Exempt — historical comparison table |
| `docs/UI_STYLE_GUIDE.md` | — | Chinese only | Exempt — current normative guide, maintained in Chinese only |
| `docs/UI_FIX_REPORT.md` | — | Chinese only | Exempt — dated acceptance report |
| `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md` | same file | Single file, English and 中文 side by side | Permitted form for templates |
| — | `SECURITY.md` | English only | Exempt — English-only normative policy: it is the private-disclosure instruction itself (it names the one URL and the one email address a report must go to), and mixing languages in that text risks misrouting reports; no Chinese counterpart exists, and both README language versions link this same file |
| — | `CITATION.cff` | English only | Exempt by nature — a machine-readable bibliographic record: the CFF schema declares one language per record (`language`, an ISO 639-1 code) and has no Chinese counterpart fields to fill, so a translated twin would be a second citable entry for the same release |
| — | `LICENSE` | English only | Exempt by nature — the SPDX MIT text must stay verbatim; its copyright line already carries both language signatures (`曾子超 (Zichao Zeng)`) |
| `.github/ISSUE_TEMPLATE/config.yml` | same file | Single file, English and 中文 side by side | Paired — required: `name:` and `about:` are the strings GitHub shows in the issue picker, so each carries both languages in the form of Rules §4; `url:` and `blank_issues_enabled` are repository configuration and stay as they are |

File names in this matrix are written as code, never as links, so the table cannot rot when a
document is added, renamed or retired; the links a reader actually follows are the header
cross-links inside each paired file (`> 中文版：…` / `> English version: …`). `docs/UI_GLOSSARY_EN.md`
and `docs/EMBEDDED_RECON_LAYOUT_PLAN_EN.md` are introduced by this policy — the English counterpart
of the normative UI glossary, and the English counterpart of the roughly 1,500-line embedded-layout
algorithm contract that five source-header comments cite as their specification
(`src/model/reconPlacements.ts`, `src/model/reconPlacements.test.ts`, `src/layout/embeddedRecon.ts`,
`src/layout/embeddedRecon.test.ts`, `src/canvas/EmbeddedReconCanvas.tsx`). When those files land,
each gains its header cross-link and the matrix row above already covers it.

### Rules

1. **A pair is one document delivered twice.** Editing either side of any row marked
   *Paired — required* obliges you to edit the other side in the same pull request, and equivalence
   is structural, not just "the same idea": same number of sections in the same order, same table
   rows and columns, same numbers (test counts, version floors, DOIs, DPI values, thresholds), same
   commands and flags, same terminology, same caveats and exceptions. A one-sided edit is an
   incomplete change and is sent back rather than merged. Each side also links the other in its
   header line; a new pair needs both links.
2. **`docs/UI_GLOSSARY.md` is the single source of truth for normative UI terminology.** How a
   concept is written in the interface is decided there and nowhere else, and both sides of every
   paired document take their terms from it. Its English counterpart `docs/UI_GLOSSARY_EN.md` must
   be kept in sync entry for entry — the same concepts, the same recommended English and 中文 forms,
   the same "avoid" column. If the two ever disagree, `docs/UI_GLOSSARY.md` governs and the English
   file is corrected in the same pull request. `src/ui/copyQuality.test.ts` encodes the glossary's
   rules for the UI string catalogue as tests; it does not replace the glossary.
3. **`docs/GLOSSARY.md`, `docs/UI_STYLE_GUIDE.md` and `docs/UI_FIX_REPORT.md` are maintained in
   Chinese only.** This is a decision, not an omission — but the three are exempt for different
   reasons, and the reason matters when you edit them. `docs/GLOSSARY.md` is exempt **because it is
   a record**: it labels itself 历史对照（非规范性）at its top and hands the normative role for UI
   wording to `docs/UI_GLOSSARY.md`. `docs/UI_STYLE_GUIDE.md` is a **current normative document**
   and is exempt for the opposite reason — it governs how `src/ui/strings.ts`, inline `tr()` copy,
   notifications, exported figures and NEXUS comments are written (`docs/UI_STYLE_GUIDE.md`:5), and
   its :37 and :44 state that where existing code disagrees with the guide, the code is corrected to
   match the guide and the rule must not be relaxed in the other direction; it is Chinese-only because the
   project maintains it in Chinese for the people who review UI copy, not because its content is
   historical. `docs/UI_FIX_REPORT.md` is exempt **because it is a record**: a dated (2026-10-19)
   point-in-time acceptance report that states what was true then, not what the project promises
   now, and says so at its top. None of the three carries a translation obligation, and a reviewer
   should not ask for English twins of them. When `docs/GLOSSARY.md` or `docs/UI_FIX_REPORT.md` is
   edited, keep its "historical / non-normative" banner accurate; `docs/UI_STYLE_GUIDE.md` carries
   no such banner and must not acquire one. The matrix's English-only rows are the same argument
   seen from the other side: `SECURITY.md`, `CITATION.cff` and `LICENSE` carry no translation
   obligation either — the first is a policy decision, the other two are exempt by nature.
4. **Templates use a different, equally permitted form.** The three `.github/` templates listed in
   the matrix, together with the GitHub-visible strings of `.github/ISSUE_TEMPLATE/config.yml`
   (`name:`, `about:`), carry English and 中文 side by side in one file, because GitHub loads a
   single file per template and cannot serve a `*_ZH` sibling. A new template follows the same
   single-file bilingual shape, and a new `contact_links` entry follows the same bilingual `name:` /
   `about:` shape. Nothing else in the repository may cite that as a precedent for shipping a
   document in one language; the English-only rows in the matrix stand on their own reasons (policy
   text, machine-readable record, verbatim licence), not on this one.
5. **`docs/FORMAT.md` documents the `.cladeforge.json` data file format** — the schema the
   application reads and writes — **and says nothing about the language of documentation.** It is not
   authority for bilingual delivery, and a reference to it should name its subject ("the project
   file format, documented in docs/FORMAT.md") so that it is not read again as a document-language
   specification.
6. **Enforcement is by review, and this matrix is the checklist.** No CI job pairs the documents
   today, so the pull-request checklist item "Docs updated if needed" means: for every paired
   document you touched, the counterpart is updated in the same PR. State in the PR description
   which pairs were synced and which matrix rows were deliberately left alone. Adding, renaming or
   retiring a document means updating this matrix, in this file and in
   [CONTRIBUTING_ZH.md](./CONTRIBUTING_ZH.md), in the same change.
