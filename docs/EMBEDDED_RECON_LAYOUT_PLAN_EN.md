<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# Embedded view (embedded reconciliation layout) — implementation plan

> **Language counterpart.** This document is the English counterpart of the Chinese design contract [EMBEDDED_RECON_LAYOUT_PLAN_ZH.md](./EMBEDDED_RECON_LAYOUT_PLAN_ZH.md); the two must be kept in sync. Section numbering, heading levels, and the algorithm contracts in §5 and §9.1 are normative on both sides — change one, change the other in the same commit.

> Status: **implemented** (Phases 1–4 all delivered, 2026-11-11)  
> Goal: add an `embedded` layout mode to the reconciliation workspace, drawing the gene tree nested inside the thick branches of the species tree  
> Related roadmap item: [README.md](../README.md) “Embedded reconciliation layout (project gene trees onto the species tree canvas)” (checked off)  
> Last updated: 2026-11-11  
> Where it was implemented: `src/model/reconPlacements.ts`, `src/layout/embeddedRecon.ts`, `src/canvas/EmbeddedReconCanvas.tsx`, `src/io/embeddedReconExport.ts`, plus the view / inspector / persistence / export wiring; for usage see [MANUAL_EN.md](./MANUAL_EN.md), section “Nested view (embedded layout)”

---

## Review record (2026-11-10)

This plan was checked item by item against the source code as it stood at review time, and revisions were made where problems were found. No project source code was modified during the review.

Method: every relevant source file was read, and the findings were compared against the behaviour the existing tests expect (in particular `sampleRecon.test.ts`, `projectIO.test.ts`, `reconMapping.test.ts`); this pass reviewed documentation only; the full test suite was not run.

**Facts confirmed as accurate**

- The reconciliation view really is a side-by-side structure of “two independent panes, independent layouts, a mapping bridge in between”; species-tree branches are a fixed 1.4 px stroke.
- `GeneNodeAssumption` currently only has `speciesNode`, `event`, `losses`, `meta`; there is no within-branch position field and no transfer donor field.
- `projectIO` preserves `assumptions` verbatim; `dtlScenarioToAssumptions` rebuilds the assumptions wholesale, so applying a DTL scenario must selectively keep or discard the visual fields.
- `mapTipsByLabel` only covers gene tips; internal nodes need an explicit assumption, or the “display inference” introduced by this plan.
- The gene tree β of the `recon-family` sample deliberately contains one unmapped internal node β4, whose children E/F can still be located by label mapping.
- The reconciliation view has no SVG/PNG/PDF graphics export at all today, only the Markdown reconciliation report.
- The dark-theme selector actually used is `:root[data-theme='dark']`, and there is additionally a `@media (prefers-color-scheme: dark)` system-dark branch.

**Key points of this revision**

1. Added display inference (MRCA placeholder) for internal nodes that have “no assumption but locatable children”; otherwise the sample node β4 would break the gene tree apart.
2. Changed the default derivation of the transfer donor to agree with `validateScenario` / `geneTreeNhk`: the donor is the species node that the child placed outside the recipient subtree sits on, not the branch the parent sits on.
3. Added a vertical hub bar to the species tree and included it in the SVG mask; otherwise the gene connector lines crossing between sub-tubes would be clipped away, and the species tree would not read as thick branches overall.
4. Made the loss display strategy explicit: the three cases “no assertion”, “assertion covers the structural minimum”, and “assertion below the structural minimum” are handled separately, and no unconditional claim of “λ equals the status-bar value” is made any more.
5. Moved “editable hypothesis / path building” from optional to a required deliverable (Phase 3), because it directly implements the user requirement to “build the evolutionary path yourself”.
6. Added the single-viewport zoom and status-bar wiring for `ReconWorkspace.tsx` / `ReconWorkspacePanel`.
7. Fixed the dark-theme selector and added the system-dark media query block.
8. Sanitised the characters of the mask id produced by `useId()`, to avoid the `url(#:r1:)` compatibility problem.
9. Clarified the “transfer branch takes precedence” rule and the annotation semantics of the transfer arc: when the child has `event === 'transfer'` that branch must NOT be drawn as an ordinary descent along the parent→child species path; in sample α the recipient of αAC is a descendant of the parent mapping, so the arc “donor child branch → recipient branch” has to be drawn first, the parent branch is a short τ-coloured dashed segment, and the arc never replaces a gene-tree topology branch.

---

## 0. Summary

The reconciliation view is today a side-by-side layout: “species tree on the left, gene tree on the right, joined in the middle by a mapping bridge”. This plan keeps that layout as the precise mapping-editing and audit view, and adds a new embedded layout:

- the species tree is the only skeleton, its branches drawn as relatively thick species branch tubes;
- the gene tree branches are drawn as thin lines, confined inside the species branch tubes by an SVG mask;
- speciation σ, duplication δ, horizontal transfer (HGT) τ and gene loss λ are expressed as: children entering different sub-tubes, a parallel fork inside the same tube, a cross-tube transfer arc, and a loss stub inside the tube;
- all geometry is computed once in world coordinates, and pan/zoom is a pure projection;
- a read-only embedded canvas is the first milestone; the final delivery must include Alt + click and optional drag-and-drop path editing, and must persist the branch position (`branchFraction`) and the transfer donor (`transferDonor`) into the project file.

Terminology (consistent with [UI_GLOSSARY.md](./UI_GLOSSARY.md)): **transfer donor** is shortened to “donor” below, **species branch tube** to “tube”; the **incoming branch** of a node = the branch between that node and its parent (i.e. “the branch of that node”, with the same wording for the species tree and the gene tree; a species branch id is its child node id, see §3.2); the remaining canonical terms are **transfer arc**, **hub bar**, **lane**, **loss stub**, **display inference** / **display-inferred**, **unmapped**, and unresolved topology is always described as a **polytomy**.

This file describes the implementation plan only; it contains no source code changes.

---

## 1. Goals and non-goals

### 1.1 Goals

1. Offer two canvas modes, “side-by-side / embedded”, in the reconciliation workspace, with side-by-side remaining the default so existing workflows do not regress.
2. The embedded mode uses a single coordinate system and a single viewport; the thick species-tree branches and the thin gene-tree branches share one world coordinate space.
3. Derive a deterministic gene-lineage path automatically from the existing `GeneNodeAssumption` (`speciesNode`, `event`, `losses`), without asking the user to supply data first; for “internal node without an assumption but with locatable children” use display inference (an MRCA placeholder) that is never written into the project.
4. Support inspecting the spatial position of σ/δ/τ/λ in the embedded view; losses are displayed according to the three states “asserted / structurally inferred / below the structural minimum”, so an inferred value is never disguised as an asserted one.
5. Provide persistable path-building fields: branch position `branchFraction` within the host branch, and transfer donor `transferDonor`; the user must be able to finish mapping and event editing inside the embedded view, without returning to the side-by-side view.
6. Support exporting the embedded figure as vector graphics, for papers or hypothesis documents.

### 1.2 Non-goals

- Do not modify the DTL dynamic-programming solver, the cost model, or the event semantics.
- Do not move gene-tree topology editing into the reconciliation view; the gene tree is still modified through the build dialog / the standard view. “Building a path” in this plan means editing mappings, branch positions, events, donors and losses on an **already existing gene-tree topology**; to add or delete gene nodes or branches, use the existing build dialog.
- No multi-gene-tree overlay aggregation in the first version; that belongs to a separate roadmap item.
- Do not add any inference that automatically writes back into the project or changes scenario statistics; display inference exists only as a layout placeholder, is not written into `assumptions`, and does not change validation or counts.
- No circular species tree in the first version; the embedded mode forces a rectangular or time-calibrated layout and says so.

### 1.3 Acceptance criteria

- Open the `recon-family` sample and switch to embedded mode: every gene node with an *effective placement* (explicit assumption, label match, or display inference) appears inside the tube range of its host species branch, and nodes that genuinely cannot be located go into an explicit orphan gutter instead of disappearing.
- The unmapped internal node β4 of sample β connects to the incoming branch of N4 by display inference, while the validation panel still reports only the single pre-existing `unresolved` warning.
- In a legal scenario, σ children enter different sub-tubes; δ children use different lanes inside the same tube; τ produces a cross-tube transfer arc; illegal scenarios are shown as dashed warnings rather than as fabricated legal paths.
- Loss display follows the three-state strategy of §5.7: when asserted losses cover the structural minimum, the total matches the status bar; when nothing is asserted or the assertion is below the structural minimum, the figure says “inferred” or “insufficient assertion” and does not claim the numbers are equal.
- Zoom, pan, Fit, 1:1 and focus-to-node work in embedded mode; the side-by-side mode behaves exactly as the existing tests require.
- A user can build a path without ever using the side-by-side view: select a gene node, click/drag the host branch to set the mapping and `branchFraction`, set event/donor/losses, save and reopen, and the path is still there.
- Switching mode, switching gene tree, undo/redo, and saving/reopening the project lose neither the mappings nor the new optional fields.
- `npm run typecheck`, `npm test` and `npm run build` all pass.

### 1.4 User requirement mapping

| User requirement | Where the plan addresses it | Acceptance evidence |
| --- | --- | --- |
| Adjust the presentation inside the reconciliation view | `ReconViewOptions.layoutMode = 'embedded'`, the “side-by-side / embedded” switch in the toolbar | Switchable inside the reconciliation workspace, no regression in side-by-side mode |
| Thicker species-tree branches | horizontal tube + vertical hub bar, default width 18 world px | The species tree reads as thick branches overall; both tubes and hub bars are drawn |
| Thinner gene-tree branches | gene segments default to 1.1–1.4 world px, coloured by event | The thickness contrast is obvious; segments stay inside the tube while zooming |
| Gene tree nested inside the species-tree branches | host branch `t` placement + lane offset + SVG mask | Every effectively placed gene segment lies within its host branch range |
| Build the evolutionary path from the structure oneself | select the gene node + Alt + click on the host branch (drag-and-drop as an enhancement) + `branchFraction` + `transferDonor` + event/loss editing | Once Phase 3 is done, the path can be saved, reopened, and is preserved |
| Then state an evolutionary hypothesis | scenario summary, validation, NHX/Markdown/SVG export | The path can be exported as citable hypothesis material |

---

## 2. Current state and gaps

### 2.1 Existing implementation

| Location | Current state |
| --- | --- |
| `src/canvas/ReconciliationView.tsx` | Two independent panes, each calling `computeLayout` once, species tree as `LR` and gene tree as `RL`; each pane has its own transform; `ReconMappingLayer` draws the mapping bridge in between. |
| `src/canvas/ReconPane.tsx` | Branches are a fixed `strokeWidth={1.4}` with `vector-effect="non-scaling-stroke"`; nodes, labels, event glyphs and viewport culling are all implemented here. |
| `src/canvas/reconMapping.ts` | Mapping lines are straight lines from “species node y → gene node y”, a pure projection, already split into an anchor pass and a projection pass. |
| `src/model/types.ts` | `GeneNodeAssumption` has only `speciesNode`, `event`, `losses`, `meta`; no within-branch position, no donor branch, no loss localisation. |
| `src/model/reconciliation.ts` | `minLossesBetween` / `descentLosses` already give the loss semantics along a species path; `validateScenario` already validates the σ/δ/τ structure. |
| `src/io/reconExport.ts` | The reconciliation view has only a Markdown report; the transfer donor is derived on the fly inside `geneTreeNhk` and is not persisted. |
| `src/io/exportImage.ts` | Image export covers only the standard canvas; the reconciliation view has no SVG/PNG/PDF export. |

### 2.2 Key gaps

