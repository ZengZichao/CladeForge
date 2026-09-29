#!/usr/bin/env Rscript
# CladeForge reproducible-analysis script
# Project : 古菌域演化
# Format  : CladeForge project v0.1.0
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
    edge = matrix(c(12, 13, 12, 14, 13, 15, 13, 16, 14, 17, 14, 1, 14, 2, 14, 3, 15, 4, 15, 5, 16, 6, 16, 7, 17, 18, 17, 19, 18, 8, 18, 9, 19, 10, 19, 11), ncol = 2, byrow = TRUE),
    edge.length = c(500, 600, 700, 800, 200, 300, 400, 500, 2800, 2800, 2700, 2700, 600, 700, 2600, 2600, 2500, 2500),
    Nnode = 8L,
    tip.label = c("Thaumarchaeota", "Korarchaeota", "Nanoarchaeota", "Methanosarcina", "Methanobrevibacter", "Halobacterium", "Natronomonas", "Thermoproteus", "Pyrobaculum", "Sulfolobus", "Metallosphaera"),
    node.label = c("Asgard", "Euryarchaeota", "Tetrarchaeota", "Methanobacteriales", "Halobacteriales", "Crenarchaeota", "Thermoproteales", "Sulfolobales")
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
rate <- 1 / mean(bl)


characters <- list(
  list(
    name = "能量代谢",
    type = "discrete",
    states = c("产甲烷", "嗜盐光能", "硫氧化"),
    colors = c("#7c3aed", "#0ea5e9", "#f59e0b"),
    cost = NULL,
    tips = c("Methanosarcina" = "产甲烷", "Methanobrevibacter" = "产甲烷", "Halobacterium" = "嗜盐光能", "Natronomonas" = "嗜盐光能", "Thermoproteus" = "硫氧化", "Pyrobaculum" = "硫氧化", "Sulfolobus" = "硫氧化", "Metallosphaera" = "硫氧化")
  ),
  list(
    name = "温度适应性",
    type = "discrete",
    states = c("超嗜热", "嗜热", "中温"),
    colors = c("#dc2626", "#f97316", "#22c55e"),
    cost = NULL,
    tips = c("Methanosarcina" = "中温", "Methanobrevibacter" = "中温", "Halobacterium" = "中温", "Natronomonas" = "中温", "Thermoproteus" = "超嗜热", "Pyrobaculum" = "超嗜热", "Sulfolobus" = "嗜热", "Metallosphaera" = "嗜热")
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
  asr <- mk_asr(tree, scored, ch$states)
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
title(main = "古菌域演化", cex.main = 1.0)

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

cat("Wrote cladeforge_reconstruction.pdf\n")
