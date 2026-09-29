// Reproducible-script export: a GUI tool is only reviewable if it can export
// executable scripts that reproduce its graphical and analytical outputs.
//
// `buildRScript` emits a SELF-CONTAINED R script (sole dependency: the `ape`
// package) that re-runs the project's inference outside the GUI and draws a
// figure from the same data:
//   * Sankoff parsimony over the user-defined step matrix;
//   * equal-rates Mk ancestral-state reconstruction (pruning + up-pass);
//   * a PDF figure with character-coloured tips and posterior-probability pies
//     at internal nodes, in the layout the project is displayed in.
// The project data (topology, characters, tip states) is embedded as native R
// literals, so the script needs no side-car files.
//
// Scope, stated in the script header too: the re-runs of the *numbers* are the
// same algorithms as the app's; the PDF is a same-data rendering, not a
// pixel-for-pixel copy of the on-screen figure (ape cannot express manual node
// positions, custom reticulation edges, collapsed clades or the interactive
// ladder order).

import { serializeNewick } from './newick';
import { tipNames } from './nexus';
import type { LayoutType, NodeId, Project } from '../model/types';

/** Escape a string for a double-quoted R literal. */
function rStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

/** ape arguments matching the project's own layout. */
function apePlotOptions(type: LayoutType): { type: string; useEdgeLength: boolean; note: string } {
  switch (type) {
    case 'rectangular-phylogram':
      return {
        type: 'phylogram',
        useEdgeLength: true,
        note: 'drawn to branch length, like the CladeForge phylogram',
      };
    case 'time-calibrated':
      return {
        type: 'phylogram',
        useEdgeLength: false,
        note:
          'CladeForge places this layout by node AGE; ape has no age axis, so equal ' +
          'inter-node spacing is used and the geological scale is not reproduced',
      };
    case 'circular':
      return { type: 'fan', useEdgeLength: false, note: 'fan layout, matching the CladeForge circular view' };
    case 'rectangular-cladogram':
    default:
      return {
        type: 'cladogram',
        useEdgeLength: false,
        note: 'equal branch spacing, like the CladeForge cladogram (branch lengths ignored)',
      };
  }
}

/**
 * The tree as an explicit edge list, NOT `read.tree(text = ...)`.
 *
 * ape 5.8.1's own Newick reader cannot round-trip the labels this app writes: a
 * quoted label containing spaces comes back with the spaces deleted
 * (`"Tobacco mosaic virus"` → `Tobaccomosaicvirus`), and `"Gracilicutes (GN)"`
 * comes back as `GN`. The second only costs an internal label. The first is
 * fatal in this script, because the character `tips` vectors below are keyed on
 * the ORIGINAL labels — a tip that reads back mangled is silently treated as
 * missing data. Measured on the shipped virus sample: 6 of 21 tips are lost and
 * the script's Sankoff cost for the host character prints 1 where the
 * application reports 3.
 *
 * Building the same tree from vectors keeps every label byte-exact; this is what
 * `scripts/cross-check/ape_agreement.R` already does, for the same reason. The
 * numbering is the one the analysis below assumes: tips `1..Ntip` in
 * `tip.label` order, then internal nodes from `Ntip + 1` in breadth-first order,
 * so the root is `Ntip + 1` and every parent id is smaller than its children's —
 * which is what makes the script's descending loop visit children first.
 */