1. **No shared coordinate system**: the two trees are laid out, panned and zoomed separately, so no geometric “containment” relation exists between them.
2. **No embedded layout algorithm**: `computeLayout` is a generic tree layout; it does not know which species branch a gene node belongs to, where along that branch, or in which lane.
3. **Mapping has point semantics only**: it says only “mapped to which species node”, which cannot uniquely determine how a gene lineage runs along the species branches; automatic derivation rules or new optional fields are needed.
4. **No species branch tube rendering**: thick branches, clipping inside the tube, lane offsets, cross-tube transfer arcs and in-tube loss stubs all need a new render layer.
5. **Interaction model mismatch**: two-pane pan/zoom, synchronised zoom and mapping-bridge hover have no meaning in a single-viewport embedded figure.
6. **No graphics export**: the existing export chain is coupled to `buildSVG(project)` and cannot render the reconciliation scene directly.

---

## 3. Overall design

### 3.1 Mode switch and data flow

```text
ReconciliationView
├─ layoutMode === 'side-by-side'
│    ├─ ReconPane(species, LR)
│    ├─ ReconMappingLayer
│    └─ ReconPane(gene, RL)
└─ layoutMode === 'embedded'
     └─ EmbeddedReconCanvas
          ├─ computeLayout(prepareEmbeddedSpeciesDoc(project))
          ├─ resolveEffectiveGenePlacements(species, gene, assumptions) // pure function
          ├─ computeEmbeddedReconLayout(input)                          // pure function
          └─ SVG rendering + single-viewport pan/zoom
```

Key principles:

- The **layout pass** depends only on the documents, the assumptions and the view options; pan/zoom must never recompute the layout.
- The **projection pass** computes screen coordinates and viewport culling from the current transform only, following the anchor/projection layering of `reconMapping.ts`.
- The side-by-side code keeps its semantics; the embedded view uses new components, shrinking the regression surface.
- **Implementation note**: `ReconciliationView` currently computes both layouts, the mapping anchors and the mapping lines first, regardless of mode. Embedded mode must short-circuit those memos, or the existing side-by-side canvas must be extracted into `SideBySideReconCanvas` mounted only in side-by-side mode; otherwise entering embedded mode still pays the useless cost of a two-pane layout. React hooks cannot be called conditionally, so the short-circuit has to live inside `useMemo` (returning `null`/empty arrays) or be achieved by splitting out a child component.
- The existing fit/resize/focus effects need the same mode gating: in embedded mode the side-by-side `fitBoth` / pane clamp must not be called, because they would mutate two-pane state that is not visible on the canvas; the zoom readout should be reported by `EmbeddedReconCanvas` itself.

### 3.2 One coordinate system and the definition of the “host branch”

- World coordinates come from the `LR` rectangular layout produced by `computeLayout`; embedded mode forces `orientation: 'LR'`.
- **Species branch id = the id of that branch's child node.** No new EdgeId is introduced: `Project` has no table of species branches, and a child node id naturally identifies one incoming branch uniquely (i.e. the “branch of that node” of the §0 terminology note).
- **Species branch tube and hub bar**: the horizontal segment of each species branch is the tube that hosts the gene lineage; the vertical connector at the parent node is drawn as a thicker hub bar and included in the mask. This makes the whole species tree read visually as thick branches, and guarantees that a gene lineage travelling between sub-tubes is not clipped.
  - For branch `b` (child `c`, parent `p`): the tube centreline is `(x_p, y_c) → (x_c - nodeR, y_c)`;
  - every species internal node owns one hub bar: x fixed at `x(parent)`, y spanning the y range of its direct children; width is the maximum of all adjacent tube widths (at least `minTubeWidth`), with the endpoints capped by rounded/circular joins covering the node hub;
  - `t ∈ [0,1]`: 0 at the parent end, 1 at the child-node end (the horizontal tube ends to the left of the node marker; the node marker itself is not part of the tube);
  - `t` is a **relative position** along the branch, not an absolute time; when age data exist it is used only for the temporal-feasibility check of transfers, and no gene node is forced onto some true absolute node age;
  - the lane offset is perpendicular to the tube direction (i.e. the y direction for a horizontal branch); the vertical hub uses a fixed central channel in the first version and does no lane assignment (connector lines cross at the node, but that stretch is very short);
  - the root has no incoming branch; mapping to the root uses the root coordinates, with `hostBranchId = null`.
- The species-tree layout uses larger gaps, to leave room for the tubes and the labels (see §5.3). Those gaps affect the view only and are never written back into the project.

### 3.3 Visual grammar

| Element | How it is drawn | Colour token |
| --- | --- | --- |
| Species branch tube + hub bar | thick stroke, rounded joins, tube with a light fill-style interior; the hub bars at internal nodes are equally thick | `--recon-tube` / `--recon-tube-border` |
| Gene lineage | thin line, inside the tube | σ: `--recon-map-sigma`; δ: `--recon-map-dup`; τ: `--recon-map-transfer`; event not annotated: `--recon-map-unresolved` |
| Gene tip mapping | thin line + tip node inside the tube | `--recon-tip` |
| Speciation σ | gene node sits at the species fork, children enter different sub-tubes | σ colour |
| Duplication δ | a parallel fork / lanes inside the same tube | δ colour |
| Horizontal transfer τ | cross-tube transfer arc from donor tube → recipient tube, with an arrow head | τ colour; dashed when not time-feasible |
| Gene loss λ | short loss stubs inside the tube + λ count | `--recon-loss` |
| Node with a mapping but no annotated event | hollow/dashed node, grey | `--recon-map-unresolved` |
| Unmapped node | the orphan gutter on the right, dashed line to the nearest mapped ancestor | grey + warning |
| Selected / hovered | selection ring in screen space; host tube highlighted | `--recon-select` |

---

## 4. Data model

### 4.1 View options

Extend `ReconViewOptions` in `src/model/types.ts`. These are pure UI state: they do not enter the project file and take no part in undo/redo.

```ts
export type ReconLayoutMode = 'side-by-side' | 'embedded';

export interface ReconViewOptions {
  mappingScope: MappingScope;
  showLabels: boolean;
  showEventGlyphs: boolean;
  showLosses: boolean;
  showMappings: boolean;
  syncZoom: boolean;
  eventFilter: ReconEventType | 'unresolved' | 'all';

  /** Canvas layout mode: side-by-side comparison / embedded nesting. */
  layoutMode: ReconLayoutMode;
  /** Embedded mode: base species branch tube width (world px). */
  embeddedTubeWidth: number;
  /** Embedded mode: gene lane spacing (world px). */
  embeddedLaneGap: number;
  /** Embedded mode: whether to draw horizontal transfer arcs. */
  embeddedShowTransfers: boolean;
  /** Embedded mode: whether to draw gene loss stubs. */
  embeddedShowLossStubs: boolean;
}

export const DEFAULT_RECON_VIEW_OPTIONS: ReconViewOptions = {
  mappingScope: 'tips',
  showLabels: true,
  showEventGlyphs: true,
  showLosses: true,
  showMappings: true,
  syncZoom: true,
  eventFilter: 'all',

  layoutMode: 'side-by-side',
  embeddedTubeWidth: 18,
  embeddedLaneGap: 3,
  embeddedShowTransfers: true,
  embeddedShowLossStubs: true,
};
```

Additional conventions:

- `embeddedTubeWidth` is limited to `[10, 32]` in the UI; `embeddedLaneGap` is limited to `[1.5, 6]`.
- `syncZoom` is meaningless in embedded mode and is hidden or disabled in the toolbar.
- `mappingScope` / `eventFilter` **do not hide topology** in embedded mode; they only mute the emphasis on non-matching elements, while the selected/hovered element is always emphasised. Otherwise the integrity of the gene tree would be broken.
- `showMappings` in embedded mode controls the annotation layer — mapping anchors, event badges and so on — not the embedded branches themselves.
- New fields must be added to `DEFAULT_RECON_VIEW_OPTIONS` at the same time; the existing tests and the store initialisation both derive from that default object, so no mass of literal omissions can appear.
- The “Reset view settings” action of `ReconPanel` currently writes only the old fields; the implementation must also reset tube width, lane spacing and the transfer/loss switches, while **preserving the current `layoutMode`**, so that a reset never kicks the user from the embedded view back to the side-by-side view.
- Optional: remember the last `layoutMode` in `localStorage`, with `side-by-side` still being the default; never written into the project file.

### 4.2 Extension fields on the gene-node assumption (required for Phase 3)

> The fields stay **optional** in the schema, for compatibility with old projects; but the Phase 3 UI and persistence are a required deliverable for meeting the user's “build the path yourself” requirement, not an optional extra.

Add two optional fields to `GeneNodeAssumption` in `src/model/types.ts`:

```ts
export interface GeneNodeAssumption {
  speciesNode: NodeId;
  event?: ReconEventType;
  losses?: number;
  meta?: HypothesisMeta;

  /**
   * Position inside the host species branch: 0 = the parent end,
   * 1 = the end at the mapped species node.
   * Meaningful only when speciesNode is not the species root;
   * absent means the layout derives it automatically.
   */
  branchFraction?: number;

  /**
   * The donor of a horizontal transfer: the species node that the donor
   * child sits on (not a branch id).
   * The current model treats "the child outside the recipient subtree" as the
   * donor (the convention of validateScenario / geneTreeNhk); when absent it is
   * derived by that rule, and an explicit value is for multi-donor/ambiguous cases.
   */
  transferDonor?: NodeId;
}
```

Semantics and compatibility:

- Both fields are optional, so old projects need no migration; `projectIO` currently preserves `assumptions` verbatim through `{ ...g, doc }`, so the new fields cannot be lost.
- Bounds repair must run on load: clamp `branchFraction` into `[0,1]`; `transferDonor` must point at an existing species node, otherwise it is dropped and reported in the import report.
- `setAssumption` (`src/model/geneTrees.ts`) already uses `{ ...cur, ...patch }`, so the new optional fields need no change to the function signature; the UI only has to pass a patch.
- `dtlScenarioToAssumptions` (`src/model/dtl.ts`) rebuilds `assumptions` wholesale, and **its current signature does not take the previous assumptions**; the implementation must either add an optional `previousAssumptions` parameter or merge at the call site, otherwise the visual fields cannot be “preserved”.
  - if the old and the new `speciesNode` are identical, keep the existing `branchFraction` / `transferDonor`;
  - if the mapping target changes, discard both visual fields so they cannot point at the old branch;
  - if the new scenario has no such gene node at all, the fields disappear together with the assumption.
- The NHX output of `reconExport.ts` should gain the `BF=` and `TD=` extension tags; when `geneTreeNhk` emits `TD=` it should prefer an explicit `transferDonor` and otherwise keep the existing “child outside the subtree” derivation. The Markdown table can gain “branch position / donor” columns.
- `PROJECT_VERSION` does not need to be bumped; documenting the optional fields in `docs/FORMAT.md` is enough.

### 4.3 Data deliberately not added

- No new `EdgeId` table for species branches; a branch id reuses the child node id.
- No persistence of layout results, lane numbers, or screen coordinates.
- No `lossPositions` in the first version; the in-tube position of a loss is derived automatically from the structural minimum, and asserted losses beyond the structural minimum are shown as extra loss stubs / a badge next to the gene node (see §5.7).

---

## 5. The embedded layout algorithm

### 5.1 New pure modules

Suggested additions:

- `src/model/reconPlacements.ts`: effective placements, paths, loss splitting, transfer donor derivation (`resolveTransferDonor`).
- `src/layout/embeddedRecon.ts`: world coordinates, tubes, hub bars, lanes, scene geometry.
- Matching tests: `src/model/reconPlacements.test.ts`, `src/layout/embeddedRecon.test.ts`.

`reconPlacements.ts` answers the semantic questions and has no React dependency:

```ts
export type PlacementSource = 'assumption' | 'tip-label' | 'inferred-mrca';

export interface EffectivePlacement {
  geneNodeId: NodeId;
  speciesNodeId: NodeId;
  source: PlacementSource;
  /** true = an inferred position used for display only; never written into
   *  assumptions and never changing the scenario statistics. */
  inferred: boolean;
}

export interface EffectivePlacements {
  byGeneNode: Map<NodeId, EffectivePlacement>;
  inferredGeneNodes: NodeId[];
  unmappedGeneNodes: NodeId[];
}

export function resolveEffectiveGenePlacements(
  species: Project,
  gene: Project,
  assumptions: Record<NodeId, GeneNodeAssumption>,
): EffectivePlacements;

/** Branch id = child node id; the species root returns null. */
export function branchIdOf(species: Project, speciesNodeId: NodeId): NodeId | null;

export type SpeciesPath =
  | { kind: 'same'; node: NodeId }
  | { kind: 'down'; from: NodeId; to: NodeId; branches: NodeId[] }
  | { kind: 'up'; from: NodeId; to: NodeId; branches: NodeId[] }
  | {
      kind: 'lateral';
      from: NodeId;
      to: NodeId;
      mrca: NodeId;
      upBranches: NodeId[];
      downBranches: NodeId[];
    };

export function speciesPathBetween(
  species: Project,
  from: NodeId,
  to: NodeId,
): SpeciesPath;

/** How many lineages are dropped at each species fork; the same semantics as
 *  descentLosses/minLossesBetween. */
export function lossesAlongSpeciesPath(
  species: Project,
  path: SpeciesPath,
): Map<NodeId, number>;

/** Shared with validateScenario / geneTreeNhk: the child outside the subtree is
 *  the donor; an explicit donor species node wins (the stored value names a node
 *  of the outer species tree and is matched against the children's placements). */
export function resolveTransferDonor(
  species: Project,
  gene: Project,
  geneNodeId: NodeId,
  effective: EffectivePlacements,
  explicitDonorSpeciesNode?: NodeId,
): { donorGeneNodeId: NodeId; donorSpeciesNodeId: NodeId } | null;
```

Implementation points:

- `resolveEffectiveGenePlacements` merges the rules currently spread over `ReconciliationView.mappingAssumptions` and `reconExport.effectiveMapping`: an explicit assumption wins, then gene tips are matched by label; do not keep writing the same rule in three places.
- An effective placement must verify that `assumption.speciesNode` still exists in `species.nodes`: a dangling target cannot be an effective position; a tip falls back to label matching, an internal node may be taken over by display inference (if its children are locatable), otherwise it goes to unmapped; a `dangling-assumption` layout issue is always produced, which matches the existing `dangling` report in `validateScenario`.
- The layout layer (`computeEmbeddedReconLayout`) must additionally check that the target is in `speciesLayout.visible`: a species node/branch hidden by collapsing cannot act as a host branch; the layout skips it and produces a `hidden-host` / `unmapped-gene-node` issue, following the same rule as the side-by-side view's “no mapping line to an invisible target”. Embedded mode never auto-expands collapsed subtrees.
- `speciesPathBetween` reuses `pathToRoot` / `mrcaOf` (`src/model/treeOps.ts`) and is cross-tested with `minLossesBetween`, so that the loss counts shown visually agree with the DTL panel.
- An `up` path (a child mapped to an ancestor of its parent) is time travel and `validateScenario` already reports it as an error; the layout layer still returns the path, but it is rendered as a dashed infeasible path.

#### 5.1.1 Display inference (must be implemented)

Internal nodes of a gene tree are not guaranteed to carry a `GeneNodeAssumption`. The gene tree β of the `recon-family` sample deliberately leaves one internal node β4 unmapped, while its children E/F can still be mapped to species tips by label. If every “internal node without an assumption” were thrown into the orphan gutter, the gene tree would break apart and could not meet the user's expectation of an embedded view.

Rules:

1. Traverse the gene tree bottom-up: if an internal node has no assumption and **all** of its children have an effective placement (assumption, tip-label or display-inferred), set that node's display position to the MRCA of those children's positions, with `source = 'inferred-mrca'` and `inferred = true`.
2. If any child cannot be located, that node is not inferred either; it and any unlocatable nodes above it go into `unmappedGeneNodes`.
3. Display inference is for layout only: it **must not be written into `entry.assumptions`**, and must not change `scenarioSummary`, `validateScenario` or the status-bar counts.
4. An inferred node uses the dashed/hollow style and its incoming branch is dashed; the legend states “display inference (not stored in the assumptions)”. If its children already have real mappings, the children's paths are still drawn from those real mappings.
5. This differs from “Suggest via MRCA”: the latter writes an assumption explicitly and changes the scenario; display inference does neither. The user can still write β4 back formally, following the MRCA suggestion, in the inspector.

Concrete expectation for β4: the children E/F map by label to Taxon_E/Taxon_F, whose MRCA is N4; β4 is displayed on the incoming branch of N4, its children entering the two sub-tubes of N4, and at the same time the validation panel still reports only the pre-existing `unresolved` warning.

### 5.2 Layout input and output

```ts
export interface EmbeddedLayoutOptions {
  tubeWidth: number;
  laneGap: number;
  minTubeWidth: number;
  maxTubeWidth: number;
  showTransferArcs: boolean;
  showLossStubs: boolean;
}

export interface EmbeddedReconInput {
  speciesDoc: Project;
  speciesLayout: LayoutResult; // from prepareEmbeddedSpeciesDoc + computeLayout
  geneDoc: Project;
  assumptions: Record<NodeId, GeneNodeAssumption>;
  options: EmbeddedLayoutOptions;
}

export interface EmbeddedReconLayout {
  speciesLayout: LayoutResult;
  tubes: Map<NodeId, EmbeddedTube>;          // key = species branch id (child node id)
  hubs: Map<NodeId, EmbeddedHub>;            // key = parent species node id
  placements: Map<NodeId, EmbeddedGeneNode>; // key = gene node id
  segments: EmbeddedGeneSegment[];
  transfers: EmbeddedTransferArc[];
  losses: EmbeddedLossMark[];
  orphans: EmbeddedOrphan[];
  bounds: EmbeddedBounds;
  issues: EmbeddedLayoutIssue[];
  stats: {
    maxLane: number;
    overflowBranches: number;
    unmapped: number;
    inferred: number;
  };
}
```

`EmbeddedTube`:

```ts
export interface EmbeddedTube {
  /** Species branch id = child node id. */
  branchId: NodeId;
  parentId: NodeId;
  /** Centreline endpoints of the tube (world coordinates); t=0 at the parent
   *  end, t=1 at the child-node end. */
  x0: number;
  y: number;
  x1: number;
  width: number;
  lanes: number;
  /** Outer outline / stroke path of the tube (SVG d). */
  path: string;
}

export interface EmbeddedHub {
  /** Parent species node id; the hub spans the y range of its direct children. */
  parentId: NodeId;
  x: number;
  y0: number;
  y1: number;
  /** The maximum of the adjacent tube widths, at least minTubeWidth. */
  width: number;
  /** The vertical connector path (SVG d). */
  path: string;
  /** End-cap hub radius, used for the circular caps of the mask. */
  nodeRadius: number;
}
```

`EmbeddedGeneNode`:

```ts
export interface EmbeddedGeneNode {
  geneNodeId: NodeId;
  speciesNodeId: NodeId | null;
  hostBranchId: NodeId | null; // null for the species root
  t: number;                   // 0..1, meaningless when hostBranchId is null
  lane: number;
  x: number;
  y: number;
  event: ReconEventType | null;
  kind: 'tip' | 'internal';
  placementSource: 'assumption' | 'tip-label' | 'inferred-mrca' | 'none';
  /** true = the event is not yet resolved (a mapping exists but no event);
   *  drawn dashed / grey. */
  unresolved: boolean;
  /** true = a display-inferred position, not written into assumptions. */
  inferred: boolean;
  unmapped: boolean;
  /** Whether the position was derived automatically (used for a UI hint). */
  autoPositioned: boolean;
}
```

`EmbeddedGeneSegment`:

```ts
export interface EmbeddedGeneSegment {
  id: string;
  geneNodeId: NodeId;
  parentGeneNodeId: NodeId;
  hostBranchId: NodeId;
  t0: number;
  t1: number;
  lane: number;
  d: string;
  event: ReconEventType | null;
  kind: 'tip' | 'internal';
  dashed: boolean;
  /** 'normal' | 'muted', whether the segment is dimmed by filtering/muting. */
  emphasis: 'normal' | 'muted';
}
```

`EmbeddedTransferArc`:

```ts
export interface EmbeddedTransferArc {
  /** The gene node g where the transfer event sits. */
  geneNodeId: NodeId;
  /** The child d outside the recipient subtree; its host branch is the donor branch. */
  donorGeneNodeId: NodeId | null;
  /** The child r that stays inside the recipient subtree (fallback for the
   *  recipient end point). */
  recipientGeneNodeId: NodeId | null;
  donorBranchId: NodeId | null;
  recipientBranchId: NodeId;
  donorSpeciesNodeId: NodeId | null;
  recipientSpeciesNodeId: NodeId;
  from: Point;
  to: Point;
  d: string;
  timeFeasible: boolean | null; // null = no age data, cannot be decided
}
```

`EmbeddedLossMark`:

```ts
export interface EmbeddedLossMark {
  geneNodeId: NodeId;
  atSpeciesNodeId: NodeId;
  branchId: NodeId | null;
  count: number;
  x: number;
  y: number;
  /** structural = the minimum loss the path structure requires; asserted = extra
   *  loss asserted beyond the structural minimum. */
  source: 'structural' | 'asserted';
  /** true = this structural loss is not covered by the asserted value and is
   *  drawn in the "inferred" style. */
  inferred: boolean;
}

export interface EmbeddedOrphan {
  geneNodeId: NodeId;
  parentGeneNodeId: NodeId | null;
  reason: 'unmapped-tip' | 'unmapped-internal' | 'unknown-path';
  /** World coordinates inside the orphan gutter. */
  x: number;
  y: number;
}

export interface EmbeddedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type EmbeddedLayoutIssue =
  | { kind: 'lane-overflow'; branchId: NodeId; lanes: number; cap: number }
  | { kind: 'unmapped-gene-node'; geneNodeId: NodeId }
  | { kind: 'dangling-assumption'; geneNodeId: NodeId; speciesNodeId: NodeId }
  | { kind: 'hidden-host'; geneNodeId: NodeId; speciesNodeId: NodeId }
  | { kind: 'unknown-path'; geneNodeId: NodeId }
  | { kind: 'embedding-order-conflict'; geneNodeId: NodeId }
  | { kind: 'infeasible-lateral'; geneNodeId: NodeId }
  | { kind: 'donor-unknown'; geneNodeId: NodeId };
```

#### 5.2.1 Geometry helpers

These functions live in `src/layout/embeddedRecon.ts` or `src/canvas/embeddedReconGeometry.ts`; they are pure functions and unit-testable:

```ts
/** World coordinates on the tube; laneOffset is perpendicular to the tube
 *  direction (a y offset for a horizontal branch). */
export function pointOnTube(
  tube: EmbeddedTube,
  t: number,
  laneOffset = 0,
): Point {
  const tt = Math.max(0, Math.min(1, t));
  return {
    x: tube.x0 + (tube.x1 - tube.x0) * tt,
    y: tube.y + laneOffset,
  };
}

/** In-tube path after the lane offset; t0→t1, used for gene segments and loss stubs. */
export function lanePath(
  tube: EmbeddedTube,
  t0: number,
  t1: number,
  laneOffset: number,
  rounded = true,
): string;

/** Nearest tube hit for a world point: returns the branch id and t, for
 *  Alt+click / hover. */
export function hitTestTube(
  tubes: Iterable<EmbeddedTube>,
  p: Point,
  tolerance: number,
): { tube: EmbeddedTube; t: number; distance: number } | null;

/** Fit: the same padding=24 rule as reconPaneBounds. */
export function fitEmbeddedBounds(
  bounds: EmbeddedBounds,
  width: number,
  height: number,
): PaneTransform;

/** Scene bounding box: tubes / hubs / gene segments / arcs / losses / labels. */
export function computeEmbeddedBounds(
  scene: EmbeddedReconLayout,
  speciesDoc: Project,
  geneDoc: Project,
): EmbeddedBounds;
```

