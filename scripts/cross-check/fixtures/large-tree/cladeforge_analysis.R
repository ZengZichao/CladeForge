#!/usr/bin/env Rscript
# CladeForge reproducible-analysis script
# Project : 大树与深时
# Format  : CladeForge project v0.2.0
# Software: CladeForge 0.3.0 (this header is the provenance stamp a
#           reproducibility checklist asks for: software version, generation
#           time and the analysis parameters are printed beside the numbers)
# Generated: (timestamp omitted in fixture)
#
# PARAMETER SUMMARY (what the app used):
#   * parsimony: tie-break = parent-state first, then tip frequency, then
#     declaration order; the reported single path is ONE of possibly many
#     equally parsimonious reconstructions.
#   * Mk: each character's rate is the application's own fit (maximum-likelihood fit (1-D profile over the pruning likelihood)),
#     baked in at generation time; the script replays that number instead of
#     re-fitting, so its posteriors match what the app reported. Characters the
#     app could not fit fall back to 1 / mean(branch length) with a printed
#     note. Display threshold applied post hoc; the posterior is marginal
#     (per-node), NOT joint.
#   * The R implementation below computes the likelihood in ORDINARY space
#     while the app runs in log-space: values agree to floating-point noise on
#     modest trees but can drift on very large or very unbalanced ones.
#   * Node ancestral states asserted by the user in CladeForge are IGNORED by
#     the parsimony baseline (independent reference by design); the R script
#     reproduces that baseline, not the user's hypotheses.
#
# What this script reproduces, and what it does not:
#   REPRODUCED (same algorithms as the application):
#     * Sankoff parsimony with the project's step matrix (advisory baseline);
#     * equal-rates Mk ancestral-state reconstruction (pruning + up-pass), i.e.
#       the posterior probabilities the app reports.
#   APPROXIMATED:
#     * a PDF figure drawn from the same data — character-coloured tips,
#       posterior pies, legend — in the project's cladogram layout
#       (equal branch spacing, like the CladeForge cladogram (branch lengths ignored)). It is NOT a pixel copy of the on-screen figure: manual
#       node positions, collapsed clades, custom reticulation edges, era bands
#       and the interactive ladderising order are GUI state that ape does not
#       consume. The topology, tip labels, states and posteriors are identical;
#       the geometry is a same-data rendering.
#   Branch lengths: present, used as given.
# Run with: Rscript this_file.R   (install.packages("ape") if needed)

library(ape)

# The tree is assembled from vectors rather than parsed from Newick, so every
# label survives byte-exact even where ape's own reader would mangle it.
tree <- structure(
  list(
    edge = matrix(c(12, 13, 12, 14, 13, 15, 13, 16, 14, 17, 14, 18, 15, 1, 15, 2, 16, 3, 16, 4, 17, 19, 17, 5, 18, 6, 18, 7, 19, 20, 19, 21, 20, 8, 20, 9, 21, 10, 21, 11), ncol = 2, byrow = TRUE),
    edge.length = c(500, 600, 700, 800, 150, 350, 2800, 2800, 2700, 2700, 50, 150, 50, 150, 600, 700, 2600, 2600, 2500, 2500),
    Nnode = 10L,
    tip.label = c("Taxon_N", "Taxon_O", "Taxon_P", "Taxon_Q", "Taxon_F", "Taxon_H", "Taxon_I", "Taxon_R", "Taxon_S", "Taxon_T", "Taxon_U"),
    node.label = c("Taxon_A", "Taxon_B", "Taxon_C", "Taxon_J", "Taxon_K", "Taxon_D", "Taxon_G", "Taxon_E", "Taxon_L", "Taxon_M")
  ),
  class = "phylo"
)

# Branch lengths, with an explicit unit-length fallback: a cladogram-only project
# serialises no lengths at all, and 1 / mean(NULL) would poison every
# transition probability below.
bl <- tree$edge.length
if (is.null(bl) || !any(is.finite(bl) & bl > 0)) {
  bl <- rep(1, nrow(tree$edge))
  cat("NOTE: the tree carries no usable branch lengths; Mk probabilities and the\n")
  cat("      figure use unit (equal) branch lengths, i.e. topology-only inference.\n\n")
}

