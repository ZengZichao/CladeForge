#!/usr/bin/env Rscript
# Third-party correctness comparison: CladeForge vs ape / phangorn.
#
# Does an established implementation produce the same numbers as CladeForge?
# This script answers that on the shipped sample projects and reports ONLY what
# is genuinely comparable:
#
#   leg 1  STEP COUNTS — phangorn::parsimony() (Fitch, unordered, unit costs)
#          against CladeForge's minimum cost under a uniform step matrix, for
#          characters whose tips are all scored. Characters carrying missing
#          codings ("?" / "-") are excluded rather than mis-scored: phangorn's
#          phyDat deletes sites it cannot encode, which silently returns 0 and
#          would look like a disagreement when it is a representational gap.
#
#   leg 2  ER-Mk MARGINAL POSTERIORS — MEASURED, NEVER GATED. ape::ace refuses
#          any tree that is not rooted AND fully dichotomous, and most shipped
#          sample projects contain stem lineages (single-child nodes): on this
#          fixture set bacteria, virus, cetacean and animal are refused on that
#          ground, archaea is refused for missing codings, and only plant (three
#          characters) gets through. That is a property of the third-party tool,
#          not of the data, so those projects are reported as NOT-COMPARABLE with
#          the reason instead of being quietly dropped or forced through a
#          contraction that would change which nodes are being compared. The
#          `er-control` fixture exists to make the leg reachable on a
#          purpose-built tree: rooted, fully dichotomous, 8 tips, all scored
#          (dump-fixtures.ts asserts those properties and throws if an edit ever
#          breaks them).
#
#          Why no agreement can be claimed here. ape::ace(model = "ER") ESTIMATES
#          the transition rate by maximum likelihood — its documented values
#          include `rates` and `se` — while CladeForge fixes the rate at
#          1/mean(branch length). Posteriors depend on that rate, so a difference
#          here mixes an implementation gap with a model choice and cannot be
#          scored either way. The leg therefore reports the measurement (ape's
#          fitted rate, the worst and mean posterior deviation, how often the most
#          likely state coincides) with `compared = 0`, which keeps it out of every
#          agreement total. Note also that a single free rate makes ape's fit
#          invariant to multiplying every branch length by a constant, so the
#          mean-rescaled tree and the raw tree give the same marginals; the raw
#          tree is used, because that is the tree the application exports.
#
#          The marginals come from `fit$lik.anc` ("the scaled likelihoods of each
#          ancestral state", ape's documented component for discrete ML).
#          `states` / `probs` are accepted as fallbacks for other ape builds and
#          whichever is used is named in the output; the row count may cover
#          internal nodes only or tips + internal nodes.
#
#          `ace()` has to be told `type = "discrete"`. Its default is
#          "continuous", and ace.continuous does not know the discrete model name
#          "ER": it returns a list whose ONLY component is `call`, with no error
#          and no warning, so every marginal lookup fails silently. A fixture that
#          is otherwise comparable and reports "no lik.anc/states/probs matrix
#          (components: call)" is missing that argument, not the data.
#
#          The rate-free third-party check that IS a test is phangorn's Fitch
#          parsimony — that is leg 1.
#
#   leg 3  THE APP'S OWN EXPORTED R SCRIPT — re-runs the shipped
#          cladeforge_analysis.R and compares the Sankoff costs it prints against
#          manifest.tsv. Not a third-party number; it is the only check that the
#          reproducibility artifact the app writes out reproduces the app.
#          The child runs from a COPY in the session's temporary directory:
#          `system2()` passes the whole command line to the shell as one string,
#          and R refuses to build that string when a path cannot be represented in
#          the session's native encoding, which is the case for any repository
#          checked out under a non-ASCII directory.
#
# Usage:  Rscript scripts/cross-check/ape_agreement.R [fixtures-dir]
# Requires: ape, phangorn.  Exit 0 = every attempted comparison agreed.
#
# What the shipped fixtures produce (R 4.5.3, ape 5.8.1, phangorn 2.12.1):
# step-count 10/10 compared and agreed;  exported-R-script-Sankoff 14/14;
# ER-marginals 0/0 by design — the summary line reads "MEASURED, NOT GATED ...
# measured on 4 project(s)". A run that reports `1/1` on leg 1, or `0 cost
# line(s)` on leg 3, is a broken lookup rather than a data limitation: leg 1 can
# only reach ten characters when the CJK state labels actually join (see
# read_tsv), and every fixture project ships an analysis script that prints at
# least one cost.