The `laneOffset` of `pointOnTube` must include a safety margin for the lane half-width and the gene line half-width; `lanePath` generates a polyline/rounded path inside the tube; `hitTestTube` first filters coarsely with the tube rectangle (y ± width/2) plus `tolerance`, then solves `t` in the x direction. Hit priority: node > gene segment > tube/hub. `PaneTransform` can reuse the exported type from `reconMapping.ts`.

### 5.3 Species-tree preparation

```ts
export function prepareEmbeddedSpeciesDoc(doc: Project): Project {
  const type = doc.layout.type === 'circular'
    ? 'rectangular-cladogram'
    : doc.layout.type;
  return {
    ...doc,
    layout: {
      ...doc.layout,
      type,
      orientation: 'LR',
      vGap: Math.max(doc.layout.vGap, 88),
      hGap: Math.max(doc.layout.hGap, 180),
    },
  };
}
```

- `circular` is not supported for nesting; it is forced to rectangular and a view hint is shown.
- `time-calibrated` keeps the ages and `timeAxisLength`; `rectangular-phylogram` keeps the branch lengths. With no ages or branch lengths the layout is topological and the UI shows “topological sketch”.
- The larger `vGap` is there to accommodate the tube width and the gene labels; this change applies only to the layout input of this view and is not written back into the project.
- The adaptive tube width has an upper cap (see §5.6), so the tube width does not need to be fed back into the species layout, which avoids a “layout → width → layout” circular dependency.

### 5.4 Gene-node placement rules

For every gene node, first determine `speciesNodeId` (the effective mapping), then `hostBranchId`, `t` and `lane`.

| Node situation | Host branch | Default `t` | Notes |
| --- | --- | --- | --- |
| The species root | `null` | none | The gene root / a node mapped to the root is placed at the species-root coordinates |
| Gene root (not a free root) | incoming branch of the mapped node | 1.0 | anchored to the species root |
| Speciation σ | incoming branch of the mapped node | 1.0 (close to the node) | the fork happens at the species node |
| Duplication δ | incoming branch of the mapped node | 0.55 | leaves room inside the tube to fork |
| Horizontal transfer τ | incoming branch of the recipient's mapped node | 0.75 | the arrival point; the transfer arc runs from the donor child's branch to the recipient branch, the parent branch is a short τ-coloured dashed line |
| Gene tip (mapped) | if the mapped node is a tip → that tip's incoming branch | 1.0 | aligned with the species tip |
| Internal node with a mapping but no annotated event | incoming branch of the mapped node | 0.9 | dashed / grey, kept as a placeholder |
| Internal node without a mapping but whose every child is locatable | incoming branch of the MRCA of the children's positions (display inference) | 1.0 (children enter different child branches) or 0.55 (same branch) | node / incoming branch dashed, labelled “display inference”, not written into the assumptions |
| No mapping and no inference possible | `null` | none | goes into the orphan gutter, takes no part in the nesting |

Hard constraints:

- Inside one host branch, the parent gene node's `t` must be smaller than its child's `t`; otherwise the parent is compressed towards the parent end (lower bound 0.15), and if that still cannot be satisfied an `embedding-order-conflict` layout error is produced and the segment is drawn dashed.
- When `branchFraction` is present it overrides the default `t`, but the parent/child ordering constraint still applies.
- Several gene nodes on the same species node are assigned to different lanes, so their markers do not overlap.
- A display-inferred node is subject to the same parent/child ordering constraint; its incoming branch and node are dashed, so it cannot be misread as a written-back assumption.
- Connections that cross sub-tubes use the fixed central channel of the vertical hub bar; the hub is short, so the first version does no lane assignment there and lets connector lines cross at the node.
- The gene tree is read-only; the rules above only decide “where to draw”, they never change an assumption.

### 5.5 Decomposing gene branches

For every gene branch “parent gene node → child gene node”:

1. Take the effective mappings `u` (parent) and `v` (child).
2. **Check the child's `event` first**:
   - if `event === 'transfer'`: do NOT expand the species path via `speciesPathBetween(u, v)`. Draw the transfer annotation as in §5.8: a cross-tube arc from the host branch of the donor child d (the child outside the recipient subtree) to the recipient branch; the parent branch of the transferring gene node g is a short τ-coloured dashed line and is not expanded along the species path. Even when `v` is a descendant of `u` (which is exactly the case of αAC in sample α), it must not be drawn as an ordinary descent.
   - if `event !== 'transfer'`, continue to the next step.
3. Call `speciesPathBetween(species, u, v)`:
   - `same`: the gene branch lies within one host branch; draw a short fork / parallel lines in `t` order;
   - `down`: draw one segment per branch along the species path `u → v`; each intermediate species node produces a loss mark;
   - `lateral`: go up to the MRCA first, then down to `v`; a lateral move that is not a transfer is infeasible — draw a dashed warning path and produce a layout issue;
   - `up`: infeasible time travel, dashed warning.
4. Each segment is emitted as an `EmbeddedGeneSegment`, recording `hostBranchId`, `t0`, `t1`, `lane`.
5. Adjacent segments are joined at the species node; the joint uses the fixed central channel of the vertical hub bar, so it never leaves the tubes.
6. A mapped tip: the last segment converges at `t=1`, and the node is aligned next to the species tip (the tube ends to the left of the node marker).
7. A display-inferred node: its incoming branch is dashed; the children's paths are still drawn from their own effective positions; the inferred value must never be written back into `assumptions`.
8. If one end of the gene branch has no effective position (completely unmapped and not inferable):
   - no ordinary embedded segment is produced;
   - if that node has a nearest mapped ancestor, a dashed “path unknown” connector is drawn (marked `unknown-path`);
   - if it has none, the node goes into the orphan gutter;
   - the MRCA of the children must never be used to fabricate a mapping for the parent node.
9. If the gene branch joins a “display-inferred parent” to a “real-mapped child”, the parent→child segment is dashed and the line becomes solid again below the child.

Important: path decomposition must agree with the semantics of `minLossesBetween`. The loss of a `down` path is `childrenIds.length - 1` at each intermediate fork, not a fixed 1; for a lateral path both descending sides are counted. Display inference affects layout only and does not change how losses are priced; a structural loss that originates from a display-inferred node is likewise marked `inferred` and is not included in the asserted statistics.

### 5.6 Lane assignment and tube width

For every species branch, collect all `EmbeddedGeneSegment`s plus one occupancy interval `[t-ε, t+ε]` per gene node:

1. Sort by `t0`, then by gene node id.
2. Greedy interval colouring: assign the lowest currently free lane; if none is free, open a new lane.
3. Optional optimisation: order the lanes by the species y order of the descendant gene tips (barycentre), to reduce meaningless crossings; but **do not try to eliminate all crossings** — the conflict between the gene tree and the species tree is precisely the information to be shown.
4. Lane offset:

```text
laneOffset(lane, laneCount, laneGap) =
  (lane - (laneCount - 1) / 2) * laneGap
```

5. Tube width:

```text
required = (laneCount - 1) * laneGap + 2 * padding
width = clamp(max(baseWidth, required), minTubeWidth, maxTubeWidth)
```

6. If `required > maxTubeWidth`:
   - shrink `laneGap` step by step down to its minimum;
   - if it still overflows, produce a `lane-overflow` layout issue and show a `+n` badge at the tube end;
   - never change the spacing of the species-tree document automatically.

Recommended defaults:

- `minTubeWidth = 12`, `baseWidth = 18`, `maxTubeWidth = 32`;
- `laneGap = 3`, minimum `1.5`;
- in-tube padding `padding = 2`.

### 5.7 Loss marks and count consistency

Facts from the code: the λ of `scenarioSummary` counts only `assumptions[].losses` and **does not automatically add the path's structural minimum**; it is `validateScenario`'s `loss-shortfall` that reports “the asserted value is below the structural minimum”. Therefore one cannot simply promise that “the total λ drawn on the figure = the λ in the status bar” in all cases.

Definitions:

- `structuralMin`: the sum of `m-1` at each species fork, obtained from `lossesAlongSpeciesPath`;
- `asserted`: `assumption.losses ?? 0`;
- if the path is `up` (time travel) or `structuralMin` is not finite (corresponding to `Infinity` from `minLossesBetween`): do not apply the table below and do not draw loss stubs; draw the infeasible path and reference validation's `upward-move` error. Do not feed `Infinity` into comparisons.
- Display strategy (only for finite structural losses):

| Asserted gene loss `asserted` | What is drawn inside the tube | Relation to the status bar |
| --- | --- | --- |
| absent (undefined) | draw `structuralMin` at the forks of the path, as hollow/dashed loss stubs, labelled “inferred structural loss” | the status bar counts 0; the legend states “inferred losses are not part of the asserted statistics” |
| `asserted >= structuralMin` | draw the `structuralMin` structural stubs + `asserted - structuralMin` extra stubs / a λ badge next to the gene node | total = `asserted`, consistent with the status bar |
| `asserted < structuralMin` | draw the `structuralMin` structural stubs and add a warning badge “asserted λa < structural minimum λm” | the total does not equal the status bar; validation already reports `loss-shortfall`, and the UI must state this clearly |

Additional points:

- Structural stubs are located at concrete forks by `lossesAlongSpeciesPath`; when `count > 1` they are labelled `λn`.
- Structural losses produced by several gene nodes at the same species fork may be aggregated into one `λn`, with a tooltip listing the contributing gene nodes; aggregation does not change the total.
- Extra asserted losses with no precise position are drawn beside the gene node's host branch, without fabricating a specific fork; the inspector shows the asserted value.
- The DTL solver produces `lossMarks` (including `at`, the species node where the lineage ends) inside `dtlScenarioToAssumptions`, but today only the totals are stored. If the solver's loss positions must be reproduced exactly, an optional field `lossMarks?: { at: NodeId; count: number }[]` can be added in Phase 3; the first version does not require it.
- Loss stubs are drawn inside the tube and never pierce the tube boundary; the stub end uses a small dot or cross, colour `--recon-loss`.
- Do not hide the structural minimum just “to match the status bar”: scientifically the figure must show the minimum loss the path requires, and must make the inferred / asserted / warning distinction explicit.

### 5.8 Horizontal transfer (HGT)

- **Recipient**: the species branch that the transferring gene node is mapped to (the incoming branch of `speciesNode`). This is the side on which the gene lineage “arrives”.
- **Donor** (kept consistent with the existing `validateScenario` / `geneTreeNhk` convention):
  - an explicit `assumption.transferDonor` takes precedence;
  - an explicit donor must exist in `species.nodes` and lie outside the recipient subtree; otherwise the field is ignored, the automatic derivation is used as a fallback, and `donor-unknown` / `dangling-assumption` is reported;
  - otherwise, among the children of that gene node, take the child whose effective placement falls outside the recipient's species subtree; the branch that this child's mapped species node sits on is the donor branch;
  - if there are several children outside the subtree, take the first one in `childrenIds` order (matching the current behaviour of `geneTreeNhk`) and label the UI “automatically derived donor”; the user can override it with `transferDonor`; it is recommended to extract this rule into a shared `resolveTransferDonor` function — export and layout must not each keep their own copy;
  - if all children have effective positions but none is outside the subtree, the transfer event itself is illegal (`validateScenario` reports `event-conflict`); no legal transfer arc is drawn, only a dashed warning;
  - if some child is unplaced, `validateScenario` may skip the transfer check for that node; the donor is then unknown, the transfer arc is dashed and annotated in the legend/inspector — nothing is guessed;
  - **do not default the donor to the branch the parent gene node sits on**: the established model treats “the child outside the recipient subtree” as the donor, and a parent-branch default would contradict the validation/export semantics.