# Equal-rates Mk rate: one expected substitution per mean branch, so the
# transition probabilities are invariant to the tree's absolute scale. Every
# length above is already resolved the way the application resolves it (a
# recorded 0 is a real zero; unset / negative / non-finite became 1), so the mean
# runs over ALL of them — filtering here would drop zero-length and unmeasured
# edges from the average and make this script reconstruct at a different rate
# than the application reports. Deriving it from the fallback-protected bl
# above is what keeps the rate finite for a cladogram-only project.
#
# This fallback rate is used ONLY for a character the application itself could
# not fit (NULL rate below); characters with a baked rate replay the
# application's ML value, so the script's posteriors match the app's instead
# of drifting with the branch-length mean.
rate <- 1 / mean(bl)


characters <- list(
  list(
    name = "性状 1",
    type = "discrete",
    states = c("状态 A", "状态 B", "状态 C"),
    colors = c("#7c3aed", "#0ea5e9", "#f59e0b"),
    cost = NULL,
    rate = 0.00006778334067067193,
    tips = c("Taxon_N" = "状态 A", "Taxon_O" = "状态 A", "Taxon_P" = "状态 B", "Taxon_Q" = "状态 B", "Taxon_R" = "状态 C", "Taxon_S" = "状态 C", "Taxon_T" = "状态 C", "Taxon_U" = "状态 C")
  ),
  list(
    name = "性状 2",
    type = "discrete",
    states = c("状态 A", "状态 B", "状态 C"),
    colors = c("#dc2626", "#f97316", "#22c55e"),
    cost = NULL,
    rate = 0.00006856783131526523,
    tips = c("Taxon_N" = "状态 C", "Taxon_O" = "状态 C", "Taxon_P" = "状态 C", "Taxon_Q" = "状态 C", "Taxon_R" = "状态 A", "Taxon_S" = "状态 A", "Taxon_T" = "状态 B", "Taxon_U" = "状态 B")
  )
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
## 'rate' is passed per character: the application's own ML fit for that
## character when it has one, else the 1 / mean usable branch length fallback.
## For very large or very unbalanced trees prefer log-space implementations
## (phangorn::ace, phytools).
mk_asr <- function(tree, tip_states, states, rate) {
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

cat("CladeForge reproducible analysis\n")
cat("Tree:", Ntip(tree), "tips,", tree$Nnode, "internal nodes\n\n")

internal_nodes <- (length(tree$tip.label) + 1):(length(tree$tip.label) + tree$Nnode)

for (ch in characters) {
  cat("== Character:", ch$name, "==\n")
  if (ch$type != "discrete" || length(ch$states) < 2) {
    cat("   continuous or single-state: exported as data only\n\n")
    next
  }
  scored <- ch$tips[names(ch$tips) %in% tree$tip.label]
  cost <- ch$cost
  if (is.null(cost)) {
    k <- length(ch$states)
    cost <- matrix(1, k, k); diag(cost) <- 0
  }
  sp <- sankoff(tree, scored, ch$states, cost)
  cat(sprintf("   Sankoff minimum cost: %g (step-matrix units)\n", sp$cost))
  ch_rate <- if (is.null(ch$rate)) {
    cat(sprintf("   NOTE: the application could not fit a rate for this character; using 1 / mean(branch length) = %g\n", rate))
    rate
  } else ch$rate
  asr <- mk_asr(tree, scored, ch$states, ch_rate)
  cat("   Mk posterior at each internal node (states:",
      paste(ch$states, collapse = " / "), ")\n")
  print(round(asr$posterior[as.character(internal_nodes), , drop = FALSE], 3))
  cat("\n")
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
cat("Figure layout: type = cladogram, use.edge.length = FALSE",
    "(equal branch spacing, like the CladeForge cladogram (branch lengths ignored))\n")
plot(tree, type = "cladogram", use.edge.length = FALSE,
     show.tip.label = TRUE,
     label.offset = 0.3,
     edge.color = "#374151", edge.width = 1.4)
title(main = "大树与深时", cex.main = 1.0)

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

  asr <- mk_asr(tree, scored, main$states, if (is.null(main$rate)) rate else main$rate)
  nodelabels(node = internal_nodes, pie = asr$posterior[as.character(internal_nodes), , drop = FALSE],
             piecol = main$colors, cex = 0.7)
  legend("topleft", legend = main$states, fill = main$colors,
         title = main$name, bty = "n", cex = 0.8)
}

dev.off()

cat("Wrote cladeforge_reconstruction.pdf\n")