suppressPackageStartupMessages({
  library(ape)
  library(phangorn)
})

args <- commandArgs(trailingOnly = TRUE)
here <- dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))
fixtures <- if (length(args) && nzchar(args[1])) args[1] else file.path(here, "fixtures")
if (!dir.exists(fixtures)) stop("no fixtures at ", fixtures)

read_tsv <- function(p) {
  if (!file.exists(p)) return(NULL)
  df <- utils::read.delim(p, sep = "\t", header = TRUE, stringsAsFactors = FALSE,
                          quote = "")
  # The fixtures are UTF-8 BYTES. Declaring `fileEncoding = "UTF-8"` asks
  # read.table to TRANSLATE them into the session's native encoding, and under
  # LC_CTYPE=C that silently mangles every CJK field and drops the rows it cannot
  # convert — the state labels here are Chinese (产甲烷 / 嗜盐光能 / 硫氧化), so a
  # leg can quietly collapse from ten comparable characters down to one. Take the
  # bytes as read and tag them instead: the comparison is then correct in either
  # locale, because both sides of every join get the same treatment.
  df[] <- lapply(df, function(x) if (is.character(x)) enc2utf8(x) else x)
  df
}

rows <- list()
add <- function(project, character, leg, n, agree, detail) {
  rows[[length(rows) + 1]] <<- data.frame(
    project = project, character = character, leg = leg,
    compared = n, agreed = agree, detail = detail, stringsAsFactors = FALSE
  )
}

#' Rebuild a phylo object from the exported node table, positionally.
#'
#' This deliberately does NOT parse tree.nwk. ape 5.8.1's own Newick reader cannot
#' handle a quoted label containing spaces or parentheses: it returns
#' "Tobaccomosaicvirus" (quotes kept, spaces deleted) and turns
#' "Gracilicutes (GN)" into GN, and its writer then emits output it cannot re-read.
#' That is a limitation of the third-party reader, not of the exported file, so the
#' comparison rebuilds the same topology from nodes.tsv and keeps the real labels.
#'
tree_from_nodes <- function(nodes) {
  is_tip <- as.integer(nodes$is_tip) == 1L
  labels <- as.character(nodes$label)
  keys <- as.character(nodes$node_key)
  blen <- suppressWarnings(as.numeric(nodes$branch_length))
  tip_ids <- which(is_tip)
  int_ids <- which(!is_tip)
  id_of <- integer(nrow(nodes))
  id_of[tip_ids] <- seq_along(tip_ids)
  id_of[int_ids] <- length(tip_ids) + seq_along(int_ids)
  pidx <- match(as.character(nodes$parent_key), keys)
  edges <- vector("list", sum(!is.na(pidx))); lens <- numeric(length(edges))
  k <- 0L
  for (i in seq_len(nrow(nodes))) {
    if (is.na(pidx[i])) next
    k <- k + 1L
    edges[[k]] <- c(id_of[pidx[i]], id_of[i])
    lens[k] <- if (is.na(blen[i])) 0 else blen[i]
  }
  structure(
    list(edge = do.call(rbind, edges), edge.length = lens,
         Nnode = length(int_ids), tip.label = labels[tip_ids]),
    class = "phylo"
  )
}

#' Deviation bucket that only DESCRIBES the ER gap. This is not a pass/fail
#' tolerance: the leg never gates (see the header — ape fits its rate, CladeForge
#' fixes its), and `compared` stays 0 so no part of this can be quoted as
#' agreement. The bucket only decides how the count is phrased in the output.
ER_REPORT_BUCKET <- 0.05

