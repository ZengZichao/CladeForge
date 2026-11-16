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

### 2026-11-16 (2) — Kimi Code: coordination-canvas polish round (用户反馈 ×12)

- `src/canvas/ReconWorkspace.tsx` — the recon toolbar is a FULL-WIDTH top row;
  side panels start below it, so the gene picker and the edit-target switch
  keep one fixed left edge in all three modes.
- `src/ui/ReconPanel.tsx` — single left panel slimmed to 视图 (top) + 节点映射
  (bottom): tree management, 演化事件, costs and the search box removed; the
  gene-tree builder dialog (entry points gone, superseded by 基因树编辑) is
  deleted with its App wiring and catalogue keys.
- `src/canvas/EmbeddedReconCanvas.tsx`, `src/ui/ReconStatusBar.tsx` — the
  in-canvas header (title/subtitle/count/zoom) and the Alt-click hint bar are
  gone; the embedded zoom slider + 1:1 ride the status-bar readout via
  `cladeforge:embedded-zoom(-reset)` events.
- `src/canvas/ReconciliationView.tsx` — panes keep the document's layout type
  (phylogram / time-calibrated) and only force orientation, so branch-length
  edits show identically in 协调树编辑; new `reconClickTarget` store switch
  gates plain clicks per pane (悬停高亮保持可用).
- `src/ui/ReconToolbar.tsx` — 点选目标：物种树/基因树 segment.
- `src/ui/ReconInspector.tsx` — 「把所选基因节点映射到这里」is always
  enabled; without a gene selection it switches the click target and explains
  the next step instead of showing a disabled button.
- `src/ui/GeneAssumptionInspector.tsx` — confidence block, centre-target
  button, losses field, unresolved walker and the owning-tree header removed;
  枝内位置 label caption dropped.
- `src/ui/MenuBar.tsx` — help trigger loses the "?" icon; the four top-level
  buttons share one boxed shape.
- `src/ui/i18n.ts`, `src/ui/PreferencesMenu.tsx` — stored language preference
  gains 跟随系统 ('system' resolved against the OS locale); 重置本地数据 is a
  red-fill white-ink button set apart from the option rows.
- `src/canvas/EventLayer.tsx`, `src/io/hypothesisExport.ts` — confidence
  labels read via static members (string-usage guard + live binding).
- Tests: `layoutFixes`/`copyQuality` updated for the new panel and the pruned
  catalogue; dead keys removed from both locales.

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
