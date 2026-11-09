// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Async DTL solving on a dedicated Web Worker, with a synchronous fallback for
// environments without Worker (tests, SSR, restricted webviews).
//
// The 2026-11-08 reconciliation-lag analysis (§3.5/§7) found the DP button runs
// the solver on the main thread; a large polytomic tree freezes the window for
// the whole solve. Requests are plain data, results are plain data, so the
// worker round-trip is a structured clone away.

import { solveDtl } from './dtl';
import type { DtlOptions } from './dtl';
import { solveDtlWithPolytomies } from './geneTrees';
import type { Project, ReconCosts } from './types';
import type { TipMapping } from './reconciliation';
import type { DtlWorkerRequest, DtlWorkerResponse, DtlWorkerResult } from './dtlWorker';

export type AsyncDtlResult = DtlWorkerResult;

interface PendingSolve {
  request: DtlWorkerRequest;
  resolve: (result: AsyncDtlResult) => void;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;
const pending = new Map<number, PendingSolve>();

/** Run a request on the main thread — the fallback path. */
function runSync(request: DtlWorkerRequest): AsyncDtlResult {
  try {
    return request.kind === 'polytomies'
      ? solveDtlWithPolytomies(
          request.species,
          request.gene,
          request.costs,
          request.tipOverride,
          request.options,
          request.replicates ?? 8,
          request.seed,
        )
      : solveDtl(request.species, request.gene, request.costs, request.tipOverride, request.options);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fail every in-flight request over to the synchronous solver. */
function drainToSync(reason: unknown): void {
  workerUnavailable = true;
  try {
    worker?.terminate();
  } catch {
    /* ignore */
  }
  worker = null;
  const stalled = [...pending.values()];
  pending.clear();
  for (const p of stalled) p.resolve(runSync(p.request));
  if (reason) console.warn('[dtl] worker unavailable, fell back to sync:', reason);
}

function getWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./dtlWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DtlWorkerResponse>) => {
      const { id, ...result } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      p.resolve(result);
    };
    worker.onerror = (e) => drainToSync(e);
    worker.onmessageerror = (e) => drainToSync(e);
  } catch (err) {
    workerUnavailable = true;
    worker = null;
    return null;
  }
  return worker;
}

function run(request: Omit<DtlWorkerRequest, 'id'>): Promise<AsyncDtlResult> {
  const w = getWorker();
  const id = nextRequestId++;
  const full: DtlWorkerRequest = { ...request, id };
  if (!w) return Promise.resolve(runSync(full));
  return new Promise((resolve) => {
    pending.set(id, { request: full, resolve });
    try {
      w.postMessage(full);
    } catch (err) {
      pending.delete(id);
      resolve(runSync(full));
      drainToSync(err);
    }
  });
}

/** Async `solveDtl`; never rejects — solver errors ride in `result.error`. */
export function solveDtlAsync(
  species: Project,
  gene: Project,
  costs: ReconCosts,
  tipOverride?: TipMapping,
  options: DtlOptions = {},
): Promise<AsyncDtlResult> {
  return run({ kind: 'solve', species, gene, costs, tipOverride, options });
}

/** Async `solveDtlWithPolytomies`; never rejects. */
export function solveDtlWithPolytomiesAsync(
  species: Project,
  gene: Project,
  costs: ReconCosts,
  tipOverride?: TipMapping,
  options: DtlOptions = {},
  replicates = 8,
  seed = 20260919,
): Promise<AsyncDtlResult> {
  return run({ kind: 'polytomies', species, gene, costs, tipOverride, options, replicates, seed });
}