function apeTree(
  project: Project,
  names: Map<NodeId, string>,
): { literal: string; substituted: number; usable: boolean } {
  const order: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [project.rootId];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id) || !project.nodes[id]) continue;
    seen.add(id);
    order.push(id);
    for (const c of project.nodes[id].childrenIds) queue.push(c);
  }
  if (!order.length) {
    // No reachable root: fall back to the Newick rather than emitting an empty
    // edge list, which would not be a phylo at all.
    return {
      literal: `tree <- read.tree(text = ${rStr(serializeNewick(project))})`,
      substituted: 0,
      usable: false,
    };
  }
  const tips = order.filter((id) => project.nodes[id].childrenIds.length === 0);
  const internals = order.filter((id) => project.nodes[id].childrenIds.length > 0);
  const idOf = new Map<string, number>();
  tips.forEach((id, i) => idOf.set(id, i + 1));
  internals.forEach((id, i) => idOf.set(id, tips.length + i + 1));

  const edgeRows: string[] = [];
  const lengths: string[] = [];
  let usable = false;
  let substituted = 0;
  for (const id of internals) {
    for (const c of project.nodes[id].childrenIds) {
      if (!project.nodes[c]) continue;
      edgeRows.push(`${idOf.get(id)}, ${idOf.get(c)}`);
      // Resolve the length exactly the way `reconstructMk` does: a recorded zero
      // is a real zero (a synchronous divergence), and unset / negative /
      // non-finite becomes 1. Emitting NA here would do two different kinds of
      // harm — the mean below would drop those edges, and `p_er(NA)` makes the
      // script's own up-pass die on R's `if (NA)`.
      const bl = project.nodes[c].branchLength;
      const finite = typeof bl === 'number' && Number.isFinite(bl) && bl >= 0;
      if (typeof bl === 'number' && bl > 0) usable = true;
      if (!finite) substituted += 1;
      lengths.push(finite ? String(bl) : '1');
    }
  }
  const nodeLabels = internals.map((id) => rStr(project.nodes[id].label || ''));
  const literal = [
    'tree <- structure(',
    '  list(',
    `    edge = matrix(c(${edgeRows.join(', ')}), ncol = 2, byrow = TRUE),`,
    // A cladogram-only project must leave edge.length NULL, not all-NA: the
    // script's unit-length fallback tests `is.null(bl)`, and 1 / mean(NA..) is
    // NaN rather than the stated "use equal lengths".
    ...(usable ? [`    edge.length = c(${lengths.join(', ')}),`] : []),
    `    Nnode = ${internals.length}L,`,
    // `names` is the de-duplicated tip map NEXUS uses. Keying `tip.label` on the
    // raw label repeats whatever a user happened to call twice, and the `tips`
    // vector below is keyed on the same strings — R's named vector then keeps one
    // value per name and the other tip's states vanish without a word.
    `    tip.label = c(${tips.map((id) => rStr(names.get(id) ?? project.nodes[id].label ?? '')).join(', ')}),`,
    `    node.label = c(${nodeLabels.join(', ')})`,
    '  ),',
    '  class = "phylo"',
    ')',
  ].join('\n');
  return { literal, substituted, usable };
}

/**
 * Generate a standalone R script re-running the project's inference and drawing
 * a figure from the same data. Discrete characters with ≥2 states are analysed;
 * continuous characters are exported as data only.
 */