#' Join ape's ER marginals to CladeForge's asr_posteriors.tsv, then describe them.
#'
#' The join is by CLADE, never by position. `ape::ace` works on a reordered copy
#' of the tree, so a positional join would compare one implementation's node
#' against the other's *different* node and still print a number. Each node is
#' therefore re-identified here with exactly the key dump-fixtures.ts writes into
#' `node_key`: the sorted tip set beneath it (`T:<tip>` for a tip,
#' `N:<tips>|<n>` for an internal node, `<n>` counting every node in that
#' sub-tree). If that key does not resolve one-to-one on both sides, the
#' measurement is dropped with a reason instead of guessed at.
#'
#' Returns list(compared, agreed, detail). `compared` and `agreed` are 0 whenever
#' the measurement succeeded — this leg reports, it does not judge. A non-zero
#' `compared` would mean a bug in this script, so the caller still counts it.
er_marginal_measurement <- function(phy, fit, asr, ch, cf_rate) {
  # Which component holds the marginals is resolved by inspection, not by name:
  # ape's documentation puts them in `lik.anc` for discrete ML, older builds used
  # `states`, and picking by property keeps the leg working on either. Anything
  # that is not a probability matrix (rows summing to 1) is rejected, so a
  # log-likelihood or a standard-error table can never be compared as if it were a
  # posterior. The output names whichever component is used; on the shipped
  # fixtures that is `lik.anc`, 7 rows for the 7 internal nodes of `er-control`.
  pick <- NULL
  for (nm in c("lik.anc", "states", "probs")) {
    cand <- fit[[nm]]
    if (is.matrix(cand) && ncol(cand) > 1 && !any(is.na(cand)) &&
        all(abs(rowSums(cand) - 1) <= 1e-6)) {
      pick <- list(name = nm, m = cand)
      break
    }
  }
  if (is.null(pick)) {
    return(list(compared = 0L, agreed = 0L,
                detail = sprintf("FAILED: no lik.anc/states/probs matrix of probabilities (components: %s)",
                                 paste(names(fit), collapse = ", "))))
  }
  st <- pick$m
  n_tip <- length(phy$tip.label)
  n_node <- as.integer(phy$Nnode)
  # `lik.anc` covers the ancestral nodes only; a tips + nodes matrix is accepted
  # too. Anything else means the row mapping below would be a guess.
  if (nrow(st) == n_node) {
    row_of <- c(rep(NA_integer_, n_tip), seq_len(n_node))
  } else if (nrow(st) == n_tip + n_node) {
    row_of <- seq_len(n_tip + n_node)
  } else {
    return(list(compared = 0L, agreed = 0L,
                detail = sprintf("FAILED: ape's $%s has %d rows; tree has %d tips + %d nodes",
                                 pick$name, nrow(st), n_tip, n_node)))
  }

  ## --- rebuild the clade keys, in ape's own node numbering ------------------
  # One Descendants() call per internal node rather than one vectorised call:
  # phangorn returns a bare integer vector for a single node and a list for
  # several, and lapply fixes the shape either way.
  desc <- try(lapply((n_tip + 1L):(n_tip + n_node),
                     function(v) phangorn::Descendants(phy, v, type = "all")),
              silent = TRUE)
  if (inherits(desc, "try-error") || length(desc) != n_node) {
    return(list(compared = 0L, agreed = 0L,
                detail = "FAILED: phangorn::Descendants could not resolve the internal nodes"))
  }
  key <- character(n_tip + n_node)
  for (i in seq_len(n_tip)) key[i] <- paste0("T:", phy$tip.label[i])
  for (j in seq_len(n_node)) {
    below <- as.integer(desc[[j]])
    # method = "radix" is C-locale byte order, which is what JavaScript's default
    # Array.sort (UTF-16 code units) produces too. The platform collation would
    # order "t10" before "t2" and silently break the key match on larger trees.
    tips <- sort(phy$tip.label[below[below <= n_tip]], method = "radix")
    key[n_tip + j] <- paste0("N:", paste(tips, collapse = "+"), "|", 1L + length(below))
  }
  if (anyDuplicated(key)) {
    return(list(compared = 0L, agreed = 0L,
                detail = "FAILED: two nodes share a clade key, so the join is ambiguous"))
  }

  ## --- line the fixture up against it --------------------------------------
  rows <- asr[asr$character == ch, ]
  if (!nrow(rows)) {
    return(list(compared = 0L, agreed = 0L,
                detail = "NOT-COMPARABLE: CladeForge exported no posteriors for this character"))
  }
  node_chr <- as.character(rows$node_key)
  if (anyDuplicated(paste(node_chr, as.character(rows$state_index)))) {
    return(list(compared = 0L, agreed = 0L,
                detail = "FAILED: the fixture repeats a (node_key, state_index) pair"))
  }
  node_idx <- match(node_chr, key)
  if (any(is.na(node_idx))) {
    return(list(compared = 0L, agreed = 0L,
                detail = sprintf("FAILED: %d node_key(s) had no clade in the rebuilt tree",
                                 sum(is.na(node_idx)))))
  }
  col_idx <- as.integer(rows$state_index) + 1L
  if (any(is.na(col_idx)) || any(col_idx < 1L) || any(col_idx > ncol(st))) {
    return(list(compared = 0L, agreed = 0L,
                detail = sprintf("FAILED: state_index outside ape's %d column(s)", ncol(st))))
  }
  mrow <- row_of[node_idx]
  covered <- !is.na(mrow)
  if (!any(covered)) {
    return(list(compared = 0L, agreed = 0L,
                detail = sprintf("FAILED: ape's $%s covers no node present in the fixture", pick$name)))
  }

  cf <- matrix(NA_real_, nrow = length(key), ncol = ncol(st))
  cf[cbind(node_idx[covered], col_idx[covered])] <-
    suppressWarnings(as.numeric(rows$posterior[covered]))
  if (any(is.na(cf[unique(node_idx[covered]), ]))) {
    return(list(compared = 0L, agreed = 0L,
                detail = "FAILED: non-finite posterior, or a state missing from the fixture"))
  }

  ## --- measure (never gate) --------------------------------------------------
  node_c <- node_idx[covered]
  mrow_c <- mrow[covered]
  dev <- abs(st[cbind(mrow_c, col_idx[covered])] - cf[cbind(node_c, col_idx[covered])])
  here <- sort(unique(node_c))
  # One ape matrix row per node, so taking the fixture's first row for that node
  # is exact: every row of the same node maps to the same ape row.
  am_ape <- apply(st[mrow_c[match(here, node_c)], , drop = FALSE], 1L, which.max)
  am_cf <- apply(cf[here, , drop = FALSE], 1L, which.max)
  internal <- here > n_tip
  rates <- if (is.null(fit$rates)) "n/a" else paste(sprintf("%.4f", as.numeric(fit$rates)), collapse = ", ")
  list(
    compared = 0L,
    agreed = 0L,
    detail = sprintf(
      paste0("MEASURED, NOT GATED (ape fits its rate, CladeForge fixes 1/mean = %.4g): ",
             "%d/%d fixture rows covered by $%s; max |diff| = %.4f, mean = %.4f, ",
             "%d within %.2f; argmax state matches on %d/%d internal nodes; ape rate(s): %s"),
      cf_rate, sum(covered), nrow(rows), pick$name, max(dev), mean(dev),
      sum(dev <= ER_REPORT_BUCKET), ER_REPORT_BUCKET,
      sum(am_ape[internal] == am_cf[internal]), sum(internal), rates)
  )
}

