# CladeForge — User Manual (English)

**Applies to CladeForge v0.1.0**

中文版本：[MANUAL_ZH.md](./MANUAL_ZH.md)

CladeForge is a local-first, cross-platform desktop application for building, annotating, and exporting phylogenetic trees with an integrated evolutionary semantic layer. It reframes the phylogenetic tree as a *hypothesis scaffold* — a canvas for constructing, comparing, and refining evolutionary scenarios.

This manual covers every feature of the application, organised by workflow stage.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [The Interface](#2-the-interface)
3. [Tree Editing](#3-tree-editing)
4. [Layout and Visualisation](#4-layout-and-visualisation)
5. [Characters and States](#5-characters-and-states)
6. [Evolutionary Events](#6-evolutionary-events)
7. [Hypothesis Layers](#7-hypothesis-layers)
8. [Inference Assistant](#8-inference-assistant)
9. [DTL Reconciliation](#9-dtl-reconciliation)
10. [Time Calibration](#10-time-calibration)
11. [Styling and Themes](#11-styling-and-themes)
12. [Import and Export](#12-import-and-export)
13. [Keyboard Shortcuts](#13-keyboard-shortcuts)
14. [Project File Format](#14-project-file-format)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Getting Started

### System Requirements

| Platform | Minimum OS | Architecture | Disk | RAM |
|----------|-----------|-------------|------|-----|
| macOS | 11.0 (Big Sur) | arm64, x86_64 | 12.4 MiB measured (v0.1.0, arm64 bundle; installer image 4.6 MiB) | 512 MB |
| Windows | 10 (64-bit) | x86_64 | not yet measured — no Windows build has been produced | 512 MB |
| Linux | glibc ≥ 2.28 | x86_64 | not yet measured — no Linux build has been produced | 512 MB |

The application ships no browser engine of its own, but it renders into the operating system's own web view (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux), which must therefore be present on the host; no other runtime (Java, Python, or Node.js) is needed to run the app.

### Installation

**Pre-built binaries** — Download the release build for your platform from the project release page:
- macOS: `.dmg` (universal — Apple Silicon and Intel)
- Windows: `.msi` (x64)
- Linux: `.deb` or AppImage

**Build from source** — clone the repository:

```bash
git clone https://github.com/ZengZichao/CladeForge.git
cd CladeForge
npm install
npm run dev            # web dev server (no Rust toolchain needed)
npm run tauri dev      # desktop dev build
npm test               # run the Vitest suite
npm run tauri build    # produces the packaged .app / installer
```

Prerequisites: Node.js ≥ 18, Rust toolchain ≥ 1.70, npm.

### First Launch

On first launch, CladeForge opens an empty workspace and offers a four-step guided tour; the offer is opt-in, so dismissing it goes straight to the empty canvas. Replay it whenever you like with the **Beginner Tour** button in the header (beside the shortcut-reference button), by searching "tour" in the ⌘K command palette, or from the shortcut-reference dialog; it walks you through the canvas, the inspector panel, the module rail, and the command palette.

To start immediately, you can:
- **Import a tree** — Drag a `.nwk`, `.newick`, `.tree`, `.tre`, `.nex` or `.nexus` file onto the window, or choose **Import tree** in the File menu. ⌘O / Ctrl+O is **Open project**, which reads a `.cladeforge.json` file.
- **Build from scratch** — Select the root and click the header's **+ Add children** button, which opens one dialog for binary, ternary and polytomy splits.
- **Load a sample project** — Click "Load sample tree" on the empty-state screen, or pick from the sample grid. Six built-in samples cover archaeal domain evolution, bacterial domain evolution (including cyanobacterial oxygenic photosynthesis), viral evolution (RNA/DNA genome types), cetacean aquatic transition, plant terrestrialization (vascular tissue and seeds), and tetrapod terrestrialization (limbs, amniotic egg, and flight). Each sample comes pre-loaded with characters, events, and hypothesis layers.

### Language and Theme

- **Language** — Follows your operating system's language on the first run, then remembers your choice. Switch between English and 中文 at any time from the language toggle; the UI remounts immediately, including node labels that ship with the built-in samples.
- **Theme** — Defaults to System. Choose Light, Dark, or System from the theme toggle next to the language switch.
- **Header controls** — The header carries the view-mode switch (Standard view / Reconciliation view), the **+ Add children** button, undo and redo, the project name, Save, the language and theme toggles, the shortcut reference (⌘?), and the **Beginner Tour** button. Structural editing lives in the node context menu and the command palette, not in the header.

---

## 2. The Interface

CladeForge uses a three-panel layout designed for efficient phylogenetic workflow:

```
┌───────────────────────────────────────────────────┐
│                    Tab bar (top)                   │
├──────────┬───────────────────────────┬──────────┤
│          │                           │          │
│  Module  │       Canvas (centre)     │ Inspector│
│  Panels  │    Tree visualisation     │ (per-    │
│  (left)  │                           │  object) │
│          │                           │          │
└──────────┴───────────────────────────┴──────────┘
```

### Left Panel — Module Panels

Organised into three groups:

| Group | Modules | Purpose |
|-------|---------|---------|
| **Content** | Traits · Hypotheses · Reconcile · Time | Define characters, manage hypothesis layers, run DTL reconciliation, and configure time calibration |
| **View** | Style | Global layout and styling |
| **Output** | Analysis · Export | Inference assistants and file export |

Each module is a collapsible section. Pin a section to keep it expanded, or unpin to let it collapse.

### Centre — Canvas

The main workspace where the phylogenetic tree is displayed and edited. Supports pan, zoom, node dragging, reparenting, link creation, and selection. Structural operations, rerooting, layout switches and view controls live in the node **context menu** (right-click) and the **command palette**; a floating control cluster on the canvas carries the search field, zoom in/out, and fit-to-window.

A **minimap** in the corner provides overview navigation for large trees.

A **scale bar** appears whenever branch lengths are meaningful for the current layout, and a collapsible **canvas legend** lists the character colours, state transitions, event symbols and time annotations currently on screen. Branches whose length was never recorded are drawn grey-dashed and named in the legend, so "no data" is never mistaken for "zero".

### Status Bar

The strip along the bottom reports what is actually on screen: node count, edge count, current zoom percentage (with a note when fit-to-window had to clamp the scale), and the number of selected objects. Selecting exactly two nodes adds a "MRCA highlighted" note. It also carries the autosave indicator described in [Autosave and Recovery](#autosave-and-recovery).

### Small Windows

Below about 1024 px of window width the shell switches to a compact arrangement: the module rail becomes a bottom tab bar, and the left and right panels become overlays that each carry their own close button. ⌘. shows or hides them. The splitters between panels drag between 180 and 620 px, and the widths are remembered between sessions.

### Right Panel — Inspector

When you select a node or custom edge on the canvas, the inspector panel shows all editable properties for that object: name, branch length, support value, age, style overrides, character states, evolutionary events, and confidence/evidence metadata. Properties that inherit from global defaults are marked "Inherits global default"; those you have overridden are marked "Overrides global default."

The inspector is searchable — type in its "Search properties…" field to cut straight to a property, and star a property you use often to pin it in a **Favorites** section at the top. Each section header counts how many of its properties this object overrides, and the introductory hints beside sections can be dismissed. Which sections are open, what you starred, and which hints you dismissed are stored per language, so the panel returns the way you left it.

A node's label gets its own placement controls: nine anchor positions plus an automatic one that chooses the side facing away from the parent, and separate X/Y offsets for fine adjustment.

### Command Palette (⌘K)

Press ⌘K (macOS) or Ctrl+K (Windows/Linux) at any time to open the command palette; press it again to close it. Roughly thirty-five actions are grouped into seven categories — File, Edit, Tree operations, View, Analysis, Reconciliation and Help — each entry carrying an icon and its keyboard hint.

Type to filter. Every command matches its displayed name, its English alias, and the pinyin spelling of its Chinese name, so `dakai` finds Open project and `baocun` finds Save project. Use ↑/↓ to navigate and Enter to execute.

A few actions exist nowhere else but here: extract the selected subtree into a new tab, import a gene tree, enter or exit the reconciliation view, export the reconciliation report, and re-open the beginner tour.

### Tabs

CladeForge supports multiple tabs, each holding an independent project. Click a tab to switch to it, use its × button to close it, and use the **+** button at the end of the tab bar to open a new tab. Tabs are auto-restored on the next launch; corrupt tabs are skipped with a notification.

---

## 3. Tree Editing

### Creating Topology

| Operation | How | Where |
|-----------|-----|-------|
| Add binary / ternary / polytomy split | Select a node → **+ Add children**, then choose the split | The header button opens one dialog; the context menu offers the same, including the branch count and hard/soft polytomy type |
| Add sibling | Right-click a node → **+ Sibling** | Context menu or command palette |
| Insert parent | Right-click a node → **Insert parent** | Inserts a node between the selection and its parent |
| Delete node | Select → Delete / Backspace | Risky deletions ask for confirmation, and the Undo in the toast reverts that deletion |
| Rename node | Double-click a node | Inline edit |

### Reparenting and Rerooting

- **Reparent** — Hold Alt and drag a node onto another node. The dragged node moves to the target's children.
- **Reroot at selected** — Right-click → "Reroot at this node", or run it from the command palette. Confirms because rerooting rearranges topology.
- **Midpoint reroot** — Reroots at the midpoint of the longest path (requires branch-length data).
- **Outgroup reroot** — Right-click → "Set as outgroup & reroot."

### Collapse and Ladderize

- **Collapse/Expand** — Right-click a node → "Collapse/Expand subtree." Collapsed subtrees show a triangle marker.
- **Ladderize ascending/descending** — Sorts children at every node by subtree size, producing a more compact and readable tree. Available from the context menu or the command palette.

### Custom Edges (Reticulation Links)

Beyond the tree topology, CladeForge supports custom edges for reticulation events (hybridisation, horizontal gene transfer, etc.):

1. Hover a node — a small circular **port** appears at its top-right.
2. Drag from the port to another node to create a custom edge.
3. Configure the edge's label, colour, width, dash style, arrow, and curvature in the inspector panel.
4. Select the edge and press Delete, or right-click it to delete it.

### Multiple Selection

- **Shift + click** to select multiple nodes.
- With two nodes selected, their **most recent common ancestor (MRCA)** is highlighted with an orange ring.
- The inspector panel shows batch-edit options (fill, stroke, size, label colour, font size, branch colour, show/hide labels, delete selected).

### Search

Open the search field with the magnifier button in the canvas controls, or press ⌘F / Ctrl+F, to find nodes by label. Matches are highlighted on the canvas and counted. Prefix the query with `type:leaf` or `type:internal` to restrict hits to terminal or internal nodes, and press Enter to cycle through the matches.

---

## 4. Layout and Visualisation

### Layout Types

| Layout | Description |
|--------|-------------|
| **Rectangular cladogram** | Equal-depth steps; branch lengths ignored. Classic publication style. |
| **Rectangular phylogram** | Branch lengths determine horizontal position; tips are not aligned. |
| **Geological time chart** | Nodes positioned on a real time axis by their recorded ages; geological era bands and environmental events overlay it. The layout is internal id `time-calibrated`. |
| **Circular** | Radial layout; equal-angle or branch-length-based. |

### Orientations

Four orientations are available for every layout type:
- **LR** — Left to right (default)
- **RL** — Right to left
- **TB** — Top to bottom
- **BT** — Bottom to top

### Layout Modes

- **Auto** — Nodes are positioned automatically based on the layout type and spacing parameters.
- **Manual** — You can drag individual nodes to override their position. Pinned nodes are ignored by auto-layout. Use **Re-layout** in the Style module (or the command palette) to clear all manual positions and re-run auto-layout.

### Spacing

Adjust the **level gap** (horizontal spacing between depth levels) and **sibling gap** (vertical spacing between adjacent leaves) in the Style module panel.

### Support Threshold

A project stores a **support threshold** (0–100, default 70). Its one live effect is on the exported figure: in the exported SVG, a support label below the threshold is printed in the muted axis grey rather than full black, so weakly supported nodes read as weak in the publication image. Support held on a 0–1 scale (posterior probabilities) is converted to a percentage before the comparison, and trees carrying no support values are unaffected.

The threshold is project data: it is read from the project file, and the **Style panel exposes no control for it**.

### Colour Gradient

Enable a depth-based branch colour gradient: branches without per-node colour overrides are interpolated from a root colour to a tip colour.

---

## 5. Characters and States

The character system is the core of CladeForge's evolutionary semantic layer. It lets you map traits onto the tree and visualise their distribution, transitions, and ancestral states.

### Creating Characters

1. Open the **Traits** module (left panel, Content group).
2. Click **+ New character**.
3. Enter a name and choose the type:
   - **Discrete** — Define a set of named states, each with a colour (e.g., "Aquatic" = blue, "Terrestrial" = green).
   - **Continuous** — Define a numeric range with a low-value colour and high-value colour ramp.
4. Optionally add a description.

### Assigning States

- **Tips (leaves)** — Observed/known states. Assign via the **Character Matrix** dialog (click "Character matrix…" in the Traits module) or per-node in the inspector panel.
- **Internal nodes** — These are your *ancestral-state hypotheses*. Select an internal node on the canvas, then assign its character state in the inspector's "Character states" section. Each assignment can carry a confidence level (High/Medium/Low) and supporting/contradicting evidence text.

### Character Matrix

The Character Matrix dialog provides a spreadsheet-style view of all tips × all discrete characters. It is the fastest way to enter observation data. Only leaves are listed; ancestral-state hypotheses for internal nodes are set in the canvas inspector.

### Sankoff Step Matrix

For discrete characters, you can define an optional **cost matrix** (Sankoff step matrix) specifying asymmetric transition costs. The matrix editor supports symmetric mode (edit the upper triangle; the lower mirrors automatically). The cost matrix affects parsimony suggestions and consistency checks. Use "Reset to equal weights" to revert to Fitch parsimony (0 on diagonal, 1 elsewhere).

### Colour Mapping

In the Traits module, use the "Colour by" dropdown to colour nodes and branches by a character's states. State transitions are optionally shown as markers on branches.

### Missing and Not-Applicable Data

- **Missing (?)** — The state is unknown/unobserved.
- **Not applicable (-)** — The character does not apply to this taxon.

---

## 6. Evolutionary Events

CladeForge provides 15 built-in evolutionary event types across six groups — Speciation, Extinction, Key evolution, Gene flow, Biogeography, and a General group whose single member is the user-definable custom event. Events are *asserted by the user* — they represent your hypotheses about what happened at specific points in the tree.

### Event Catalogue

| Group | Events (badge code) |
|-------|--------|
| **Speciation** | `AL` Allopatric, `SY` Sympatric, `PA` Parapatric, `PO` Polyploid |
| **Extinction** | `LX` Local extinction, `MX` Mass extinction |
| **Key evolution** | `KI` Key innovation, `AR` Adaptive radiation, `BN` Bottleneck |
| **Gene flow** | `HG` Horizontal gene transfer, `HY` Hybridisation |
| **Biogeography** | `DI` Dispersal, `VI` Vicariance, `RE` Regional extirpation |
| **General** | `CU` Custom event |

Each event type has a badge code — two uppercase letters taken from its English name — a colour, and a default anchor: node, branch, or either. On the canvas the code sits inside a ring drawn in that colour; the legend, the inspector and the type dropdown always spell out the full name in your UI language. Codes are plain text, so a badge exports to SVG, PNG and PDF exactly as it appears on screen and stays readable in greyscale print. You can override the anchor when placing the event.

### Placing Events

1. Select a node on the canvas.
2. In the inspector panel, scroll to the **Evolutionary events** section.
3. Click **+ Add event**.
4. Choose the event type, anchor (Node or Branch), and optionally a title and description.
5. Set a confidence level and supporting/contradicting evidence.

### Causal Chains

Events can be linked in causal chains — for example, a key innovation on a branch *triggers* an adaptive radiation at the daughter node. In the event editor, use the **Triggers** dropdown to link events. Causal-chain links are drawn as connecting arcs on the canvas when the events overlay is visible.

### Showing/Hiding Events

Show or hide the events overlay with the toggle in the **Hypotheses** module. When visible, event badges appear on nodes and branches and the canvas legend lists the codes in use.

---

## 7. Hypothesis Layers

CladeForge supports managing multiple competing evolutionary hypotheses on a shared tree topology.

### How It Works

- **Tip (observed) states are shared** across all layers — they represent empirical data.
- **Internal-node ancestral-state hypotheses and events diverge** per layer — each layer is an independent scenario.
- Only the **active layer** lives on the tree nodes; non-active layers are stored separately and restored when you switch.

### Managing Layers

Open the **Hypotheses** module (left panel, Content group):
- **New** — Create a blank hypothesis layer (copies the shared tip states; starts with no internal-node hypotheses).
- **Duplicate** — Clone the current layer (including all hypotheses and events) as a starting point for an alternative.
- **Delete** — Remove a layer. Deleting the active layer switches to another.
- **Switch** — Pick a layer from the module's dropdown to activate it. The canvas updates immediately.

### Workflow Example

1. Build your tree topology and assign tip states.
2. Create Layer A ("Morphology-based") and set ancestral-state hypotheses.
3. Duplicate to Layer B ("Molecular-based") and revise the conflicting nodes.
4. Switch between layers to compare scenarios side by side.
5. Export each layer's hypothesis JSON separately for comparison.

---

## 8. Inference Assistant

The inference assistant provides *advisory* suggestions — it does not overwrite your hypotheses. You choose which suggestions to accept.

Open the **Analysis** module (left panel, Output group) and click **Inference assistant…**, or use the ⌘K command palette and search "inference."

The module is a live summary before it is a button strip: it reports the tree's tip and node counts and what the current hypothesis already implies — parsimony cost, CI/RI per character, the number of flagged consistency issues, correlated character pairs — so you can judge whether a closer look is warranted before opening the full dialog. Its controls cover the character matrix, the inference assistant, running and clearing ASR, and jumping into a character's analysis.

### Parsimony (Sankoff)

- Computes the minimum-cost ancestral-state reconstruction using the Sankoff algorithm with your step matrix (or Fitch equal weights if none).
- Suggestions are computed for the character currently selected in the **Analysis** module — there is no batch "generate" button to press first.
- Select an internal node on the canvas and the inspector shows the suggested state beside the one you have asserted. Click **Accept** to adopt it, or leave it alone: nothing enters your hypothesis without that click.
- Where several states are equally optimal at a node, the ambiguity is reported instead of one being picked silently.

### Mk-Model Probabilistic ASR

Ancestral-state reconstruction under the Mk (Markov-k) model, configured in the dialog's **ASR model settings**:

- **Rate model** — Only the **ER (equal-rates)** Mk model is implemented: the closed-form transition probability holds for ER alone, so SYM and ARD are deliberately not offered.
- Uses Felsenstein pruning (down-pass) + sibling/parent up-pass for marginal posterior probabilities.
- All likelihood computations are performed in **log-space** (log-sum-exp) to prevent underflow on large trees.
- The rate is normalised by the mean branch length, making the result invariant to the absolute scale of relative branch lengths.
- Results are displayed as **pie charts** on internal nodes, showing the probability distribution over states.
- **Display threshold** ("Only show states with p > threshold") is a rendering control only: wedges below the threshold are not drawn, and when one state reaches 1 − threshold the pie is filled solid with that state. The threshold never enters the likelihood calculation.

Branch-length problems are **reported per class, not silently patched**, because the four cases mean different things — an unset length is not a recorded zero:

| Degradation reported by the result summary | How ASR handles it |
|-------------------------------------------|--------------------|
| No branch length recorded | imputed as 1 |
| Branch length recorded as 0 | kept as 0 — a genuine synchronous divergence |
| Negative branch length | invalid, imputed as 1 |
| Non-finite branch length (NaN / ∞) | invalid, imputed as 1 |
| Posterior collapse (all log-likelihoods −∞) | falls back to a uniform distribution |

The summary lists how many nodes fall in each class, or states that there are no degradation warnings.

Run ASR from the Analysis module or the command palette ("Mk likelihood reconstruction"). Clear the pie charts with "Clear reconstruction."

### Phylogenetic Signal (CI/RI)

For each discrete character, CladeForge computes:
- **Consistency Index (CI)** = m/s, where m = minimum possible steps, s = observed steps.
- **Retention Index (RI)** = (g−s)/(g−m), where g = maximum possible steps.
- Values closer to 1 indicate the character fits the topology; low values suggest homoplasy (convergence/parallelism) worth investigating.

Requires ≥3 scored tips and ≥2 states.

### Consistency Checks

The consistency checker flags potential issues:
- **Ambiguous reconstruction** — multiple equally optimal states at a node.
- **Homoplasy** — more state changes than the minimum.
- **Missing-data impact** — missing data affecting the reconstruction.
- **Local inconsistency** — the character conflicts with the local topology.
- **Excess changes** — more changes than expected.

### Character Correlation

Character correlation is reported in two clearly separated layers, because an overlap ratio is not a significance test.

**Descriptive overlap.** For each pair of discrete characters, CladeForge reconstructs their changes by parsimony and computes the **Jaccard overlap** of the two change-branch sets (shared branches ÷ union of branches). A pair qualifies once both characters have at least 2 change branches. The panel lists each qualifying pair with:

- the Jaccard overlap ratio, and a highlight when it reaches ≥ 0.5;
- shared change branches, alongside each character's own change-branch count;
- the overlap expected under independence, `|A|·|B|/|N|` over all branches of the tree;
- `n` = tips scored for both characters.

A high overlap says the pair is worth investigating — not that it is significant, and not that it is causal.

**Tree-constrained permutation test.** Click **Run tree-constrained permutation test** to get an actual p-value. The states of character B are re-shuffled across the tips that are scored for B, preserving B's marginal state frequencies and its missing-data pattern; B's most-parsimonious change-branch set is then recomputed on the same topology with the same step matrix, and the statistic is the same Jaccard overlap. The p-value is one-sided:

```
p = (1 + number of replicates ≥ observed) / (permutations + 1)
```

By default 999 permutations run, so the smallest reportable value is printed as `p < 0.0010` rather than `p = 0`. The generator is seeded, so re-running on an unchanged project returns the same numbers, and the mean of the permuted null distribution is reported so you can see how far the observation sits from the null centre.

**Multiple testing.** The 24 pairs with the strongest overlap enter the tested family, and all p-values in that family are **Holm–Bonferroni** adjusted. Only the adjusted p supports a "significant (≤ 0.05)" verdict; the raw p is still shown, clearly labelled. Pairs beyond the cap are reported as skipped and receive no verdict.

**Limits.** A pair cannot be tested when fewer than 3 tips are scored for it, or when the tree is large enough that the permutation work budget leaves too few replicates; such pairs stay descriptive. This test permutes observations, not evolutionary pathways, and it is **not** Pagel's (1994) likelihood-ratio test of correlated transition rates, which CladeForge does not implement.

### Tree Summary Statistics

- Tip count, internal-node count, resolution (binary ratio)
- Mean and total branch length, and tree height (root-to-tip) — reported in branch-length units when lengths are recorded, otherwise in edge counts (topological depth). Branches without a recorded length count as 0 in the total; the panel states how many branches carry lengths and how many do not, since 0 (a true contemporaneous split) is different from unrecorded.
- Sackin index and Colless index (tree balance). On a tree with polytomies the Colless value is the max−min multifurcation variant, is not normalised by node count, and is therefore **not** directly comparable with a binary tree's Colless value — the panel reports how many internal nodes are non-binary.

### Continuous Characters

- **Blomberg's K** — a *point estimate* relative to Brownian motion, where BM equals 1: K > 1 means the trait is more clustered than BM predicts, K < 1 more dispersed. CladeForge runs no permutation and no BM-simulation test, so the application draws no evolutionary conclusion from the number: the distance between K and 1 may sit entirely inside what a random draw would produce, and the panel states that explicitly.
- **Branch-length coverage** travels with every K. A fully measured tree reports that all branches use the supplied lengths; a partially measured one warns that the remaining branches were imputed as 1, which makes the value a *topological* (cladogram-scale) K rather than a time-scaled one — a difference that matters when comparing K across trees.
- A K is only produced when at least one continuous character is scored. When it cannot be computed, the panel names the reason instead of showing a number.

---

## 9. DTL Reconciliation

CladeForge implements gene-tree/species-tree reconciliation using a Duplication–Transfer–Loss (DTL) dynamic-programming solver.

### Setting Up

1. The **current project's tree is the species tree**.
2. Open the **Reconcile** module (left panel, Content group).
3. Click **Import gene tree from file** (a Newick or Nexus file) or **Import from open tab** (another open project supplies the gene tree).
4. The gene tree's tips are matched to the species tree's tips by label. Unmatched tips are reported rather than dropped quietly, and labels that collide once normalised are called out.

The module holds **several gene trees at once**. Each entry shows its name, how many of its tips mapped onto the species tree, and a badge when its scenario carries errors or warnings. Click an entry to make it active, or press Enter while it is focused; rename and remove act on an entry, and removal asks for confirmation. Everything below applies to the active gene tree.

### Manual Refinement

After importing, you can manually refine the reconciliation:
- Select a gene node in the reconciliation view.
- In the inspector, set its **species-tree mapping**, **event type** (speciation σ, duplication δ, transfer τ), and **losses** on the incoming branch.
- Use **Suggest via LCA** to automatically map unresolved internal gene nodes to their lowest common ancestor in the species tree.
- The consistency checker reports mapping conflicts and event inconsistencies.

### DP Solver

1. Set the **costs** for duplication (δ), transfer (τ), and loss (λ) in the Reconcile module.
2. Click **Compute optimum (DP)** to run the dynamic-programming solver.
3. The solver returns the minimum-cost scenario and a back-traced event assignment.
4. Click **Apply optimum as assumptions** to load the solver's result as the starting point for manual refinement.
5. Compare the current scenario cost with the DP optimal cost.

The reported result states the solver's own scope rather than leaving you to infer it:

- **Comparability.** This is a minimum-cost *parsimony* reconciliation, not a likelihood. Three deliberate modelling choices make its absolute event and loss totals **lower** than RAINIEFF, RaGTeP or Treerecon would report: the gene root may sit inside the species tree without paying a family-arrival fee, lineages that pass a species junction without entering a sibling branch are not charged per junction, and unconstrained species clades pay no speculative losses. Quote the output as "events under this model", never as counts interchangeable with another program. When the panel shows a free root it also states that the cost excludes the root-transfer fee.
- **Ambiguity.** Nodes that admit another event class at exactly the same cost are counted and reported — the classic duplication/speciation non-identifiability plus mirrored transfer directions. The event shown is the one the documented priority *duplication › speciation › transfer* selects, which is not the same claim as "this is the only optimum".
- **Loss accounting.** Losses are reported as a split between internal branches and gene-tip branches, since tip-branch losses are counted here.
- **Scenario vs optimum.** The current scenario cost and the DP optimal cost are the same scenario re-priced under the same costs, so equality is meaningful: it says your hypothesis is already optimal *for this cost vector*.

**Clear assumptions** empties every mapping and event of the active gene tree in one action, and its confirmation states that the step is undoable. Costs are validated as you type: an illegal vector is refused and bounced back to legal defaults, with a toast naming what was wrong — so the solver can never run on costs you did not actually choose.

The module keeps running tallies for the active gene tree as you edit: speciations σ, duplications δ, transfers τ, losses λ, and how many internal nodes are resolved.

**Requirements:** The solver requires binary gene trees. Polytomies break the lineage bookkeeping — resolve them first. Species trees may have any arity.

### Reconciliation View

Click **Enter reconciliation view** for a side-by-side display: the species tree on the left, the gene tree on the right, with mapping lines connecting them. Click a gene node to inspect and edit its DTL assumption. Alt+click a species node to set the mapping of the selected gene node. **Esc** leaves the view; the header's view-mode switch does the same.

The reconciliation inspector carries the species-tree mapping as a dropdown, the event type (with a control to clear it again), the loss count on the incoming branch, the node's confidence, support value and supporting/contradicting evidence, and for a tip-bearing clade how many tips it spans.

### Validation

The consistency check re-runs after every edit and lists what it finds, each row tagged by kind:

| Tag | What it flags |
|-----|---------------|
| **Unmatched** | A gene tip that found no species tip of the same name |
| **Unresolved** | An internal gene node with no mapping or event decision yet |
| **Dangling** | A mapping pointing at a species node that no longer exists |
| **Conflict** | An event contradicting its mapping — speciation on a non-bifurcating species node, or a transfer with no destination lineage |
| **Mislabelled** | A tip whose label collides with another once normalised (case, underscores); it is left unmapped and takes no part in the reconciliation |
| **Loss shortfall** | Fewer losses recorded than the mapping implies |
| **Timing** | Ages or ordering that contradict each other |
| **Leaf event** | An event asserted on a gene tip, where only a mapping is meaningful |

Rows are graded **Error** or **Note**, and clicking one locates the node — opening the reconciliation view when one is available. A fully consistent tree reports "No inconsistencies" rather than leaving an empty box.

---

## 10. Time Calibration

### Reading the Time State

The Time module reports the tree's temporal condition before you change anything:

| Panel statement | What it means |
|-----------------|---------------|
| No time data — the tree is purely topological | No node carries an age, so the time axis and environmental events are unavailable. Set node ages, add calibration points, or estimate ages from topology first |
| Time data detected — the time axis is available | Ages are present and the axis can be drawn |
| Time data is present, but the current layout is "…", switch to the geological time chart | The data exists and the layout does not. Press the panel's **Switch to geological time chart** button |

### Geological Time Chart Layout

Switch the layout type to **Geological time chart** in the Style module — or use the button above — to position nodes on a real time axis:

1. Set the **time unit** in the Time module. The field accepts free text; the recognised symbols `Ma`, `ka`, `Ga`, `Myr` and `yr` are understood. An unrecognised unit still labels the axis, but the geological era bands are then suppressed, since they cannot be placed on a scale the application does not understand.
2. Enter each node's **age** (time before present) in the inspector panel.
3. Nodes are positioned along the axis by age, and the axis is drawn with tick marks and labels.
4. A node with no age recorded is read as extant (age 0). The panel counts how many nodes are in that state and names them, so a silently flattened row of tips is visible rather than hidden.

### Geological Era Bands

In the Time module, enable the era overlay to draw coloured bands for geological time behind the tree, and choose the **display level**: eons only, periods only, or both.

### Fossil Calibration Points

Calibration points record the evidence that a node is neither younger nor older than a given bound:
1. In the Time module, open the **Calibration points** section.
2. Click **+ Add calibration point**.
3. Select a node and enter the minimum and maximum age.

What they do is bounded, and the panel says so: calibration points are carried into the **NEXUS export** for a downstream dating analysis to consume. They do **not** recompute node ages inside CladeForge, and they are not drawn on the canvas time axis. The ages you see on screen are exactly the ages you — or the estimator — entered.

### Per-Node Time Constraint

The same calibration data is mirrored onto the node itself. Select a node and the inspector's **Time constraint** section shows its minimum and maximum age; the binding is two-way, so editing it in either place updates the other.

### Environmental Events

Overlay dated environmental context on the time axis:
1. In the Time module, open the **Environmental events** section.
2. Click **+ Add environmental event**.
3. Enter a label, time range (from/to in Ma), colour, and optional note.
4. Environmental events are drawn as coloured bands or lines on the time axis (e.g., climate shifts, continental break-up, mass extinctions).

### Age Estimation

**Estimate ages from topology** assigns each node an age from its topological depth — the number of edges from the root, scaled to the oldest age already present in the tree. It does not read branch lengths, so what it produces is a relative ordering, not a dated phylogeny.

Nodes filled in this way keep a provenance flag: the panel warns that part of the tree's ages are topological estimates rather than fossil or calibration evidence, records that they are expressed in edge counts, and asks you to check them item by item before using the figure in an analysis or a submission. Each estimated age remains editable in the inspector, which is where you replace an estimate with real calibration evidence.

---

## 11. Styling and Themes

### Style Presets

Quickly switch the overall look with style presets (Style module → Style presets):

| Preset | Background | Node | Branch |
|--------|-----------|------|--------|
| **Default** | White | White fill, dark stroke | Dark grey |
| **Journal B/W** | White | White fill, black stroke | Black |
| **Presentation** | Light grey-blue | Blue fill | Blue |
| **Dark** | Dark warm | Dark fill, light stroke | Muted grey |

Per-object overrides are preserved when you apply a preset.

### Per-Object Styling

Select any node or edge on the canvas to style it individually in the inspector:

**Nodes:**
- Shape: Circle, Square, Diamond, None
- Size, fill colour, stroke colour, stroke width
- Label: show/hide, colour, font size, font weight (300–900), italic, bold, rotation

**Branches (incoming edge to a node):**
- Shape: Thin line, Thick bar (rectangular), Rounded bar
- Colour, width, dash style (solid/dashed/dotted)

**Custom edges:**
- Label, colour, width, dash, arrow, curvature

Use **Reset to default** in the inspector to clear all overrides for an object.

### Branch Gradient

Enable a depth-based colour gradient in the Style module: branches without per-node colour overrides interpolate from a root colour to a tip colour.

### Canvas Settings

The Style module exposes the **canvas background** colour and the **default link colour** used by custom edges; both feed straight into the exported figure. Canvas dimensions are part of the project schema but are not editable from the panels yet — the exported image sizes itself to the tree.

---

## 12. Import and Export

### Import

| Format | Extensions | Notes |
|--------|-----------|-------|
| **Newick** | `.nwk`, `.newick`, `.tree`, `.tre` | Branch lengths and support values are parsed and NHX comments round-trip. Rootedness markers `[&R]` / `[&U]` and an explicit `[&support=…]` are read and written back, so a tree keeps what it arrived with. Files containing several trees are detected. |
| **Nexus** | `.nex`, `.nexus` | Every `TREE` statement in every `TREES` block is read, honouring an optional `TRANSLATE` table — not just the first tree. A file carrying several trees is passed to the multi-tree dialog. |
| **Multi-tree files** | — | If a file contains multiple trees, a dialog lets you pick one, import all as separate tabs, or build a consensus tree (strict or 50% majority rule). |

Drag-and-drop is supported: drop a file anywhere on the window to import it.

Both directions also work in the plain web build, where the desktop's native file dialogs are replaced by a browser download and an `<input type="file">`. Only how the file reaches disk changes; the formats and options do not.

PNG, PDF and SVG export raise a busy veil while the figure is rendered, which for a large tree can take a second or more — the veil is there so a slow export is never mistaken for a freeze.

### Export

Open the **Export** module (left panel, Output group) or use the ⌘K command palette. The panel's buttons are grouped by format family — Vector, Raster, Data files, Reports:

| Format | Group | Description |
|--------|------|-------------|
| **SVG** | Vector | Publication-quality vector graphic. WYSIWYG — matches the canvas exactly. Includes semantic layer (character colours, transitions, events, time axis, auto legend). |
| **PDF** | Vector | Vector PDF for print/publication (jsPDF + svg2pdf.js). Derived from the SVG. |
| **PNG** | Raster | Bitmap rasterised from the SVG at 2×. The factor is fixed — there is no control for it yet — and a canvas large enough to reach the browser's canvas ceiling has its effective scale reduced so the export still completes. |
| **Newick** | Data files | Tree topology with branch lengths and support values. |
| **Nexus** | Data files | Full Nexus file with optional CHARACTERS block, ASSUMPTIONS block (hypothesis layers), MrBayes block, and BEAST block. |
| **Hypothesis JSON** | Data files | A versioned archive (`kind: "hypothesis-export"`, its own schema `0.1.0`) of the **active** layer: character states for every tip, scored or not, plus events, confidence and evidence, and layer metadata. Export each layer separately to compare them. |
| **R script** | Data files | Self-contained executable R script (sole dependency: the `ape` package) that regenerates the figure and re-runs Sankoff parsimony and Mk-model ASR outside the GUI. |
| **Reconciliation report** | Data files | Markdown summary of the DTL reconciliation scenario. |
| **Narrative report** | Reports | Markdown summary of the tree, characters, events, and hypotheses. |

### Nexus Export Options

Reached from the **Export** module's Nexus button. The File menu's Nexus entry exports with the default options and opens no dialog, so use the module when you need the blocks below.

The dialog lets you include:
- **Character matrix** (CHARACTERS block)
- **Hypothesis layers** (ASSUMPTIONS block)
- **MrBayes block** (for Bayesian inference)
- **BEAST block** (for divergence-time dating)

### WYSIWYG Export

The SVG export is generated from scratch (not by cloning the live DOM) to ensure tight cropping, no editing chrome, and exact path/label consistency with the canvas. When the semantic layer is active, the export includes character colouring, state transitions, event badges, causal-chain links, the time axis, era bands, environmental events, and an auto-generated legend.

---

## 13. Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| ⌘Z / Ctrl+Z | Undo |
| ⌘⇧Z / Ctrl+Y | Redo |
| ⌘S / Ctrl+S | Save project |
| ⌘O / Ctrl+O | Open project (`.cladeforge.json`) — import a tree from the File menu, or by dropping a file |
| ⌘T / ⌘N | New tab |
| ⌘F / Ctrl+F | Search nodes |
| ⌘⇧F | Fit to window |
| ⌘K | Command palette |
| ⌘? | Shortcut reference |
| ⌘= / ⌘- | Zoom in / out |
| ⌘. | Collapse / expand side panels |

### Canvas

| Shortcut | Action |
|----------|--------|
| Delete / Backspace | Delete the selected nodes, or the selected custom edge. Risky deletions ask for confirmation, and the toast offers an Undo that reverts that deletion |
| Esc | Clear selection / abort gesture / leave the reconciliation view |
| Arrow keys | Nudge the selected nodes by 1px (Shift = 10px). In rectangular layouts movement is constrained to the tree's depth axis, so the arrows across that axis do nothing |
| Alt + ← / ↑ · Alt + → / ↓ | Move the selection to the previous / next node in display order, wrapping at either end |
| Wheel | Zoom canvas |
| Space / middle-drag | Pan canvas |
| Drag node | Move node |
| Alt + drag onto node | Reparent |
| Drag port dot | Create custom link |
| Double-click node | Rename |
| Shift + click | Multi-select (2 selected shows MRCA) |

### Command Palette

| Shortcut | Action |
|----------|--------|
| ↑ / ↓ | Move between commands |
| Enter | Run selected command |
| Esc | Close |

### Notes

- Wherever this table writes ⌘, **Ctrl is accepted too**, so the same chords work on Windows and Linux.
- Shortcuts are ignored while a text field has focus **and while an input method is composing** — an otherwise-live ⌘ chord arriving mid-composition cannot fire an edit, which matters most for 中文 input.

---

## 14. Project File Format

CladeForge projects are stored as JSON files with the `.cladeforge.json` extension. The current schema version is **0.1.0**.

The file is an envelope rather than a bare project: `app` (`"CladeForge"`), `version`, and `project` (the document described below). Reading runs an explicit, ordered version-migration step, which exists for future schema changes: `0.1.0` is the initial schema, so no step applies to a file written by this release, while a file stamped newer than this build is opened on a best-effort basis and tells you so. The envelope deliberately keeps the version the document was actually validated against rather than re-stamping it with this build's version, so a partially understood file cannot come back claiming to be migrated.

### Structure

A project file contains:
- `nodes` — Adjacency map of all tree nodes (id, label, parentId, childrenIds, branchLength, support, age, style overrides, character states, etc.)
- `rootId` — The root node's id.
- `customEdges` — Array of reticulation/special edges.
- `layout` — Layout type, orientation, mode, spacing, time unit, support threshold.
- `canvas` — Canvas dimensions and background.
- `defaults` — Default node, branch, and edge styles; branch gradient.
- `characters` — User-defined character definitions (discrete/continuous, states, cost matrices).
- `events` — Annotated evolutionary events with causal-chain links.
- `layers` — Named hypothesis layers.
- `activeLayerId` — The currently active layer.
- `layerStore` — Saved hypothesis data for non-active layers.
- `environmentalEvents` — Dated environmental/geological context events.
- `calibrationPoints` — Fossil calibration points.
- `geneTrees` — Embedded gene trees for DTL reconciliation.
- `reconCosts` — DTL cost parameters (duplication, transfer, loss).

### Undo/Redo

CladeForge maintains up to 100 undo steps using structural sharing (Immer). All topology edits, style changes, character assignments, and event placements are undoable.

### Autosave and Recovery

CladeForge autosaves the workspace to local storage while you work and restores it on the next launch. The status indicator is driven by the **actual write result**, never by a debounce timer, so it cannot report success for a write that failed:

| Indicator (hover it for the detail) | Meaning |
|-------------------------------------|---------|
| Saving… | Writing to local storage |
| Saved | The autosave landed in local storage and will be restored on restart |
| Autosave failed | Nothing was written — the latest edits exist **only in memory**. Use **File → Save project** immediately |

Autosave fails when local storage is unavailable or full (a very large project is the usual cause), when the document cannot be serialised, or when the write itself is rejected; a warning toast names which. Autosave is a crash net, not a substitute for saving — only **Save project** writes your `.cladeforge.json` to disk.

### Recent Files

**File → Recent** lists the last 8 projects and trees you opened. In the desktop app an entry remembers its full path and re-opens directly; in the web build no path exists, so choosing an entry falls back to the open dialog. **Clear Recent** empties the list.

---

## 15. Troubleshooting

### The tree looks like a cladogram even though I selected "phylogram"

This happens when the tree has no branch-length data. Import a tree with branch lengths (Newick with `:length` values), or manually enter branch lengths per node in the inspector.

### Midpoint reroot is disabled

Midpoint rerooting requires branch-length data to compute the longest path. Add branch lengths first.

### The DTL solver reports "needs a binary gene tree"

The DTL dynamic-programming solver requires binary gene trees. Polytomies break lineage bookkeeping. Resolve polytomies in the gene tree before running the solver. (Species trees may have any arity.)

### ASR pie charts show uniform distributions

This can happen when:
- All tips have the same state (no variation to reconstruct).
- Branch lengths are unrecorded or invalid (imputed as 1, which can flatten the signal). A length deliberately recorded as 0 is kept as 0.
- Posterior collapse due to numerical underflow on very large trees (reported as a warning).

Check the warnings in the ASR result summary.

### Exported image does not match the canvas

The SVG export is generated from scratch using the same rendering logic as the canvas. If the semantic layer (characters, events, time axis) is active on screen, it will be included in the export. Make sure the layout mode, orientation, and visible layers are set as desired before exporting.

### The app opens slowly with many tabs

CladeForge restores all tabs on launch. If you have many large projects open, restoration may take a moment. Corrupt tabs are skipped with a notification.

### Project file is large

Project files are JSON and can grow large with many character states, events, and hypothesis layers. This is normal. The format is explicitly versioned, so a file written by this release keeps opening in later releases.

### A file is rejected as too large

The parsers guard themselves before any data reaches the UI: tree text is capped at 64 MB, project JSON at 192 MB, and a single parse at 2 000 000 nodes. Real documents stay far below these ceilings (a 10 000-tip Newick is roughly 250 kB), so a rejection usually means the content does not match the extension — a binary saved under a `.nwk` name, or a corrupted hand-edited project blob. The message reports the actual size alongside the limit.

---

*If you encounter a bug or have a feature request, please open an issue in the project tracker. For citation information, see the [README](../README.md). A Chinese edition of this manual is available at [MANUAL_ZH.md](./MANUAL_ZH.md).*
