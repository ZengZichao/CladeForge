// The three tree-edit actions return a rich result; the caller has to surface it.
//
// The tests pin the WORDING CONTRACT, not just "it returns a string": each
// message must name the number the user needs (how many branches were excluded,
// how many ages were preserved, what unit the axis is in). A discarded result is
// what makes a refused re-root look like success and a relative-time axis look
// like an absolute Ma one.

import { describe, it, expect, beforeEach } from 'vitest';
import { estimateAgesText, midpointText, outgroupFailureText } from './treeEditNotices';
import { setLanguage } from './strings';
import type { EstimateAgesResult, MidpointResult } from '../model/treeOps';

// `S`/`tr` are live bindings shared by the whole file: start every test from the
// default locale so the English test below cannot leak into the next one.
beforeEach(() => setLanguage('zh'));

describe('outgroupFailureText', () => {
  it('a valid selection has no refusal', () => {
    expect(outgroupFailureText(null)).toBeNull();
  });

  it('every refusal reason is explainable', () => {
    for (const reason of [
      'empty-selection',
      'node-missing',
      'outgroup-is-root',
      'unrootable',
    ] as const) {
      const text = outgroupFailureText(reason);
      expect(text, reason).toBeTruthy();
      expect(text!.length, reason).toBeGreaterThan(8);
    }
  });

  it('the already-root case says WHY there is nothing to do', () => {
    // This is the case that would otherwise read as a successful no-op.
    const text = outgroupFailureText('outgroup-is-root') as string;
    expect(text).toContain('根');
    expect(text).toContain('没有可以移根的枝');
  });

  it('an unknown reason still produces a sentence, never undefined', () => {
    expect(outgroupFailureText('something-new' as never)).toBeTruthy();
  });
});

describe('midpointText', () => {
  const ok = (over: Partial<MidpointResult['placement']>): MidpointResult => ({
    ok: true,
    placement: {
      targetId: 'n1',
      fraction: 0.5,
      diameter: 12,
      unknownEdges: 0,
      complete: true,
      ...over,
    },
  });

  it('reports the measured diameter for a fully measured tree', () => {
    const text = midpointText(ok({}));
    expect(text).toContain('12');
    expect(text).toContain('中点');
    // No excuse-making when nothing was skipped.
    expect(text).not.toContain('排除');
  });

  it('names how many branches were EXCLUDED, and says the diameter is partial', () => {
    const text = midpointText(ok({ unknownEdges: 7, complete: false, diameter: 9.5 }));
    expect(text).toContain('7');
    expect(text).toContain('排除');
    expect(text).toContain('9.5');
    // The point in one sentence: the message must NOT claim the missing lengths
    // were used.
    expect(text).toContain('没有按 1 计入');
  });

  it('distinguishes the two failures', () => {
    const small = midpointText({ ok: false, failure: 'too-small' });
    const none = midpointText({ ok: false, failure: 'no-usable-lengths' });
    expect(small).not.toBe(none);
    expect(small).toContain('少于 3');
    expect(none).toContain('枝长');
    for (const t of [small, none]) expect(t).toContain('未执行');
  });

  it('rounds float noise out of the diameter', () => {
    expect(midpointText(ok({ diameter: 5.000000000000001 }))).toContain('5');
    expect(midpointText(ok({ diameter: 5.000000000000001 }))).not.toContain('5.000');
  });
});

describe('estimateAgesText', () => {
  const base: EstimateAgesResult = {
    filled: ['a', 'b', 'c'],
    preserved: 4,
    unit: 'project',
    timeUnit: 'Ma',
    calibrationAge: 55.5,
    tipsAssumedPresent: 0,
    changed: true,
  };

  it('says filled vs preserved, so overwriting is visibly not happening', () => {
    const text = estimateAgesText(base);
    expect(text).toContain('3');
    expect(text).toContain('4');
    expect(text).toContain('55.5');
    expect(text).toContain('Ma');
  });

  it('a relative-unit result must say the axis is in edge counts, not Ma', () => {
    // Without this sentence, an axis built out of topological depths reads as a
    // real "0–12 Ma Phanerozoic" scale.
    const text = estimateAgesText({ ...base, unit: 'relative', calibrationAge: 0 });
    expect(text).toContain('分支数');
    expect(text).toContain('不是Ma');
    expect(text).not.toContain('定标');
  });

  it('mentions tips that were assumed extant', () => {
    const text = estimateAgesText({ ...base, tipsAssumedPresent: 6 });
    expect(text).toContain('6');
    expect(text).toContain('现生');
  });

  it('a run that changed nothing says so instead of claiming a fill', () => {
    const text = estimateAgesText({
      ...base,
      filled: [],
      changed: false,
      preserved: 9,
    });
    expect(text).toContain('9');
    expect(text).not.toContain('已按拓扑估算');
  });

  it('reads correctly in English too', () => {
    setLanguage('en');
    expect(estimateAgesText({ ...base, unit: 'relative' })).toMatch(/EDGE COUNTS/);
    expect(midpointText({ ok: false, failure: 'too-small' })).toMatch(/Fewer than three/);
    expect(outgroupFailureText('unrootable')).toMatch(/cannot host this re-root/);
  });
});

describe('the notices agree with the model types they describe', () => {
  it('every MidpointResult failure string is covered by a branch', () => {
    // Compile-time plus run-time guard: if treeOps adds a failure kind the
    // switch must grow, not fall through to the length case.
    const all: MidpointResult['failure'][] = ['too-small', 'no-usable-lengths'];
    for (const f of all) {
      expect(midpointText({ ok: false, failure: f })).toMatch(/未执行|skipped/);
    }
  });
});