man <- read_tsv(file.path(fixtures, "manifest.tsv"))
if (is.null(man)) stop("manifest.tsv missing — run: node scripts/cross-check/dump-fixtures.mjs")

failures <- 0L
for (i in seq_len(nrow(man))) {
  project <- man$project[i]; ch <- man$character[i]
  pdir <- file.path(fixtures, project)
  if (!dir.exists(pdir)) next
  nodes <- read_tsv(file.path(pdir, "nodes.tsv"))
  phy <- if (is.null(nodes)) NULL else try(tree_from_nodes(nodes), silent = TRUE)
  if (is.null(phy) || inherits(phy, "try-error")) {
    add(project, ch, "tree-load", 0L, 0L, "FAILED: nodes.tsv did not rebuild a phylo")
    failures <- failures + 1L
    next
  }

  mat <- read_tsv(file.path(pdir, "matrix.tsv"))
  lab <- read_tsv(file.path(pdir, "characters.tsv"))
  sub <- mat[mat$character == ch, ]
  if (!nrow(sub) || is.null(lab)) next

  l2i <- stats::setNames(as.integer(lab$state_index[lab$character == ch]),
                         as.character(lab$state_label[lab$character == ch]))
  # Build one tip-indexed score vector, keyed by the tree's own tip order.
  # Indexing by position (match()) rather than by name avoids two traps seen in
  # practice: duplicated tip rows silently lengthen the value vector, and a name
  # that is absent from the matrix becomes an NA subscript.
  labels <- as.character(sub$state_label)
  tipnames <- as.character(sub$tip)
  codes <- suppressWarnings(as.integer(l2i[labels]))   # NA = missing or unknown label
  names(codes) <- tipnames
  codes <- codes[!duplicated(names(codes))]
  tips <- as.character(phy$tip.label)
  vec <- codes[tips]

  # "The data are missing" and "my lookup found nothing" are different facts, and
  # conflating them silences the harness: a broken state-label join (see read_tsv
  # above) turns every tip into NA, and the legs then report the project as
  # legitimately excluded for carrying missing codings. Count what the fixture
  # actually declares missing and refuse to treat anything beyond that as data.
  declared_missing <- sum(trimws(labels) %in% c("?", "-", "N", "n", "NA"))
  if (sum(!(tips %in% names(codes))) > 0L) {
    failures <- failures + 1L
    add(project, ch, "join", 0L, 0L,
        sprintf("FAILED: %d tree tip(s) have no row in matrix.tsv (e.g. %s)",
                sum(!(tips %in% names(codes))),
                paste(head(setdiff(tips, names(codes)), 3), collapse = "/")))
    next
  }
  if (sum(is.na(codes)) > declared_missing) {
    failures <- failures + 1L
    add(project, ch, "join", 0L, 0L,
        sprintf("FAILED: %d of %d codings did not resolve against characters.tsv, which declares only %d as missing — unresolved state labels: %s",
                sum(is.na(codes)), nrow(sub), declared_missing,
                paste(head(sort(unique(labels[is.na(codes)])), 4), collapse = "/")))
    next
  }
  lv <- sort(unique(vec[!is.na(vec)]))
  complete <- !any(is.na(vec)) && length(tips) >= 3 && length(lv) >= 2
  fac <- factor(vec, levels = lv)
  names(fac) <- tips

  ## ---- leg 1: step counts --------------------------------------------------
  uniform <- identical(tolower(as.character(man$sankoff_matrix[i])), "uniform")
  if (uniform && complete) {
    # Use the raw 0-based state codes and declare exactly those levels; passing
    # factor codes (1..L) here would make every state look unknown and silently
    # score 0.
    m <- matrix(vec, nrow = length(tips), ncol = 1, dimnames = list(tips, ch))
    pd <- phyDat(m, type = "USER", levels = lv)
    sc <- tryCatch(as.numeric(parsimony(phy, pd)),
                   error = function(e) NA_real_, warning = function(w) NA_real_)
    app <- as.numeric(man$sankoff_min_cost[i])
    if (!is.na(sc)) {
      ok <- sc == app
      if (!ok) failures <- failures + 1L
      add(project, ch, "step-count(phangorn::parsimony)", 1L, as.integer(ok),
          sprintf("CladeForge %g vs phangorn %g (Fitch, unit costs, all tips scored)", app, sc))
    } else {
      failures <- failures + 1L
      add(project, ch, "step-count(phangorn::parsimony)", 0L, 0L, "FAILED: phangorn errored")
    }
  } else if (uniform) {
    add(project, ch, "step-count(phangorn::parsimony)", 0L, 0L,
        "EXCLUDED: character carries missing (?) codings; phyDat would drop the site")
  }

  ## ---- leg 2: ER-Mk marginals (measured, never gated) ----------------------
  # Run on the RAW branch lengths: ape's ER has a single free rate, so scaling
  # every length by a constant leaves the fitted marginals unchanged (see the
  # header). The mean-rescaled tree would give the same numbers, less honestly.
  asr <- read_tsv(file.path(pdir, "asr_posteriors.tsv"))
  n_states <- suppressWarnings(as.integer(man$states[i]))
  cf_rate <- suppressWarnings(as.numeric(man$rate_1_over_mean[i]))

  fit <- if (complete) tryCatch(
    {
      # `type` MUST be given: ape::ace defaults to type = "continuous", and
      # ace.continuous does not know the discrete model name "ER" — it returns a
      # list whose only component is `call`, silently. An otherwise comparable
      # fixture that reports "no lik.anc/states/probs matrix (components: call)"
      # is missing this argument, not the data.
      ape::ace(fac, phy, type = "discrete", model = "ER", method = "ML")
    },
    error = function(e) conditionMessage(e)
  ) else NULL

  if (!complete) {
    # A deliberate exclusion, not a failure. ape reads `?` as ambiguity and so
    # does CladeForge, but comparing them then stacks a difference in missing-data
    # convention on top of the difference in rate treatment this leg already
    # cannot control for. `er-control` is the fully scored fixture built for it.
    add(project, ch, "ER-marginals(ape::ace)", 0L, 0L,
        sprintf("NOT-COMPARABLE: %d of %d tips carry a missing (?) coding",
                sum(is.na(vec)), length(vec)))
  } else if (is.character(fit) && grepl("dichotomous", fit)) {
    add(project, ch, "ER-marginals(ape::ace)", 0L, 0L,
        "NOT-COMPARABLE: ape::ace needs a rooted fully dichotomous tree; this project has stem lineages")
  } else if (inherits(fit, "try-error") || is.character(fit) || is.null(fit)) {
    failures <- failures + 1L
    add(project, ch, "ER-marginals(ape::ace)", 0L, 0L,
        paste("FAILED:", substr(paste(fit, collapse = " "), 1, 90)))
  } else if (length(lv) != n_states) {
    # CladeForge still reports a posterior for a state no tip shows, but ace
    # builds its columns from the factor levels, i.e. from the observed states
    # only. Comparing them column by column would be a category error.
    add(project, ch, "ER-marginals(ape::ace)", 0L, 0L,
        sprintf("NOT-COMPARABLE: %d state(s) declared, only %d seen on the tips, so ape has fewer columns",
                n_states, length(lv)))
  } else if (is.null(asr) || !nrow(asr)) {
    failures <- failures + 1L
    add(project, ch, "ER-marginals(ape::ace)", 0L, 0L, "FAILED: asr_posteriors.tsv missing or empty")
  } else {
    cmp <- tryCatch(er_marginal_measurement(phy, fit, asr, ch, cf_rate),
                    error = function(e) list(compared = 0L, agreed = 0L,
                                             detail = paste("FAILED:", substr(conditionMessage(e), 1, 90))))
    add(project, ch, "ER-marginals(ape::ace)", cmp$compared, cmp$agreed, cmp$detail)
    # A measurement always comes back with compared = 0; anything else, or a
    # FAILED reason, means this script did not do its job and has to be heard.
    if (cmp$compared > 0L || grepl("^FAILED", cmp$detail)) failures <- failures + 1L
  }
}

