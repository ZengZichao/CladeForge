// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// BUG-5 review: the Time module was reported to print an empty layout name
// (「current layout is “”」). Browser re-verification of the four valid layouts
// found correct, non-empty names; what remains is a defensive contract, because
// a document can be loaded with a blank or unknown `layout.type` (projectIO
// backfills `{ ...DEFAULT_LAYOUT, ...raw.layout }`, so a hand-edited
// `"type": ""` survives) and the message quotes whatever the helper returns.
//
// These tests pin the contract: known ids → localised catalogue name, unknown
// ids → echoed verbatim (trimmed), blank/absent ids → an explicit label. Never ''.

import { describe, it, expect, beforeEach } from 'vitest';
import { isKnownLayoutType, layoutTypeName } from './layoutTypeName';
import { setLanguage, S, tr } from './strings';

// `S` is a live module binding; reset the locale so the EN case cannot leak.
beforeEach(() => setLanguage('zh'));

describe('layoutTypeName — the quoted layout name is never an empty string', () => {
  it('maps each of the four valid ids to its localised catalogue name', () => {
    expect(layoutTypeName('rectangular-cladogram')).toBe(S.layoutType.cladogram);
    expect(layoutTypeName('rectangular-phylogram')).toBe(S.layoutType.phylogram);
    expect(layoutTypeName('time-calibrated')).toBe(S.layoutType.timeCalibrated);
    expect(layoutTypeName('circular')).toBe(S.layoutType.circular);
    for (const id of [
      'rectangular-cladogram',
      'rectangular-phylogram',
      'time-calibrated',
      'circular',
    ] as const) {
      expect(layoutTypeName(id).length, id).toBeGreaterThan(0);
    }
  });

  it('is locale-aware (the message follows the UI language)', () => {
    setLanguage('en');
    expect(layoutTypeName('rectangular-cladogram')).toBe(S.layoutType.cladogram);
    expect(layoutTypeName('rectangular-cladogram')).toContain('Rectangular');
    expect(layoutTypeName('circular')).toBe('Circular');
    setLanguage('zh');
    expect(layoutTypeName('circular')).toBe('环形图');
  });

  it('echoes an unknown / legacy id instead of blanking it', () => {
    // A future or older build's id is still informative to the user — and
    // infinitely better than “”.
    expect(layoutTypeName('timechart')).toBe('timechart');
    expect(layoutTypeName('geological-time-chart')).toBe('geological-time-chart');
    expect(layoutTypeName('  circular-v2  ')).toBe('circular-v2');
  });

  it('names a blank / missing id explicitly, never as “”', () => {
    const expected = tr('未知布局', 'Unknown layout');
    for (const blank of ['', '   ', null, undefined]) {
      const name = layoutTypeName(blank);
      expect(name, JSON.stringify(blank)).toBe(expected);
      expect(name.trim().length, JSON.stringify(blank)).toBeGreaterThan(0);
    }
  });

  it('the production string template never renders a pair of empty quotes', () => {
    for (const weird of ['', '   ', null, undefined, 'timechart'] as const) {
      const message = S.layoutPanel.timeDataButWrongLayout(layoutTypeName(weird));
      expect(message).not.toContain('“”');
      expect(message).not.toContain('""');
    }
  });

  it('isKnownLayoutType accepts only the four ids', () => {
    for (const id of [
      'rectangular-cladogram',
      'rectangular-phylogram',
      'time-calibrated',
      'circular',
    ] as const) {
      expect(isKnownLayoutType(id), id).toBe(true);
    }
    for (const other of ['', 'timechart', null, undefined, 42, {}, []]) {
      expect(isKnownLayoutType(other), JSON.stringify(other)).toBe(false);
    }
  });
});
