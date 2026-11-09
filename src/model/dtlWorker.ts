// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Web Worker entry for the DTL solver.
//
// The 2026-11-08 reconciliation-lag analysis (§3.5) found the DP button runs
// solveDtlWithPolytomies synchronously on the main thread: on a large polytomic
// gene tree the replicates can freeze the window for seconds. The solver is a
// pure module, so it runs unchanged here; the UI talks to it through
// `dtlAsync.ts` (async API with a synchronous fallback).

import { solveDtl } from './dtl';
import type { DtlOptions, DtlSolveResult } from './dtl';
import { solveDtlWithPolytomies } from './geneTrees';
import type { PolytomySolveSummary } from './geneTrees';
import type { Project, ReconCosts } from './types';
import type { TipMapping } from './reconciliation';

export interface DtlWorkerRequest {
  id: number;
  kind: 'solve' | 'polytomies';
  species: Project;
  gene: Project;
  costs: ReconCosts;
  tipOverride?: TipMapping;
  options: DtlOptions;
  replicates?: number;
  seed?: number;
}

export type DtlWorkerResult = DtlSolveResult & { polytomySummary?: PolytomySolveSummary };

export type DtlWorkerResponse = { id: number } & DtlWorkerResult;

/** Worker global typed locally: the app's tsconfig compiles against the DOM
 *  lib, so importing lib.webworker would collide with it. */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DtlWorkerRequest>) => void) | null;
  postMessage: (msg: DtlWorkerResponse) => void;
};

ctx.onmessage = (e) => {
  const req = e.data;
  let result: DtlWorkerResult;
  try {
    result =
      req.kind === 'polytomies'
        ? solveDtlWithPolytomies(
            req.species,
            req.gene,
            req.costs,
            req.tipOverride,
            req.options,
            req.replicates ?? 8,
            req.seed,
          )
        : solveDtl(req.species, req.gene, req.costs, req.tipOverride, req.options);
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage({ id: req.id, ...result });
};