## ---- leg 3: the app's OWN exported analysis script, re-run -----------------
#
# Not third-party evidence: this asks whether the reproducible-analysis script the
# application writes out reproduces the application's own Sankoff costs. A
# disagreement here is therefore a broken export, not a modelling dispute, and a
# cost that cannot be parsed at all means the export went unchecked.
#
# Costs are matched by ORDER, not by name: both sides walk the project's discrete
# multi-state characters in declaration order (dump-fixtures.ts skips the rest when
# writing manifest.tsv, the exported script prints "or skipped" lines without a
# cost for them), and a length mismatch is reported as a failure rather than being
# silently re-aligned.
rscript_bin <- file.path(R.home("bin"), "Rscript")
for (project in unique(as.character(man$project))) {
  script <- file.path(fixtures, project, "cladeforge_analysis.R")
  want <- suppressWarnings(as.numeric(man$sankoff_min_cost[man$project == project]))
  if (!file.exists(script)) {
    failures <- failures + 1L
    add(project, "-", "exported-R-script-Sankoff", 0L, 0L, "FAILED: no cladeforge_analysis.R in the fixtures")
    next
  }
  # The script writes its PDF into the working directory, so it runs in a throwaway
  # one. Resolve the script path before changing directories: `fixtures` may be relative.
  script <- normalizePath(script, mustWork = TRUE)
  work <- file.path(tempdir(), paste0("cf-export-", project))
  dir.create(work, showWarnings = FALSE, recursive = TRUE)
  # Run a COPY that lives under the temporary directory. `system2()` hands the whole
  # command line to the shell as ONE string, and R refuses to build that string when
  # a path is not representable in the session's native encoding — which is the case
  # for any repository checked out under a non-ASCII directory, where the child never
  # starts and every project reports "the script printed 0 cost line(s)". Copying
  # sidesteps the command line entirely; the exported script carries its tree, tip
  # table and cost matrices inline, so nothing else has to come along with it.
  local_script <- file.path(work, "cladeforge_analysis.R")
  copy_problem <- if (!file.copy(script, local_script, overwrite = TRUE)) {
    "the script could not be copied into the working directory"
  } else if (any(charToRaw(work) > 127L)) {
    "the working directory path is not ASCII, so system2() cannot build the command line"
  } else NULL
  if (!is.null(copy_problem)) {
    failures <- failures + 1L
    add(project, "-", "exported-R-script-Sankoff", 0L, 0L,
        sprintf("FAILED: %s (tempdir: %s, LC_CTYPE=%s) — run with TMPDIR set to an ASCII path",
                copy_problem, work, Sys.getlocale("LC_CTYPE")))
    next
  }
  owd <- setwd(work)
  ran <- tryCatch(
    system2(rscript_bin, shQuote(local_script), stdout = TRUE, stderr = TRUE),
    error = function(e) structure(conditionMessage(e), status = NA_integer_)
  )
  setwd(owd)
  status <- attr(ran, "status")
  lines <- if (is.character(ran)) as.character(ran) else character(0)
  got <- suppressWarnings(
    as.numeric(sub(".*Sankoff minimum cost: ([-+0-9.eE]+).*", "\\1",
                   grep("Sankoff minimum cost:", lines, value = TRUE)))
  )
  got <- got[!is.na(got)]
  note <- if (!is.null(status) && !is.na(status) && status != 0L) {
    sprintf(" (the script exited %d after printing; the PDF block needs cairo_pdf)", as.integer(status))
  } else ""

  if (length(got) != length(want)) {
    failures <- failures + 1L
    # Whatever the child DID say goes into the report: "0 cost line(s)" on its own
    # is indistinguishable from a harness that never launched it, so the child's own
    # output is what tells the two apart.
    echoed <- if (length(lines)) substr(paste(lines, collapse = " / "), 1, 220) else "<no output>"
    add(project, "-", "exported-R-script-Sankoff", 0L, 0L,
        sprintf("FAILED: the script printed %d cost line(s) for %d character(s)%s — child said: %s",
                length(got), length(want), note, echoed))
    next
  }
  ok <- got == want
  if (!all(ok)) failures <- failures + 1L
  add(project, "-", "exported-R-script-Sankoff", length(want), as.integer(sum(ok)),
      sprintf("app [%s] vs exported script [%s]%s",
              paste(want, collapse = ", "), paste(got, collapse = ", "), note))
}