export function buildRScript(project: Project): string {
  // A cladogram-only project has no branch lengths at all, so there is no rate to
  // derive (`1 / mean(numeric(0))` is NaN, which would die inside the Mk loop).
  // Detect it here so the script both states the fallback and uses unit lengths.
  // The tree itself does not go through `read.tree` — see `apeTree` — so this is
  // about the lengths, not the parser.
  const tree = apeTree(project, tipNames(project));
  const plot = apePlotOptions(project.layout.type);

  // Character payload as R list(...) literals. The keys of each `tips` vector are
  // the SAME de-duplicated names `tip.label` was written with, so a state can
  // never be filed under a name the tree does not have.
  const tipKeyNames = tipNames(project);
  const charBlocks: string[] = [];
  for (const c of project.characters) {
    const tips: string[] = [];
    for (const n of Object.values(project.nodes)) {
      if (n.childrenIds.length > 0) continue;
      const v = n.charStates?.[c.id];
      if (v === undefined) continue;
      const key = rStr(tipKeyNames.get(n.id) ?? n.label ?? '');
      if (typeof v === 'string') {
        const st = c.states.find((s) => s.id === v);
        if (st) tips.push(`${key} = ${rStr(st.label)}`);
      } else if (typeof v === 'number') {
        tips.push(`${key} = ${rStr(String(v))}`);
      }
    }
    const states = c.states.map((s) => rStr(s.label)).join(', ');
    const colors = c.states.map((s) => rStr(s.color)).join(', ');
    let cost = 'NULL';
    const substituted: string[] = [];
    if (c.costMatrix && c.type === 'discrete' && c.costMatrix.length === c.states.length) {
      const k = c.states.length;
      const cells: string[] = [];
      for (let i = 0; i < k; i += 1) {
        const row = c.costMatrix[i];
        for (let j = 0; j < k; j += 1) {
          if (i === j) {
            cells.push('0');
            continue;
          }
          const v = row?.[j];
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
            cells.push(String(v));
            continue;
          }
          // An unfilled, negative or non-numeric cell cannot be written as an R
          // literal at all: `Array.flat()` leaves a hole, `join` renders it as the
          // empty string, and the emitted `matrix(c(0, , 3), …)` is a parse error —
          // which killed the one guarantee this file exists to provide. Resolve it
          // the way the application's own parsimony does (a unit step) and say so.
          substituted.push(
            `${c.states[i]?.label ?? `state ${i + 1}`} -> ${c.states[j]?.label ?? `state ${j + 1}`}`,
          );
          cells.push('1');
        }
      }
      cost = `matrix(c(${cells.join(', ')}), nrow = ${k}, byrow = TRUE)`;
    }
    charBlocks.push(
      [
        '  list(',
        `    name = ${rStr(c.name)},`,
        `    type = ${rStr(c.type)},`,
        `    states = c(${states}),`,
        `    colors = c(${colors}),`,
        ...(substituted.length
          ? [
              `    # Cost cells were not usable as literals and are priced as one step,`,
              `    # matching the application: ${substituted.join('; ')}`,
            ]
          : []),
        `    cost = ${cost},`,
        `    tips = c(${tips.join(', ')})`,
        '  )',
      ].join('\n'),
    );
  }

  return `#!/usr/bin/env Rscript
# CladeForge reproducible-analysis script
# Project : ${project.name.replace(/["\\\n]/g, ' ')}
# Format  : CladeForge project v${project.version}
#
# What this script reproduces, and what it does not:
#   REPRODUCED (same algorithms as the application):
#     * Sankoff parsimony with the project's step matrix (advisory baseline);
#     * equal-rates Mk ancestral-state reconstruction (pruning + up-pass), i.e.
#       the posterior probabilities the app reports.
#   APPROXIMATED:
#     * a PDF figure drawn from the same data — character-coloured tips,
#       posterior pies, legend — in the project's ${plot.type} layout
#       (${plot.note}). It is NOT a pixel copy of the on-screen figure: manual
#       node positions, collapsed clades, custom reticulation edges, era bands
#       and the interactive ladderising order are GUI state that ape does not
#       consume. The topology, tip labels, states and posteriors are identical;
#       the geometry is a same-data rendering.
#   ${tree.usable ? 'Branch lengths: present, used as given.' : 'Branch lengths: ABSENT in this project, so the Mk analysis and the figure use unit (equal) lengths — the results are topology-only.'}
# Run with: Rscript this_file.R   (install.packages("ape") if needed)

library(ape)

# The tree is assembled from vectors rather than parsed from Newick, so every
# label survives byte-exact even where ape's own reader would mangle it.
${tree.literal}

# Branch lengths, with an explicit unit-length fallback: a cladogram-only project
# serialises no lengths at all, and 1 / mean(NULL) would poison every
# transition probability below.
bl <- tree$edge.length
if (is.null(bl) || !any(is.finite(bl) & bl > 0)) {
  bl <- rep(1, nrow(tree$edge))
  cat("NOTE: the tree carries no usable branch lengths; Mk probabilities and the\\n")
  cat("      figure use unit (equal) branch lengths, i.e. topology-only inference.\\n\\n")
}

# Equal-rates Mk rate: one expected substitution per mean branch, so the
# transition probabilities are invariant to the tree's absolute scale. Every
# length above is already resolved the way the application resolves it (a
# recorded 0 is a real zero; unset / negative / non-finite became 1), so the mean
# runs over ALL of them — filtering here would drop zero-length and unmeasured
# edges from the average and make this script reconstruct at a different rate
# than the application reports. Deriving it from the fallback-protected bl
# above is what keeps the rate finite for a cladogram-only project.
rate <- 1 / mean(bl)
${tree.substituted > 0 && tree.usable ? `cat("NOTE: ${tree.substituted} branch length(s) were unset, negative or non-finite and are analysed as 1, matching the application.\n\n")` : ''}

characters <- list(
${charBlocks.join(',\n')}
)

# --- helpers ----------------------------------------------------------------

## Equal-rates (ER) Mk transition matrix P(t): the same closed form used by
## CladeForge's inference assistant. The rate is scaled by the mean branch
## length so probabilities are invariant to the tree's absolute scale.
p_er <- function(t, k, rate) {
  e <- exp(-k * rate * t)
  P <- matrix(1 / k, k, k) - (1 / k) * e
  diag(P) <- 1 / k + ((k - 1) / k) * e
  P
}

## Sankoff parsimony down/up pass. 'cost' is k x k; tips absent from tip_states
## are treated as missing data.
sankoff <- function(tree, tip_states, states, cost) {
  ntip <- length(tree$tip.label)
  k <- length(states)
  sidx <- setNames(seq_len(k), states)
  x <- sidx[tip_states[tree$tip.label]]
  parent <- tree$edge[, 1]
  child <- tree$edge[, 2]
  kids <- split(child, parent)
  root <- setdiff(unique(parent), unique(child))
  g <- matrix(0, nrow = ntip + tree$Nnode, ncol = k)
  rownames(g) <- as.character(seq_len(ntip + tree$Nnode))
  ## Down-pass: internal node indices decrease from root, so descending order
  ## visits children before parents.
  for (v in sort(as.integer(names(kids)), decreasing = TRUE)) {
    for (i in seq_len(k)) {
      total <- 0
      for (ch in kids[[as.character(v)]]) {
        if (ch <= ntip) {
          xi <- x[[ch]]
          if (is.na(xi)) next
          total <- total + min(cost[i, ] + ifelse(seq_len(k) == xi, 0, Inf))
        } else {
          total <- total + min(cost[i, ] + g[as.character(ch), ])
        }
      }
      g[as.character(v), i] <- total
    }
  }
  ## Up-pass: assign each node a state minimising cost given its parent.
  node_state <- integer(ntip + tree$Nnode)
  walk <- function(v, parent_state) {
    base <- if (parent_state == 0L) rep(0, k) else cost[parent_state, ]
    scores <- base + g[as.character(v), ]
    best <- which.min(scores)
    node_state[v] <<- best
    for (ch in kids[[as.character(v)]]) {
      if (ch > ntip) walk(ch, best)
    }
  }
  walk(root, 0L)
  list(cost = min(g[as.character(root), ]),
       states = node_state, k = k)
}

## Equal-rates Mk marginal ancestral reconstruction: Felsenstein pruning
## (down-pass) + parent/sibling up-pass, normal space. Uses the script-level
## 'bl' (which already falls back to unit lengths when the tree has none) and the
## script-level 'rate' (= 1 / mean usable branch length); both are bound before
## this function is ever called. For very large or very unbalanced trees prefer
## log-space implementations (phangorn::ace, phytools).
mk_asr <- function(tree, tip_states, states) {
  ntip <- length(tree$tip.label)
  k <- length(states)
  sidx <- setNames(seq_len(k), states)
  x <- sidx[tip_states[tree$tip.label]]
  parent <- tree$edge[, 1]
  child <- tree$edge[, 2]
  kids <- split(seq_along(child), parent)  # edge-row indices per parent
  root <- setdiff(unique(parent), unique(child))
  L <- matrix(1, nrow = ntip + tree$Nnode, ncol = k)
  rownames(L) <- as.character(seq_len(ntip + tree$Nnode))
  for (v in sort(as.integer(names(kids)), decreasing = TRUE)) {
    rows <- kids[[as.character(v)]]
    vec <- rep(1, k)
    for (r in rows) {
      ch <- child[r]
      m <- if (ch <= ntip) {
        xi <- x[[ch]]
        if (is.na(xi)) rep(1, k) else as.numeric(seq_len(k) == xi)
      } else L[as.character(ch), ]
      vec <- vec * (p_er(bl[r], k, rate) %*% m)
    }
    s <- sum(vec)
    L[as.character(v), ] <- if (s > 0) vec / s else rep(1 / k, k)
  }
  G <- matrix(1 / k, nrow = ntip + tree$Nnode, ncol = k)
  rownames(G) <- rownames(L)
  for (v in sort(as.integer(names(kids)))) {
    rows <- kids[[as.character(v)]]
    for (r in rows) {
      ch <- child[r]
      if (ch <= ntip) next
      sib_msg <- rep(1, k)
      for (r2 in rows) {
        ch2 <- child[r2]
        if (ch2 == ch) next
        m2 <- if (ch2 <= ntip) {
          xi <- x[[ch2]]
          if (is.na(xi)) rep(1, k) else as.numeric(seq_len(k) == xi)
        } else L[as.character(ch2), ]
        sib_msg <- sib_msg * (p_er(bl[r2], k, rate) %*% m2)
      }
      G[as.character(ch), ] <- p_er(bl[r], k, rate) %*% (G[as.character(v), ] * sib_msg)
      G[as.character(ch), ] <- G[as.character(ch), ] / sum(G[as.character(ch), ])
    }
  }
  post <- L * G
  post <- post / rowSums(post)
  list(posterior = post)
}

# --- analysis ---------------------------------------------------------------

cat("CladeForge reproducible analysis\\n")
cat("Tree:", Ntip(tree), "tips,", tree$Nnode, "internal nodes\\n\\n")

internal_nodes <- (length(tree$tip.label) + 1):(length(tree$tip.label) + tree$Nnode)

for (ch in characters) {
  cat("== Character:", ch$name, "==\\n")
  if (ch$type != "discrete" || length(ch$states) < 2) {
    cat("   continuous or single-state: exported as data only\\n\\n")
    next
  }
  scored <- ch$tips[names(ch$tips) %in% tree$tip.label]
  cost <- ch$cost
  if (is.null(cost)) {
    k <- length(ch$states)
    cost <- matrix(1, k, k); diag(cost) <- 0
  }
  sp <- sankoff(tree, scored, ch$states, cost)
  cat(sprintf("   Sankoff minimum cost: %g (step-matrix units)\\n", sp$cost))
  asr <- mk_asr(tree, scored, ch$states)
  cat("   Mk posterior at each internal node (states:",
      paste(ch$states, collapse = " / "), ")\\n")
  print(round(asr$posterior[as.character(internal_nodes), , drop = FALSE], 3))
  cat("\\n")
}

# --- figure -----------------------------------------------------------------
# A same-data rendering of the GUI figure: character-coloured tips (first
# discrete character) + posterior pies at internal nodes + auto legend, in the
# layout the project is displayed as. Manual positions / collapsed clades /
# custom edges / era bands are GUI-only and are not reproduced here.

discrete <- Filter(function(ch) ch$type == "discrete" && length(ch$states) >= 2, characters)

# cairo_pdf renders unicode labels reliably; use pdf() if cairo is unavailable.
cairo_pdf("cladeforge_reconstruction.pdf", width = 9, height = 7)
par(mar = c(2, 1, 2, 2), xpd = NA)
cat("Figure layout: type = ${plot.type}, use.edge.length = ${plot.useEdgeLength && tree.usable ? 'TRUE' : 'FALSE'}",
    "(${plot.note})\\n")
plot(tree, type = ${rStr(plot.type)}, use.edge.length = ${plot.useEdgeLength && tree.usable ? 'TRUE' : 'FALSE'},
     show.tip.label = TRUE,
     label.offset = 0.3,
     edge.color = "#374151", edge.width = 1.4)
title(main = ${rStr(project.name)}, cex.main = 1.0)

if (length(discrete) > 0) {
  main <- discrete[[1]]
  scored <- main$tips[names(main$tips) %in% tree$tip.label]
  k <- length(main$states)
  cost <- main$cost
  if (is.null(cost)) { cost <- matrix(1, k, k); diag(cost) <- 0 }

  tip_col <- rep("#6b7280", Ntip(tree))
  names(tip_col) <- tree$tip.label
  for (lab in names(scored)) tip_col[[lab]] <- main$colors[[match(scored[[lab]], main$states)]]
  tiplabels(pch = 16, col = tip_col, cex = 1.4, offset = 0.15)

  asr <- mk_asr(tree, scored, main$states)
  nodelabels(node = internal_nodes, pie = asr$posterior[as.character(internal_nodes), , drop = FALSE],
             piecol = main$colors, cex = 0.7)
  legend("topleft", legend = main$states, fill = main$colors,
         title = main$name, bty = "n", cex = 0.8)
}

dev.off()

cat("Wrote cladeforge_reconstruction.pdf\\n")
`;
}
