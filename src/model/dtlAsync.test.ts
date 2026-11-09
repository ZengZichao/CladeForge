// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The async DTL API must be behaviour-preserving when no Worker exists (vitest,
// SSR, restricted webviews): the fallback runs the same pure solver in-process
// and still reports solver errors in the result instead of rejecting.

import { describe, expect, it } from 'vitest';
import { parseNewick } from '../io/newick';
import { solveDtl } from './dtl';
import { solveDtlAsync, solveDtlWithPolytomiesAsync } from './dtlAsync';

const COSTS = { dup: 1, transfer: 2, loss: 1 };

describe('dtlAsync (synchronous fallback in this environment)', () => {
  it('resolves the same optimum as the synchronous solver', async () => {
    const species = parseNewick('((A,B),(C,D));', 'species');
    const gene = parseNewick('((A,B),(C,D));', 'gene');
    const sync = solveDtl(species, gene, COSTS);
    const asyncResult = await solveDtlAsync(species, gene, COSTS);
    expect(asyncResult.error).toBeUndefined();
    expect(asyncResult.scenario?.cost).toBe(sync.scenario?.cost);
    expect(asyncResult.scenario?.placements).toEqual(sync.scenario?.placements);
    expect(asyncResult.scenario?.totalLosses).toBe(sync.scenario?.totalLosses);
  });

  it('never rejects: solver errors ride in result.error', async () => {
    const species = parseNewick('((A,B),(C,D));', 'species');
    const polytomicGene = parseNewick('(A,B,C);', 'gene');
    const result = await solveDtlAsync(species, polytomicGene, COSTS);
    expect(result.scenario).toBeUndefined();
    expect(result.error).toMatch(/polytom|多歧/);
  });

  it('the polytomy sweep reports the replicate spread', async () => {
    const species = parseNewick('((A,B),(C,D));', 'species');
    const polytomicGene = parseNewick('(A,B,C);', 'gene');
    const result = await solveDtlWithPolytomiesAsync(species, polytomicGene, COSTS, undefined, {}, 4);
    expect(result.error).toBeUndefined();
    expect(result.scenario).toBeDefined();
    expect(result.polytomySummary?.replicates).toBeGreaterThan(0);
  });
});