res <- if (length(rows)) do.call(rbind, rows) else data.frame()
if (!nrow(res)) { cat("INCONCLUSIVE: nothing ran\n"); quit(save = "no", status = 2L) }
print(res, row.names = FALSE)
cat("\n# per-leg totals\n")
print(aggregate(cbind(compared, agreed) ~ leg, data = res, FUN = sum))

out <- file.path(fixtures, "ape-agreement.tsv")
utils::write.table(res, out, sep = "\t", quote = FALSE, row.names = FALSE)
cat("# wrote", nrow(res), "rows to", out, "\n")

stepped <- res[res$leg == "step-count(phangorn::parsimony)" & res$compared == 1L, ]
if (!nrow(stepped)) { cat("INCONCLUSIVE: no character was comparable\n"); quit(save = "no", status = 2L) }
cat(sprintf("\nTHIRD-PARTY RESULT: %d/%d comparable characters agree exactly with phangorn's Fitch score\n",
            sum(stepped$agreed), nrow(stepped)))

erm <- res[res$leg == "ER-marginals(ape::ace)", ]
measured <- erm[grepl("^MEASURED", erm$detail), ]
if (nrow(measured)) {
  # Reported, never totalled: ape estimates its ER rate and CladeForge fixes its,
  # so these numbers describe a gap between two models, not a disagreement.
  cat(sprintf("ER MARGINALS: measured on %d project(s); deliberately NOT counted as agreement\n",
              nrow(measured)))
  for (d in measured$detail) cat("  -", d, "\n")
} else {
  cat("NO ER MARGINAL MEASUREMENT RAN: ape::ace refused or lacked the data on every project\n")
  for (d in unique(erm$detail)) cat("  -", d, "\n")
}
exr <- res[res$leg == "exported-R-script-Sankoff" & res$compared > 0L, ]
if (nrow(exr)) {
  cat(sprintf("REPRODUCIBILITY: %d/%d Sankoff costs reproduced by the app's own exported R script\n",
              sum(exr$agreed), sum(exr$compared)))
}

if (failures > 0L) {
  cat("INCOMPLETE:", failures, "comparison(s) disagreed or errored\n")
  quit(save = "no", status = 1L)
}
cat("OK: every attempted comparison agreed\n")
quit(save = "no", status = 0L)
