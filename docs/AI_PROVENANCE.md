<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# AI-use provenance

This project was developed with the assistance of generative-AI tools. The tools
used, the underlying LLMs and what they were used for are listed below. Every
AI-generated change was reviewed and tested by the author, who takes full
responsibility for it. Source files that received AI-assisted changes carry a
one-line `AI-PROVENANCE` marker in their header.

## AI tools used

- DeepSeek Harness
- Qoder
- ZCode
- Kimi Code
- TRAE
- Codex
- Claude Code
- VSCode
- WorkBuddy
- CodeBuddy
- CatPawAI

## LLMs used

- DeepSeek
- Kimi
- GLM
- Qwen
- ChatGPT
- LongCat
- Hy3
- Hy4
- Xiaomi MIMO

## What the AI was used for

- Writing code — features, bug fixes and tests
- Writing software documentation — README, user manual, review reports

## Change log (AI-assisted)

### 2026-11-16 — Kimi Code: reconciliation workspace restructure (用户反馈 round)

- `src/model/store.ts` — `ReconEditTarget` gains `'recon'`; new gene-document
  edit swap (`GeneEditBackup`, `enterGeneDocEdit`, `exitGeneDocEdit`,
  `persistedProject`) so 基因树编辑 runs the standard editor on the gene doc;
  tab-switch / load guards merge the doc back before parking a snapshot;
  `markSaved` is swap-aware.
- `src/canvas/ReconWorkspace.tsx` — the 基因树/场景/视图 rail is gone: ONE
  plain stacked left panel; 物种树编辑 / 基因树编辑 render the standard
  workspace (same panels + mouse gestures).
- `src/canvas/ReconciliationView.tsx` — the blank stage's four build/import
  entries become 新建协调视图 / 导入协调视图.
- `src/ui/ReconToolbar.tsx` — three-way edit-target switch
  (物种树编辑 / 基因树编辑 / 协调树编辑); canvas-only controls hide on the
  tree-edit surfaces.
- `src/ui/ReconPanel.tsx` — the single panel shows every section, 视图
  included.
- `src/ui/ReconStatusBar.tsx` — section-jump links retired (plain readouts).
- `src/ui/ReconRail.tsx` — deleted (no references left).
- `src/ui/strings.ts`, `src/ui/ShortcutsDialog.tsx` — legend copy
  (末端映射 / 内部映射 / 没有映射), new empty-stage + edit-target strings,
  search-hint copy aligned with the single panel.
- `src/App.tsx`, `src/io/fileActions.ts` — autosave / save persist the merged
  project while swapped; zoom/fit/search shortcuts route by the ACTIVE
  surface.
- `src/styles/app.css` — `.recon-edit-column` layout for the tree-edit modes.
- `src/model/store.test.ts`, `src/ui/layoutFixes.test.ts` — swap round-trip,
  no-dirty-exit, tab-park guard, persistedProject; blank-stage assertions
  updated to the two new entries.
