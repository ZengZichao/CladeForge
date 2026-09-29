// The matrix cell editor must not offer `?` / `-` as values.
//
// A recorded missing code is DATA (the model goes out of its way to exclude it
// from CI/RI and from transition counts, and the narrative prints it as
// "missing"), whereas an unassigned cell holds no claim at all. Offering both is
// a trap: the two look identical in the editor and are not identical downstream.

import { describe, it, expect } from 'vitest';
import { matrixCellOptions, matrixCellSwatch, matrixCellWrite, UNASSIGNED } from './matrixCell';

const states = [
  { id: 's0', label: 'terrestrial', color: '#111' },
  { id: 's1', label: 'aquatic', color: '#222' },
];

const text = {
  unassigned: '(unset)',
  missingData: 'Missing (?)',
  notApplicable: 'Not applicable (-)',
  staleValue: (id: string) => `stale value ${id}`,
};

const selectable = (value: unknown) =>
  matrixCellOptions(states, value, text).filter((o) => !o.disabled).map((o) => o.value);

describe('matrixCellWrite — a cell stores a declared state or nothing', () => {
  it('the unassigned entry clears the cell', () => {
    expect(matrixCellWrite(states, UNASSIGNED)).toBeUndefined();
  });

  it('a declared state id is written through', () => {
    expect(matrixCellWrite(states, 's0')).toBe('s0');
    expect(matrixCellWrite(states, 's1')).toBe('s1');
  });

  // Exactly the values the dropdown must never be able to write.
  it('the missing-data codes can never be written', () => {
    expect(matrixCellWrite(states, '?')).toBeUndefined();
    expect(matrixCellWrite(states, '-')).toBeUndefined();
    expect(matrixCellWrite(states, 'deleted_state_id')).toBeUndefined();
  });
});

describe('matrixCellOptions — the dropdown contents', () => {
  it('offers unassigned plus the declared states, and no ? / - rows', () => {
    expect(selectable(undefined)).toEqual(['', 's0', 's1']);
    expect(selectable('s1')).toEqual(['', 's0', 's1']);
    const labels = matrixCellOptions(states, undefined, text).map((o) => o.label);
    expect(labels).not.toContain(text.missingData);
    expect(labels).not.toContain(text.notApplicable);
  });

  it('shows a stored ? as a DISABLED read-out instead of rewriting it', () => {
    const opts = matrixCellOptions(states, '?', text);
    const frozen = opts.filter((o) => o.disabled);
    expect(frozen).toEqual([{ value: '?', label: text.missingData, disabled: true }]);
    // Still no way to put it back: the selectable set is unchanged.
    expect(selectable('?')).toEqual(['', 's0', 's1']);
  });

  it('shows a stored - as the not-applicable read-out', () => {
    const opts = matrixCellOptions(states, '-', text);
    expect(opts[opts.length - 1]).toEqual({
      value: '-',
      label: text.notApplicable,
      disabled: true,
    });
  });

  it('names a stale state id rather than pretending the cell is empty', () => {
    const opts = matrixCellOptions(states, 'gone', text);
    expect(opts[opts.length - 1]).toEqual({
      value: 'gone',
      label: text.staleValue('gone'),
      disabled: true,
    });
  });

  it('a numeric or absent value adds no read-out row', () => {
    expect(matrixCellOptions(states, 3, text).some((o) => o.disabled)).toBe(false);
    expect(matrixCellOptions(states, '', text).some((o) => o.disabled)).toBe(false);
  });
});

describe('matrixCellSwatch — only a real state gets a colour', () => {
  it('paints declared states and nothing else', () => {
    expect(matrixCellSwatch(states, 's1')).toBe('#222');
    expect(matrixCellSwatch(states, '?')).toBeUndefined();
    expect(matrixCellSwatch(states, '-')).toBeUndefined();
    expect(matrixCellSwatch(states, 'gone')).toBeUndefined();
    expect(matrixCellSwatch(states, undefined)).toBeUndefined();
  });
});