- If the donor child itself is unmapped / unlocatable, the donor is unknown: the transfer arc is dashed and annotated in the legend/inspector, nothing is guessed.
- **The transfer arc is an event annotation; it does not replace a gene-tree topology branch**:
  - the lineage of the donor child d is drawn inside the donor branch; the lineage of the child r that stays inside the recipient subtree is drawn inside the recipient branch;
  - the cross-tube arc points from d's host branch to the recipient branch (the branch holding g/r), the arrow head pointing at the recipient;
  - the parent branch of the transferring gene node g is a τ-coloured dashed line from the parent's landing point to g's recipient endpoint; if the two points lie in different tubes, route it around the outside; do not expand the parent→g species path and do not treat the parent's branch as the donor;
  - if the parent branch and the transfer arc are visually redundant, you may keep only the transfer arc plus a short τ-coloured parent-branch stub, but the hint of the topology relation between g and its parent must not be deleted.
- The recipient end point is g's host branch (on the same side as r); if g is the root or has no incoming branch, fall back to r's host branch.
- The transfer arc itself produces no structural loss; asserted losses on the incoming branch of the donor child d are still displayed by the ordinary rules of §5.7 (if any). The λ attributed to a transfer event in the status bar is still counted from `assumptions[].losses`; the layout adds nothing.
- Routing of the transfer arc:
  - from the donor tube's `(x_d, y_d + laneOffset_d)` to the recipient tube's `(x_r, y_r + laneOffset_r)`;
  - use a cubic Bézier curve, leaving vertical clearance above or below the tubes so the arc does not pass through unrelated tubes;
  - the arrow head points at the recipient tube;
  - whether the curve goes “above” or “below” is chosen from the vertical relation of the two branches: if the recipient is above the donor, route above, otherwise below;
  - when tubes are crowded one may route around the outside of the tree; the first version starts with the simple above/below rule.
- Time feasibility:
  - when ages exist, check whether the survival intervals of the donor branch and the recipient branch overlap (reusing `validateScenario`'s `timing` logic);
  - when they do not overlap, the transfer arc is dashed and a warning is attached;
  - with no ages, `timeFeasible = null`, and the legend states “topological transfer, timing not checked”.

### 5.9 Bounds and Fit

- `bounds` must contain: the tube outlines, all gene segments, transfer arcs, loss stubs/badges, species and gene labels, event glyphs, and the allowance for the selection ring.
- `fitEmbeddedBounds(bounds, width, height)` reuses the existing `fitTransformFor` padding=24 rule; the zoom range keeps `RECON_MIN_SCALE=0.15` and `RECON_MAX_SCALE=4`.
- If a time-calibrated layout has a `timeAxis`, include the axis label area in bounds (the margin logic of `planEraOverlay` can be reused); the first version may omit the time axis, but the legend must then explain what the x axis means.

### 5.10 Determinism and complexity

- Every sort must carry a stable secondary key (gene node id / species node id), so the same input always yields the same layout.
- Complexity targets:
  - effective mappings O(g + s);
  - path decomposition O(g × speciesDepth), reducible to close to O(g × log s) with an MRCA cache;
  - lane assignment O(k log k) (k spans per branch);
  - scene generation O(segments + transfers + losses);
  - pan/zoom recomputes no layout.
- The layout cache key: `project`, `activeGeneTreeId`, `assumptions`, and those fields of `ReconViewOptions` that influence the layout; hover/selection only influence emphasis and must not trigger a layout recomputation.

### 5.11 Pseudocode

```ts
export function computeEmbeddedReconLayout(
  input: EmbeddedReconInput,
): EmbeddedReconLayout {
  const { speciesDoc, speciesLayout, geneDoc, assumptions, options } = input;

  const effective = resolveEffectiveGenePlacements(
    speciesDoc, geneDoc, assumptions,
  );

  const placements = placeGeneNodes(
    speciesDoc,
    geneDoc,
    assumptions,
    effective,
    speciesLayout,
  );

  const { segments, transfers, losses, orphans, issues } =
    decomposeGeneEdges(
      speciesDoc,
      geneDoc,
      placements,
      options,
    );

  const lanes = assignTubesAndLanes(
    speciesDoc,
    speciesLayout,
    placements,
    segments,
    options,
  );

  const { tubes, hubs } = buildTubeGeometry(speciesLayout, lanes, options);
  const emitted = emitScene(placements, segments, transfers, losses, orphans);
  const scene: EmbeddedReconLayout = {
    speciesLayout,
    tubes,
    hubs,
    ...emitted,
    // Placeholder first, replaced by the real geometry below, so that
    // computeEmbeddedBounds does not depend on bounds itself.
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    issues,
    stats: summarize(lanes),
  };
  return { ...scene, bounds: computeEmbeddedBounds(scene, speciesDoc, geneDoc) };
}
```

---

## 6. Rendering design

### 6.1 Components

Add `src/canvas/EmbeddedReconCanvas.tsx`; `ReconPane` is not modified. Recommended component interface:

```tsx
export interface EmbeddedReconCanvasProps {
  speciesDoc: Project;
  geneEntry: GeneTreeEntry;
  options: ReconViewOptions;
  geneSelection: NodeId[];
  speciesSelection: NodeId[];
  hoveredGeneId: NodeId | null;
  focusTarget: { id: NodeId; seq: number } | null;
  onGeneNodeClick: (id: NodeId, e: React.MouseEvent) => void;
  onSpeciesNodeClick: (id: NodeId, e: React.MouseEvent) => void;
  onTubeClick: (branchId: NodeId, t: number, e: React.MouseEvent) => void;
  onGeneHover: (id: NodeId | null) => void;
  onZoomChange?: (zoom: number) => void;
  onFitReady?: (fit: () => void) => void;
  onResetZoom?: () => void;
}
```

The component should render a fixed header row internally (a layout row, not an overlay): the title “Species tree · current gene tree”, the node count, the current zoom, Fit, 1:1. `ReconPane`'s per-pane Fit/1:1 have no corresponding pane in embedded mode, so both operations must be reachable from the `EmbeddedReconCanvas` header or from `ReconToolbar`; one must not keep only the Fit event and drop 1:1.

Internally:

```tsx
const speciesLayout = useMemo(
  () => computeLayout(prepareEmbeddedSpeciesDoc(speciesDoc)),
  [speciesDoc],
);
const scene = useMemo(
  () => computeEmbeddedReconLayout({
    speciesDoc,
    speciesLayout,
    geneDoc: geneEntry.doc,
    assumptions: geneEntry.assumptions,
    options: layoutOptionsFrom(options),
  }),
  [speciesDoc, speciesLayout, geneEntry, options],
);
```

### 6.2 Layer order

From bottom to top:

1. the species tree's horizontal tube strokes (outer border + inner fill);
2. the species tree's hub bars and the node hub circles (equally thick, so the whole species tree reads as thick branches);
3. gene segments (with the tube + hub mask applied);
4. transfer arcs (above the tubes, below the nodes);
5. gene node markers, event glyphs;
6. loss stubs and λ badges;
7. labels (species labels outside the tube, gene labels inside the tube or at the tip);
8. selection/hover rings, focus indicator;
9. the orphan gutter (unmapped nodes).

### 6.3 The tube mask (critical SVG details)

One cannot use `clipPath` to clip a “stroked shape” directly: `clipPath` uses the fill geometry, and a thick stroke is not a filled area. The correct approach is a `<mask>`:

```svg
<mask id={maskId} maskUnits="userSpaceOnUse"
      x={bounds.minX} y={bounds.minY}
      width={bounds.maxX - bounds.minX}
      height={bounds.maxY - bounds.minY}>
  <rect x={bounds.minX} y={bounds.minY}
        width={bounds.maxX - bounds.minX}
        height={bounds.maxY - bounds.minY} fill="black" />
  {tubes.map(t => (
    <path d={t.path} fill="none" stroke="white"
          strokeWidth={t.width} strokeLinecap="round" />
  ))}
  {hubs.map(h => (
    <path d={h.path} fill="none" stroke="white"
          strokeWidth={h.width} strokeLinecap="round" />
  ))}
  {speciesNodes.map(n => (
    <circle cx={n.x} cy={n.y} r={n.hubRadius} fill="white" />
  ))}
</mask>

<g mask={`url(#${maskId})`}>
  {segments.map((s) => {
    const token = s.event
      ? eventToken(s.event)
      : s.kind === 'tip'
        ? 'tip'
        : 'unresolved';
    return (
      <path key={s.id} d={s.d} fill="none"
            stroke={`var(--recon-map-${token})`}
            strokeWidth={1.25} strokeLinecap="round" />
    );
  })}
</g>
```

Notes:

- One cannot use `clipPath` to clip a “stroked shape” directly: `clipPath` uses the fill geometry, and a thick stroke is not a filled area. The white stroke inside a `<mask>` is the reliable approach.
- The `speciesNodes` in the example can be derived from `speciesLayout.visible` + `positions` (each node carrying a `hubRadius`); alternatively the endpoint circles of `hubs` can supply the caps, avoiding an extra lookup.
- **The hub bars must be part of the mask**: when a gene lineage passes from the parent tube into a child tube it travels through the vertical segment; masking only the horizontal tubes would clip the connector lines away. Only once the hub bar and the node circles complete the mask do the connector lines become continuous.
- `maskId` is generated with React's `useId()` and sanitised (for example `const maskId = 'er-mask-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')`); it must also stay unique in the exported SVG.
- The mask's covering rectangle must include a viewport buffer, so that edges are not clipped away while panning.
- Transfer arcs and loss badges are not clipped by the mask and are drawn outside the masked group.
- The tube interior should use a slightly lighter fill; add a 1 px outer border to the tube so it does not merge into the background.
- Keep at least one gene line width between a lane centre and the tube edge, so the outer half of a thin line is not shaved off by the mask.

### 6.4 Line widths and the zoom strategy

- The tube width and the gene line width both use **world coordinates** and scale together, which guarantees that the gene line always stays inside its tube.
- Recommended: gene lines 1.1–1.4 world px; base tube 18 world px; lane spacing 3 world px.
- The tube width is determined first by “the number of gene lanes present at once”, and therefore indirectly reflects the gene copy number of that branch; the legend must say so, so that readers do not read the width as support or as a node age. If a fixed width were used instead, the lanes would have to be compressed and overflow reported — the same width channel must not encode two meanings at once.
- Labels, event glyphs and selection rings keep a screen-space size (inverse-scaled), following `ReconPane`'s `invScale` pattern.
- At low zoom, hide internal gene labels by LOD, keeping only the selected/hovered labels and the tip-count badges.

### 6.5 Labels

- Species labels: placed outside the tube (to the right of the tip, or above the node), so they never sit on top of the tube; reuse `estimateLabelWidth` and the existing label-boundary rules.
- Gene labels:
  - gene tip labels are shown by default; internal gene labels only when selected/hovered or when zoomed past a threshold;
  - when one tip carries several gene copies, show stacked labels or a `×n` badge;
  - labels use `paint-order: stroke` with a background stroke, so they are not spoiled by lying over a thin line.
- The legend must explain: species branch tube = a species branch; thin line inside a tube = a gene lineage; dashed = display-inferred / event not annotated / infeasible / timing not checked / path unknown.

### 6.6 Culling and performance

- Reuse the world-viewport computation of `paneWorldViewport`; build bounding boxes separately for tubes, gene segments, transfer arcs and loss badges, and cull by viewport + one-screen buffer.
- The props of `memo`'d child components use world-coordinate primitives, so hover/selection re-renders only a few elements.
- Pan/zoom follows `ReconPane`'s “accumulate in a ref + commit at most once per frame” pattern, to avoid a flood of React renders from high-frequency input.
- The layout is recomputed only when the documents, the assumptions or the layout options change; selection, hover, pan and zoom trigger no layout.

### 6.7 Theme variables

Add to `src/styles/app.css`:

```css
:root {
  --recon-tube: #e4e4e7;
  --recon-tube-border: #a1a1aa;
  --recon-tube-inner: #fafafa;
  --recon-gene-unmapped: #71717a;
}

/* Explicit dark theme: app.css uses :root[data-theme='dark'] */
:root[data-theme='dark'] {
  --recon-tube: #3f3f46;
  --recon-tube-border: #71717a;
  --recon-tube-inner: #27272a;
  --recon-gene-unmapped: #a1a1aa;
}

/* System dark: kept consistent with the existing branches in app.css */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']):not([data-theme='dark']) {
    --recon-tube: #3f3f46;
    --recon-tube-border: #71717a;
    --recon-tube-inner: #27272a;
    --recon-gene-unmapped: #a1a1aa;
  }
}

