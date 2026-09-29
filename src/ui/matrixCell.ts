// The character matrix's per-cell dropdown, as pure functions.
//
// Extracted from `CharacterMatrixDialog.tsx` so the write rule is testable
// without rendering the dialog (the repository's test net covers `.ts` only —
// same reason `fileMenu.ts` and `reconStats.ts` exist).
//
// The cell editor never offers `?` and `-` as selectable VALUES. That would be a
// second, parallel way to record "no observation" next to the real one (leaving
// the cell unassigned), and the two are not equivalent: the model side already
// separates the two cases. `MISSING_STATE_CODES`
// (model/characters.ts:174) is excluded from every statistic by
// `isObservedState`, skipped by `consistency.ts` when scoring transitions, and
// printed by `hypothesisExport.ts` as a named missing code — so a `?`
// written from the matrix is *not* "unassigned", it is a recorded claim that the
// observation is missing, and it survives into exports while changing nothing
// about the analysis.
//
// The dropdown writes exactly two kinds of thing: a declared state id, or
// `undefined` (the "unassigned" entry, which clears the cell via
// `setNodeState` → `clearNodeCharacter`). Codes already present in a document
// — imported NEXUS with `?`, a hand-edited project JSON — stay VISIBLE as a
// disabled row so nothing is silently rewritten, but they cannot be
// (re-)selected: the only way out of them is a real state or an explicit clear.

import { MISSING_STATE_CODES } from '../model/characters';

/** The `value` of the "unassigned" option; it writes `undefined`. */
export const UNASSIGNED = '';

export interface MatrixCellOption {
  value: string;
  label: string;
  /** A frozen read-out the user cannot pick, listed after the real options. */
  disabled: boolean;
}

/**
 * What the cell stores when the user picks `selection`: a declared state id, or
 * `undefined` for unassigned. A value that is neither (a legacy `?` / `-`, a
 * stale state id from a deleted state, the disabled read-out itself) also
 * resolves to `undefined`, so no code path can write a non-declared string back
 * into `charStates`.
 */
export function matrixCellWrite(
  states: readonly { id: string }[],
  selection: string,
): string | undefined {
  if (selection === UNASSIGNED) return undefined;
  return states.some((s) => s.id === selection) ? selection : undefined;
}

/**
 * The options shown for one cell: the unassigned entry, then every declared
 * state, then — only when the cell currently holds something that is not a
 * declared state — a disabled row naming what is actually stored.
 */
export function matrixCellOptions(
  states: readonly { id: string; label: string }[],
  value: unknown,
  text: {
    unassigned: string;
    missingData: string;
    notApplicable: string;
    staleValue: (id: string) => string;
  },
): MatrixCellOption[] {
  const options: MatrixCellOption[] = [
    { value: UNASSIGNED, label: text.unassigned, disabled: false },
    ...states.map((s) => ({ value: s.id, label: s.label, disabled: false })),
  ];
  if (typeof value !== 'string' || value === UNASSIGNED) return options;
  if (states.some((s) => s.id === value)) return options;
  // `MISSING_STATE_CODES` is exactly '?' / '-', so the two named labels cover
  // every code; anything else is a stale id from a deleted state.
  const label =
    value === '?'
      ? text.missingData
      : value === '-'
        ? text.notApplicable
        : text.staleValue(value);
  options.push({ value, label, disabled: true });
  return options;
}

/**
 * The swatch fill: only a declared state has one. A missing-data code is not a
 * state and must not paint as one.
 */
export function matrixCellSwatch(
  states: readonly { id: string; color?: string }[],
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (MISSING_STATE_CODES.includes(value)) return undefined;
  return states.find((s) => s.id === value)?.color;
}
