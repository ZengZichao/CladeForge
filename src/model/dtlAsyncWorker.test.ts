// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Worker-protocol coverage for the async DTL API. The Node test environment has
// no Web Worker, so a fake Worker verifies the request/response wiring (one
// reused worker, request kinds, message round-trip) and the error path falling
// back to the in-process solver.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNewick } from '../io/newick';
import { solveDtl } from './dtl';
import type { DtlWorkerRequest, DtlWorkerResponse } from './dtlWorker';

const COSTS = { dup: 1, transfer: 2, loss: 1 };

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failNext = false;

  onmessage: ((e: MessageEvent<DtlWorkerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  posted: DtlWorkerRequest[] = [];

  constructor(..._args: unknown[]) {
    FakeWorker.instances.push(this);
  }

  terminate(): void {
    /* nothing to release */
  }

  postMessage(req: DtlWorkerRequest): void {
    this.posted.push(req);
    if (FakeWorker.failNext) {
      FakeWorker.failNext = false;
      this.onerror?.(new Error('worker crashed'));
      return;
    }
    const r = solveDtl(req.species, req.gene, req.costs, req.tipOverride, req.options);
    queueMicrotask(() => {
      this.onmessage?.({ data: { id: req.id, ...r } } as MessageEvent<DtlWorkerResponse>);
    });
  }
}

const species = parseNewick('((A,B),(C,D));', 'species');
const gene = parseNewick('((A,B),(C,D));', 'gene');

beforeEach(() => {
  vi.resetModules();
  FakeWorker.instances.length = 0;
  FakeWorker.failNext = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dtlAsync worker protocol', () => {
  it('posts the solve to one reused Worker and resolves with its response', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { solveDtlAsync } = await import('./dtlAsync');

    const first = await solveDtlAsync(species, gene, COSTS);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted[0]?.kind).toBe('solve');
    expect(first.error).toBeUndefined();
    expect(first.scenario?.cost).toBe(solveDtl(species, gene, COSTS).scenario?.cost);

    // A second solve reuses the worker instead of spawning another one.
    const second = await solveDtlAsync(species, gene, COSTS);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted).toHaveLength(2);
    expect(second.scenario?.placements).toEqual(first.scenario?.placements);
  });

  it('falls back to the synchronous solver when the worker errors', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    FakeWorker.failNext = true;
    const { solveDtlAsync } = await import('./dtlAsync');

    const result = await solveDtlAsync(species, gene, COSTS);
    expect(warn).toHaveBeenCalled();
    expect(FakeWorker.instances[0].posted).toHaveLength(1);
    expect(result.scenario?.cost).toBe(solveDtl(species, gene, COSTS).scenario?.cost);
  });
});
