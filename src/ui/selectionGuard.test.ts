// The "set as outgroup & reroot" menu item is gated on `selection.length > 1`, so
// a right-click handler that wipes the multi-selection before the menu opens
// leaves a complete, tested feature unreachable in the UI. The guard is one
// predicate; these tests pin it.

import { describe, it, expect } from 'vitest';
import { selectionForRightClick, shouldReselectOnRightClick } from './selectionGuard';

describe('shouldReselectOnRightClick', () => {
  it('keeps a multi-selection when the right-click lands inside it', () => {
    // The case that would make outgroup rooting unreachable: two ⌘-clicked tips,
    // then a right-click on one of them.
    expect(shouldReselectOnRightClick(['a', 'b', 'c'], 'b')).toBe(false);
    expect(selectionForRightClick(['a', 'b', 'c'], 'b')).toBeNull();
  });

  it('re-selects when the right-click lands outside the selection', () => {
    expect(shouldReselectOnRightClick(['a', 'b'], 'z')).toBe(true);
    expect(selectionForRightClick(['a', 'b'], 'z')).toEqual(['z']);
  });

  it('a lone selected node right-clicked on itself stays a lone selection', () => {
    expect(shouldReselectOnRightClick(['a'], 'a')).toBe(false);
  });

  it('an empty selection right-clicked on a node selects it', () => {
    expect(shouldReselectOnRightClick([], 'a')).toBe(true);
    expect(selectionForRightClick([], 'a')).toEqual(['a']);
  });

  it('right-clicking empty canvas changes nothing (the caller keeps the selection)', () => {
    expect(shouldReselectOnRightClick(['a', 'b'], null)).toBe(false);
    expect(selectionForRightClick(['a', 'b'], null)).toBeNull();
  });

  it('a duplicate id in the selection is still recognised', () => {
    expect(shouldReselectOnRightClick(['a', 'a', 'b'], 'a')).toBe(false);
  });
});