/* Embedded canvas container: occupies the panes row of .recon-canvas */
.recon-embedded {
  grid-area: panes;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--recon-pane-bg);
  color: var(--text);
}
.recon-embedded svg {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
```

Keep using the existing `--recon-map-sigma`, `--recon-map-dup`, `--recon-map-transfer`, `--recon-map-unresolved`, `--recon-tip`, `--recon-loss`, `--recon-select`. Make sure the contrast between tubes and gene lines is sufficient in both the light and the dark theme. The legend needs four more entries: “species branch tube / gene lineage / display inference / topological sketch”; in embedded mode the `syncZoom` legend entry must not appear.

### 6.8 Accessibility

- Canvas container: `role="group"` + `aria-label` (embedded reconciliation view).
- Gene nodes: `role="button"`, `tabIndex=0`, Enter/Space to select; `aria-label` includes the mapping target, the event and the losses.
- Species branch tubes: `role="button"` (selectable; Alt + click supported in the editable mode) with an `aria-label` (host species branch + branch position).
- Selection changes are announced through `aria-live="polite"`, reusing the existing announcement pattern of `ReconciliationView`.

---

## 7. View integration and interaction

### 7.1 Mode switching

Add a segmented control to `src/ui/ReconToolbar.tsx`:

```text
[Side-by-side] [Embedded]
```

- writes `reconViewOptions.layoutMode`;
- the `syncZoom` control is hidden or disabled in embedded mode;
- the Fit button keeps dispatching the `cladeforge:recon-fit` event, which the embedded canvas listens for; in embedded mode the button label is “Fit view”, not “fit both panes”;
- switching mode changes no selection, resets no mapping, and writes nothing to the project file;
- `ReconPanel`'s “Reset view settings” resets the embedded-specific fields as well, but keeps `layoutMode`;
- optional: add tube width, lane spacing and the transfer/loss switches to the “View” section of `ReconPanel`;
- it is recommended to extract the existing side-by-side canvas into `SideBySideReconCanvas`, mounted only in side-by-side mode; if that split is not done, at least short-circuit the layout/anchor memos of `ReconciliationView` by mode, so embedded mode does not still compute the two panes.

New strings in `src/ui/strings.ts`:

```ts
layoutSideBySide: 'Side-by-side',
layoutEmbedded: 'Embedded',
tubeWidth: 'Species branch thickness',
laneGap: 'Gene lane spacing',
showTransfers: 'Show transfer arcs',
showLossStubs: 'Show loss stubs',
topologicalSketch: 'Topological sketch (no ages / branch lengths)',
orphanGutter: 'Unmapped gene nodes',
legendTube: 'Species branch tube',
legendGene: 'Gene lineage',
legendInferred: 'Display-inferred (dashed, not stored)',
```

[translator note: the Chinese source lists this snippet with its zh-CN literals and then says “and the corresponding English”; the values above are the en-locale strings as shipped, one key per line, so both locales carry the same set.]

### 7.2 How the existing options behave in embedded mode

| Option | Side-by-side mode | Embedded mode |
| --- | --- | --- |
| `mappingScope` | decides whether mapping lines are shown | mutes the emphasis on non-matching gene nodes, hides no topology |
| `eventFilter` | filters the mapping lines | mutes non-matching events; selected/hovered elements are always shown |
| `showLabels` | node labels | species + gene labels (with LOD) |
| `showEventGlyphs` | event glyphs | the σ/δ/τ glyphs on gene nodes |
| `showLosses` | λ badges | in-tube loss stubs + λ badges |
| `showMappings` | the mapping bridge lines | mapping anchors / annotation layer; controls no embedded branch |
| `syncZoom` | both sides synchronised | not applicable, disabled |
| `embeddedShowTransfers` | not applicable | transfer arc switch |
| `embeddedShowLossStubs` | not applicable | loss stub switch |

### 7.3 Viewport

- A single transform (`{ tx, ty, scale }`), reusing `RECON_MIN_SCALE` / `RECON_MAX_SCALE`.
- Wheel zoom is anchored at the pointer; dragging the background pans; use `ReconPane`'s coalesced per-frame commit pattern.
- Fit: `fitEmbeddedBounds(scene.bounds, width, height)`; when the window resizes, Fit mode refits automatically, and after a manual pan only clamping happens.
- 1:1: keep the current centre, restore the zoom to 100%.
- `reconFocusTarget`: centre the selected gene node; if a species node is selected, centre the corresponding tube.

### 7.4 Selection and hover

- Clicking a gene node: keeps the current `selectGeneNode` logic, clearing the species selection on select.
- Clicking a species node/tube: selects the species node and clears the gene selection.
- Hovering a gene node: highlights all of its gene segments, its host tube and its transfer arcs; other elements may optionally be muted.
- Hovering/clicking a transfer arc: selects the corresponding gene node, and the inspector shows the transfer donor/recipient.
- Hovering a loss stub: shows a tooltip with the corresponding gene node and species node.

### 7.5 Mapping editing and path building (Phase 3, required)

- Alt + click on a species branch tube: maps the single currently selected gene node to the child species node of that tube;
  - if “exact position” editing is on, `branchFraction = t` is written at the same time;
  - when it is off, the interaction behaves as a plain node mapping, staying consistent with the side-by-side view;
  - if the mapping target changes and no new `branchFraction` is supplied, the old `branchFraction` must be deleted (it points at a position on the old branch); editing only the event/donor keeps it.
- Drag and drop (optional):
  - dragging a gene node onto a tube updates `speciesNode` and `branchFraction`;
  - dragging a transfer arc endpoint replaces the donor/recipient (an explicit `transferDonor` is required);
  - during the drag a temporary ghost previews the result, and on release the write goes through `store.apply()`, entering the undo stack automatically.
- The inspector (`GeneAssumptionInspector.tsx`) gains:
  - “branch position”: a 0–100% slider/number, with an “automatic” switch;
  - “transfer donor”: a species node dropdown (shown only when `event === 'transfer'`);
  - an “automatically derived” label: explaining that the layout decides the field when it is absent.
- When the event changes from `transfer` to another type, `transferDonor` is deleted; when the recipient mapping changes, the explicit donor is re-validated as still lying outside the recipient subtree, and if not, the automatic derivation is used as a fallback with a hint.
- Validation:
  - an out-of-range `branchFraction` is clamped; a `transferDonor` that does not exist is reported;
  - a transfer donor inside the recipient subtree is reported as “the donor should lie outside the recipient subtree”;
  - time-infeasible transfers keep being reported by the existing `timing` check.
- Applying a DTL scenario (`dtlScenarioToAssumptions`) follows the keep/discard rules of §4.2.
- The exported report gains the new fields, so a hand-built hypothesis can be read by external tools.

### 7.6 Status bar and panels

- `ReconStatusBar` currently receives `speciesZoom` / `geneZoom`. Embedded mode needs a single zoom readout:
  - preferably switch to clearer props, `mode: ReconLayoutMode` and `zoom: number`, while keeping the two readouts for side-by-side mode;
  - alternatively pass `speciesZoom = geneZoom = zoom` in embedded mode, but the copy must still collapse to a single value, so it does not mislead with “species/gene zoom”.
- `ReconWorkspacePanel` in `src/canvas/ReconWorkspace.tsx` currently writes `onZoomChange(species, gene)` into `{ species, gene }`; embedded mode must report `layoutMode` or a single `zoom` as well, and the call sites of `ReconStatusBar` must be updated in step.
- Hover/click positioning in the “Scenario” panel keeps working in embedded mode; hovering a row highlights the corresponding gene segment/tube.
- The “View” panel gains embedded-specific options; side-by-side-only options are hidden in embedded mode, so no dead controls are offered.

### 7.7 Keyboard

- Esc leaves the reconciliation workspace: unchanged.
- ⌘⇧F / Ctrl + Shift + F: calls Fit for the current mode.
- Enter/Space to select a node: reuses the existing node keyboard handling.
- Optional: `[` / `]` jump between the unmapped nodes, reusing the existing previous/next-unmapped-node logic.

### 7.8 The hypothesis-building workflow (meeting the user requirement)

This step turns “looking at the figure” into “building the path”, and is the acceptance scenario for Phase 3:

1. Select a gene node in the embedded canvas; the inspector shows the current host branch, branch position, event and losses.
2. Alt + click the target host branch, or drag the node onto a branch:
   - writes `speciesNode = the child node id of that branch`;
   - writes `branchFraction = t` if exact positioning is on;
   - drag and drop is the enhancement, Alt + click is the baseline interaction that must work.
3. Choose the event σ/δ/τ in the inspector; for τ, confirm or change the donor (derived by default from “the child outside the recipient subtree”).
4. Edit the asserted losses; the layout redraws immediately, clearly separating the structural inference from the asserted value.
5. The validation panel shows the errors/warnings; the status bar updates σ/δ/τ/λ and the cost.
6. Save the project and reopen it: the path and the visual fields are preserved; export NHX/Markdown/SVG as hypothesis material.
7. Optional: record the hypothesis statement and its evidence in an existing hypothesis layer or node note; that integration is outside the minimum required scope of this plan.

Note: path building edits “the mapping, the branch position, the event, the donor and the losses”, not the gene-tree topology; the gene-tree topology stays read-only, so that assumptions stored by node id cannot be invalidated.

---

## 8. Export

### 8.1 Scope

The first version exports **SVG** first, because it is vector, easy to post-process, and carries the lowest implementation risk. PNG/PDF reuse the existing rasterisation/PDF pipeline once the SVG path is stable.

### 8.2 Pure scene to SVG

Add `src/io/embeddedReconExport.ts`:

```ts
export interface EmbeddedExportOptions {
  includeLegend?: boolean;
  includeMetadata?: boolean;
  background?: string;
  marginPx?: number;
}

export interface EmbeddedExportResult {
  svg: string;
  width: number;
  height: number;
  bounds: EmbeddedBounds;
}

export function buildEmbeddedReconSVG(
  project: Project,
  entry: GeneTreeEntry,
  viewOptions: ReconViewOptions,
  exportOptions?: EmbeddedExportOptions,
): EmbeddedExportResult;
```

Implementation points:

- Reuse `computeEmbeddedReconLayout`; do not write a second set of geometry.
- The scene and the React renderer share the same `EmbeddedReconLayout`; the exporter's only job is to paint the scene into a string.
- The output must contain: tubes, the gene segment mask, transfer arcs, loss stubs, nodes, labels, the legend, and version/timestamp metadata.
- Labels use an explicit font family; CJK text follows the font strategy of `exportImage.ts` (reusing its existing handling when PNG needs a canvas text fallback).
- The legend states: tube = species branch, thin line = gene lineage, the meaning of σ/δ/τ/λ, whether the figure is a topological sketch, the gene tree name, the event counts and the total cost.
- If `timeFeasible === null`, the legend notes “timing not checked”.

### 8.3 PNG/PDF

- Preferably extract reusable `svgStringToPng` / `svgStringToPdf` helpers from `exportImage.ts`, or reuse its internal rasterisation steps; if the coupling proves too deep, ship only the SVG export first and leave PNG/PDF for a follow-up minor version.
- Export size: computed from the scene bounds + margin; do not reuse the standard canvas's `canvas.width/height`.
- A transparent-background option is optional; by default use the theme background or an explicit white.

### 8.4 Entry points

- Add an “Export embedded figure” button to `ReconToolbar` (shown only in embedded mode), or add “Export embedded reconciliation figure (SVG)” to the command palette.
- Reuse the save/download utilities of `src/io/fileActions.ts`; the desktop shell uses the native save dialog, the browser preview uses a download.
- The behaviour of the existing “Export reconciliation report (Markdown)” is unchanged.

---

## 9. Test plan

### 9.1 Unit tests

**`src/model/reconPlacements.test.ts`**

- An explicit assumption takes precedence over label matching; an unmatched tip goes into `unmappedGeneNodes`.
- An internal node with no assumption but with every child locatable is inferred onto the children's MRCA, with `source = 'inferred-mrca'`, `inferred = true`, and nothing written into `assumptions`.
- If any child is unlocatable, the parent is not inferred and goes into `unmappedGeneNodes`.
- A dangling `speciesNode` is not accepted as an effective position; a tip falls back to label mapping, an internal node is taken over by display inference (if its children are locatable) or goes to unmapped, and `dangling-assumption` is always produced.
- A species node hidden by collapsing cannot act as the host; `hidden-host` or unmapped is produced, following the same rule as an invisible target in the side-by-side view.
- The β4 of `recon-family` is inferred onto N4; the label mappings of its children E/F keep their real source.
- `branchIdOf` returns `null` for the species root and the child node id for everything else.
- The `same/down/up/lateral` classification of `speciesPathBetween` is correct.
- `lossesAlongSpeciesPath` agrees pairwise with `minLossesBetween` on random and fixed trees.
- A polytomy fork costs `m-1` losses; a node with a single child costs 0.

**`src/layout/embeddedRecon.test.ts`**

- Every gene node with an *effective placement* (assumption, tip-label, inferred) has coordinates inside the range of its host tube/hub (lane offsets allowed); genuinely unmapped nodes go into the orphan gutter.
- σ: the two children enter different child species branches.
- δ: the children share the host branch but use different lanes.
- τ: the transfer arc's endpoints lie on the centrelines of “the donor branch, i.e. the branch of the child outside the recipient subtree” and “the recipient branch”; an explicit `transferDonor` overrides the automatic derivation; with no child outside the subtree only a warning dashed line is produced.
- Transfer branch precedence: in sample α the recipient n1 of αAC is a descendant of the parent mapping root, and a transfer arc from the donor C branch → the recipient n1 branch must still be drawn; it must **not** be drawn as an ordinary descent along the root→n1 species path.
- λ: the total structural loss matches the aggregate of `lossesAlongSpeciesPath`; when `asserted >= structuralMin` the extra loss is marked from `asserted` and the total equals the assertion; when `asserted < structuralMin` an “insufficient assertion” state is produced and no equality with the status bar is claimed; when nothing is asserted the structural loss is marked `inferred`.
- The `recon-family` sample: all of α's σ/δ/τ/λ are drawable; β4 is display-inferred and the gene tree stays connected; β's validation result still contains only the single `unresolved` warning.
- Unmapped nodes go into the orphan gutter and are not lost; when the parent is unmapped but the child has a position, an `unknown-path` dashed connector is produced, without fabricating a parent mapping.
- Determinism: two runs on the same input are deep-equal.
- Bounds: `bounds` covers tubes, hubs, labels, transfer arcs and loss badges; all coordinates are finite, no NaN.
- Overflow: a large gene family produces `lane-overflow`, and the width never exceeds the cap.
- Infeasible paths: `up`/`lateral` with no transfer produce no ordinary embedded segment and produce the matching issue.
- Mask geometry: horizontal tubes + vertical hubs + node circles cover the centreline of every gene segment; no hub is missing.

**`src/canvas/embeddedReconGeometry.test.ts`**

- `pointOnTube` lands on the parent end at t=0 and on the child end at t=1.
- Lane offsets never leave the tube; the Fit bounds include labels, transfer arcs and loss badges.
- Hit testing: a point inside a tube returns the correct branchId and t; a point outside returns null.

### 9.2 Component tests

- Switching `layoutMode` renders the embedded canvas; switching back to side-by-side leaves the original panes in place.
- Clicking a gene node triggers `selectGeneNode`; Alt + click on a tube triggers a mapping update (mock store), and `branchFraction` is not written when exact positioning is off.
- A display-inferred node gets the dashed/hollow style, while the inspector still reports “unmapped”; layout inference never introduces a new validation problem.
- In embedded mode the status bar shows a single zoom readout; side-by-side mode still shows the species and gene readouts.
- The mask id is unique; the layer order is correct; the selected/hovered class names appear.
- The CSS variables exist under both the dark and the light theme (jsdom + class assertions are enough, no real visual comparison); both the explicit-dark and the system-dark branch must be covered.

### 9.3 Export tests

- The output of `buildEmbeddedReconSVG` parses in the DOM; it contains the expected number of tubes, masks, transfer arcs and loss marks.
- No `NaN`, no `Infinity`, no unescaped labels.
- CJK labels are present; the metadata contains the version/timestamp.
- Geometry is shared with the React scene: for the same input, the element counts and key coordinates agree.

### 9.4 Persistence and regression

- `projectIO` round trip: a project carrying `branchFraction` / `transferDonor` survives save and load without loss; illegal values are clamped/dropped and reported.
- `setAssumption`'s `{ ...cur, ...patch }` preserves/updates the new fields; clearing a mapping removes the fields with it.
- `dtlScenarioToAssumptions`: the same target keeps the visual fields, a changed target drops them; if the node is missing from the new scenario the fields disappear too; covered by tests.
- `reconExport.geneTreeNhk`: an explicit `transferDonor` overrides the automatic derivation, and the NHX output contains `BF=` / `TD=`.
- All existing side-by-side view tests still pass; `reconPaneGeometry.test.ts` / `reconViewport.test.ts` should not need modification (unless a shared utility is refactored).
- `npm run typecheck`, `npm test`, `npm run build`.

### 9.5 Performance

- Use the `recon-family` sample for a basic benchmark.
- Synthesise a species tree with 100–200 tips plus a gene tree with 300–600 nodes, and verify:
  - the layout computation is acceptable (target < 100 ms, with the concrete threshold recorded by a benchmark script at implementation time, to avoid brittle absolute-time assertions);
  - pan/zoom recomputes no layout (verifiable with a spy/memo counter);
  - the number of DOM elements after viewport culling stays under control.
- Optional: add `scripts/bench_embedded_recon.mjs`, following the output style of `scripts/bench_tips.mjs`.

### 9.6 Manual acceptance

- Light and dark theme;
- widths 1024 / 1200 / 1440;
- high DPI;
- zoom 15% / 100% / 400%;
- selection, hover, Alt + click, Fit, 1:1, switching gene tree, undo/redo;
- unmatched tips, unmapped nodes, and the scenario after applying DTL;
- a time-calibrated species tree with ages and a topological tree without ages.

---

## 10. Phased implementation

Phases 1–3 are the required scope for meeting the user's core requirements (embedded presentation + building the path oneself); Phase 4 is figure production and documentation support, recommended to be done in the same period but not blocking path building.

### Phase 0: design confirmation (0.5 day)

Deliverables:

- settle the open questions of §12;
- confirm the milestone boundaries: Phases 1–2 deliver the read-only embedded visualisation; the path editing/persistence of Phase 3 is part of the final required scope;
- confirm the defaults for tube width / lane spacing.

No code is written.

### Phase 1: semantics and layout foundation (2–3 days)

Added:

- `src/model/reconPlacements.ts`
- `src/model/reconPlacements.test.ts`
- `src/layout/embeddedRecon.ts`
- `src/layout/embeddedRecon.test.ts`

Modified:

- `src/model/types.ts`: add `ReconLayoutMode` and the `ReconViewOptions` fields (no UI wiring yet).

Acceptance:

- the pure layout tests cover σ/δ/τ/λ, unmapped nodes, infeasible paths, determinism and bounds;
- the cross-test of `lossesAlongSpeciesPath` against `minLossesBetween` passes;
- no existing UI behaviour is affected.

### Phase 2: read-only embedded view (3–4 days)

Added:

- `src/canvas/EmbeddedReconCanvas.tsx`

Modified:

- `src/canvas/ReconciliationView.tsx`: branch the rendering on `layoutMode`;
- `src/canvas/ReconWorkspace.tsx`: single-viewport zoom / status-bar wiring (`ReconWorkspacePanel`);
- `src/ui/ReconToolbar.tsx`: the mode switch;
- `src/ui/ReconPanel.tsx`: embedded view options;
- `src/ui/ReconStatusBar.tsx`: single/double zoom readout;
- `src/styles/app.css`: tube and embedded-canvas styles;
- `src/ui/strings.ts`: Chinese and English copy.
- Optional: `src/canvas/SideBySideReconCanvas.tsx`, extracting the side-by-side canvas into its own component.

Acceptance:

- the sample can be switched, and Fit/zoom/pan/selection/hover work;
- no regression in side-by-side mode;
- the performance and accessibility checks pass.

### Phase 3: editable hypothesis (3–5 days, required)

> This phase directly implements the user's requirement to “build, from that structure, the evolutionary path of the gene tree inside the species tree yourself”, and cannot be omitted. At minimum: Alt + click mapping + branch position/donor editing + persistence; drag and drop is an enhancement.

Modified:

- `src/model/types.ts`: `branchFraction` / `transferDonor`;
- `src/ui/GeneAssumptionInspector.tsx`: the position/donor fields;
- `src/model/geneTrees.ts`: mapping-update helpers (if needed);
- `src/model/dtl.ts`: keep/discard the visual fields when applying a scenario;
- `src/io/projectIO.ts`: clamp/clean the new fields on load;
- `src/io/reconExport.ts`: report/NHX output of the new fields;
- `src/canvas/EmbeddedReconCanvas.tsx`: species branch tube hit testing, Alt + click, drag and drop (optional).

Acceptance:

- mapping edits enter the undo stack;
- the save/load round trip holds;
- applying DTL produces no dangling fields;
- the report includes the branch position and the donor.

### Phase 4: figures and documentation (2–3 days)

Added:

- `src/io/embeddedReconExport.ts`
- `src/io/embeddedReconExport.test.ts`

Modified:

- `src/ui/ReconToolbar.tsx` / `CommandPalette.tsx`: the export entry points;
- `docs/MANUAL_ZH.md` / `docs/MANUAL_EN.md`: usage documentation;
- `README_ZH.md` / `README.md`: check off the roadmap item;
- `docs/FORMAT.md`: documentation of the new optional fields (already implemented in Phase 3);
- `CHANGELOG.md`;
- `docs/AI_PROVENANCE.md`: register the AI-assisted changes as the repository requires.

Acceptance:

- the SVG opens, prints, and its labels are correct;
- PNG/PDF (if implemented) match the SVG visually;
- the documented steps are reproducible.

---

## 11. File-level change list

| File | Change | Phase | Risk |
| --- | --- | --- | --- |
| `src/model/types.ts` | add `ReconLayoutMode`, the view options, the optional assumption fields | 1 / 3 | low; a pure type extension |
| `src/model/reconPlacements.ts` | add effective placements, species paths, loss splitting, transfer donor derivation | 1 | medium; must match the DTL semantics |
| `src/layout/embeddedRecon.ts` | add the embedded layout, lanes, scene geometry | 1 | high; the core algorithm |
| `src/canvas/EmbeddedReconCanvas.tsx` | add the single-viewport embedded rendering | 2 | high; SVG mask / layers / performance |
| `src/canvas/ReconciliationView.tsx` | branch by mode; share the mapping merge logic; short-circuit the two-pane memos | 2 | medium; avoid a side-by-side regression |
| `src/canvas/ReconWorkspace.tsx` | single-viewport zoom / status-bar wiring; arguments of `ReconWorkspacePanel` | 2 | low |
| `src/canvas/SideBySideReconCanvas.tsx` (optional new file) | extract the side-by-side canvas, so embedded mode does not still compute two panes | 2 | medium; existing behaviour must be preserved |
| `src/ui/ReconToolbar.tsx` | side-by-side/embedded switch, hiding sync zoom, Fit label | 2 | low |
| `src/ui/ReconPanel.tsx` | embedded view options | 2 | low |
| `src/ui/ReconStatusBar.tsx` | single/double zoom readout | 2 | low |
| `src/ui/strings.ts` | Chinese and English copy | 2 | low |
| `src/styles/app.css` | tube/embedded-canvas styles, theme variables | 2 | medium; light/dark contrast |
| `src/ui/GeneAssumptionInspector.tsx` | branch position, transfer donor fields | 3 | medium |
| `src/model/geneTrees.ts` | mapping-update helpers (as needed) | 3 | low |
| `src/model/dtl.ts` | keep/discard the visual fields when applying a scenario | 3 | medium; avoid dangling fields |
| `src/io/projectIO.ts` | clamping/cleaning of the new fields | 3 | low |
| `src/io/reconExport.ts` | report/NHX for the new fields | 3 | low |
| `src/io/embeddedReconExport.ts` | embedded SVG export | 4 | medium; fonts and metadata |
| `src/io/exportImage.ts` | extract reusable rasterisation helpers (if needed) | 4 | medium; do not break the standard export |
| `README.md` / `README_ZH.md` | roadmap check-off | 4 | low |
| `docs/MANUAL_ZH.md` / `docs/MANUAL_EN.md` | usage documentation | 4 | low |
| `docs/FORMAT.md` | documentation of the optional fields | 3/4 | low |
| `docs/AI_PROVENANCE.md` | registration of AI-assisted changes | every phase | low |

---

## 12. Risks and open questions

| Item | Risk | Recommendation |
| --- | --- | --- |
| Is the automatic path unique? | Node mappings alone allow several reasonable paths for the same scenario | adopt a deterministic automatic rule first and state “automatic layout” in the legend; `branchFraction` allows a manual override |
| Should the branch position be persisted? | Keeping it only in view state means it cannot survive as a hypothesis | the user's goal requires persistence; Phase 3 writes it into the project file and exports it in the report/NHX |
| Tube width strategy | a fixed width may not hold a large gene family; an adaptive width changes the visual proportions of the species tree | base width + adaptive cap + overflow hint; explained in the legend |
| Topology vs time | without ages/branch lengths the embedding is only a topological sketch, and transfer timing cannot be checked | the UI states “topological sketch” explicitly; with ages it switches to time semantics automatically |
| Unmapped gene nodes | they cannot be nested, and silently dropping them would mislead | an orphan gutter on the right + dashed connectors to the nearest mapped ancestor; counted in the status bar |
| Internal node without an assumption but with locatable children | if dumped into the orphan gutter, the gene tree of sample β breaks apart | use display inference onto the MRCA; not written into the assumptions, marked dashed |
| Loss display vs the status bar | with no assertion, or an assertion below the structural minimum, the numbers may differ | display the three states of §5.7; make the inferred/warning distinction explicit and promise no unconditional equality |
| The transfer donor convention | a parent-branch default conflicts with the existing “child outside the subtree” convention | follow `validateScenario` / `geneTreeNhk`; an explicit field overrides |
| Hub bars clipping connector lines | masking only the horizontal tubes would clip the connectors crossing between sub-tubes | the hub bars + node circles enter the mask; the whole species tree is thickened |
| Side-by-side view regression | extracting shared logic may affect the existing mapping editing | use new files for the embedded view; extract only pure functions and add tests |
| Export coupling | `exportImage.ts` is deeply coupled to the standard canvas | build a standalone SVG exporter first; PNG/PDF reuse the rasterisation steps later |
| Performance on large gene families | the lane count and the number of SVG elements grow | viewport culling, memo, lane cap, LOD, benchmarks |
| Multiple gene trees | the first version draws only the current gene tree | multi-gene-tree overlay is implemented separately per the roadmap |
| Loss positions lost by DTL | `lossMarks.at` is not persisted | use the structural minimum in the first version; add an optional `lossMarks` field when exact reproduction is needed |

### Recommended default decisions

1. The side-by-side view stays the default; the embedded view is the second mode.
2. The read-only embedded view comes first as a development milestone; **the final delivery must include Phase 3's branch position, donor and mapping editing**, otherwise the “build the path yourself” requirement is not met.
3. The tube width is adaptive but capped; default `18` world px, cap `32`.
4. Unmapped nodes go into the orphan gutter and are never dropped silently; internal nodes without an assumption but with locatable children use display inference.
5. Without ages/branch lengths, label the figure explicitly as a “topological sketch”.
6. The first version exports SVG only; PNG/PDF are added once the SVG path is stable.

---

## Appendix A: event routing quick reference

| Situation | Path/geometry | Colour | Notes |
| --- | --- | --- | --- |
| Parent and child mapped to the same species node (not a transfer) | a short fork / parallel lanes inside one tube | the child's event colour | the constraint parent t < child t must hold |
| The child mapping lies inside the parent's subtree (not a transfer) | downwards along the species path, one segment per branch | the child's event colour | each intermediate fork produces a loss |
| Child `event=transfer` (whatever the parent/child mapping relation) | a transfer arc from the donor child's branch → the recipient branch, plus a short τ-coloured dashed parent branch; no ordinary descent along the species path | τ colour | the arc is an event annotation; the donor = the branch of the child outside the recipient subtree |
| The child mapping lies outside the parent's subtree, not a transfer | a dashed warning path | grey | produces a layout issue, fabricates no nesting |
| The child mapping is an ancestor of the parent | a dashed warning path | grey/red | time travel, validation already reports an error |
| A mapping exists but the event is not annotated | a dashed hollow node at the mapped node | grey | never coloured as part of a legal path |
| No mapping but all children locatable | a display-inferred node on the incoming branch of the MRCA | grey dashed | not written into the assumptions; changes neither validation nor statistics |
| No mapping and no inference possible | orphan gutter + dashed connector | grey | counted in the status bar; no fabricated parent mapping |
| A mapped tip + asserted losses | a terminating stub inside the tube | λ colour | follows the three-state strategy of §5.7; when the assertion covers the structural minimum the totals agree |

## Appendix B: sample scene input and output

```ts
const scene = computeEmbeddedReconLayout({
  speciesDoc,
  speciesLayout: computeLayout(prepareEmbeddedSpeciesDoc(speciesDoc)),
  geneDoc: entry.doc,
  assumptions: entry.assumptions,
  options: {
    tubeWidth: 18,
    laneGap: 3,
    minTubeWidth: 12,
    maxTubeWidth: 32,
    showTransferArcs: true,
    showLossStubs: true,
  },
});

scene.tubes.get(speciesChildId);        // the horizontal tube of that species branch
scene.hubs.get(speciesParentId);        // the hub bar of that parent node
scene.placements.get(geneNodeId);       // the position of the gene node inside the tube
scene.placements.get(geneNodeId)?.inferred; // the display-inference flag
scene.segments.filter(s => s.hostBranchId === speciesChildId);
scene.transfers;                        // transfer arcs (including donor/recipient gene node)
scene.losses;                           // structural / inferred / asserted losses
scene.orphans;                          // the nodes that genuinely cannot be located
scene.issues;                           // lane-overflow / unknown-path and friends
```

## Appendix C: index of the existing code

| Topic | File |
| --- | --- |
| The side-by-side reconciliation view and the mapping bridge | `src/canvas/ReconciliationView.tsx`, `src/canvas/ReconMappingLayer.tsx` |
| Reconciliation workspace / status-bar wiring | `src/canvas/ReconWorkspace.tsx`, `src/ui/ReconStatusBar.tsx` |
| Pane rendering, Fit, LOD, culling | `src/canvas/ReconPane.tsx`, `src/canvas/reconViewport.ts` |
| The mapping anchor/projection layering | `src/canvas/reconMapping.ts` |
| Mapping and loss semantics | `src/model/reconciliation.ts`, `src/model/treeOps.ts` |
| Writing a DTL scenario back into the assumptions | `src/model/dtl.ts` (`dtlScenarioToAssumptions`) |
| Editing assumptions | `src/ui/GeneAssumptionInspector.tsx`, `src/model/geneTrees.ts` |
| View options and state | `src/model/types.ts`, `src/model/store.ts` |
| Toolbar / panel / status bar | `src/ui/ReconToolbar.tsx`, `src/ui/ReconPanel.tsx`, `src/ui/ReconStatusBar.tsx` |
| Styles and themes | `src/styles/app.css` |
| Report and NHX | `src/io/reconExport.ts` |
| Image export of the standard canvas | `src/io/exportImage.ts` |
| Project persistence | `src/io/projectIO.ts` |
| The reconciliation sample (including β4) | `src/model/sampleTree.ts`, `src/model/sampleRecon.test.ts` |

## Appendix D: review checklist for this pass

| Item checked | Source evidence | Conclusion |
| --- | --- | --- |
| The side-by-side view is independent two-pane + mapping bridge | `speciesLayout` / `geneLayout` in `ReconciliationView.tsx` and `ReconMappingLayer` | the document is accurate |
| Species branches are a fixed thin line | `PaneEdge` in `ReconPane.tsx`: `strokeWidth={1.4}`, `non-scaling-stroke` | the document is accurate; embedded mode must implement its own thick tubes |
| Assumptions carry node-level mappings only | `GeneNodeAssumption` in `types.ts` (`speciesNode/event/losses/meta`) | the document is accurate; `branchFraction`/`transferDonor` are new fields |
| `projectIO` preserves assumptions | `{ ...g, doc }` in `projectIO.ts` | the new optional fields need no migration |
| Applying DTL rebuilds assumptions | `dtlScenarioToAssumptions` in `dtl.ts` | the document now requires keep/discard rules |
| The existing transfer donor convention | the transfer check in `reconciliation.ts` (child outside the subtree = donor child), `reconExport.geneTreeNhk` | the document now says “the branch of the child outside the subtree” |
| A transfer branch must not descend along the ordinary path | in sample α the recipient n1 of αAC is a descendant of the parent mapping root; `speciesPathBetween` would draw a descent | the document adds “check `event=transfer` first, the transfer arc takes precedence” |
| The unmapped node of sample β | β4 in `sampleTree.ts` (no assumption, children E/F label-matchable); `sampleRecon.test.ts` asserts exactly 1 `unresolved` | the document adds the display inference rules |
| Where the loss counts come from | `scenarioSummary` in `reconciliation.ts` sums only `assumptions[].losses`; `validateScenario` reports `loss-shortfall` | the document adds the three-state display strategy and drops the unconditional equality claim |
| The dual zoom interface of the status bar | `ReconWorkspacePanel` in `ReconWorkspace.tsx` → `ReconStatusBar speciesZoom/geneZoom` | the document adds the single-viewport wiring |
| The dark theme selector | `:root[data-theme='dark']` and `@media (prefers-color-scheme: dark)` in `app.css` | the selectors in the document are corrected |
| The scope of graphics export | `buildSVG(project)` in `exportImage.ts` covers only the standard canvas; `reconExport.ts` outputs Markdown only | the document lists embedded SVG export as Phase 4 |
| The user's “build the path yourself” requirement | needs editing and persistence of mapping, branch position, event, donor and losses | Phase 3 was changed from optional to required |

**Review conclusion**: after revision, the plan agrees with the code at the factual level and, at the delivery level, covers the user's three core requirements (thick species branches / thin gene branches, gene branches embedded inside species branches, and the user building the path and stating a hypothesis themselves). Implementation should treat Phases 1–3 as the required scope and Phase 4 as figure production support. This review pass modified this document only; no project source code was modified.
