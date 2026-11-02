// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { LS_NAV_MODULE, readNavModule } from './navModule';

describe('standard workspace module restoration', () => {
  beforeEach(() => localStorage.clear());

  it('does not restore recon, so leaving the reconciliation workspace stays in the standard one', () => {
    localStorage.setItem(LS_NAV_MODULE, 'recon');
    expect(readNavModule()).toBe('traits');
  });

  it('restores ordinary standard modules', () => {
    for (const module of ['traits', 'layers', 'time', 'style', 'analysis', 'export'] as const) {
      localStorage.setItem(LS_NAV_MODULE, module);
      expect(readNavModule()).toBe(module);
    }
  });

  it('keeps the legacy hypothesis alias and falls back for unknown values', () => {
    localStorage.setItem(LS_NAV_MODULE, 'hypothesis');
    expect(readNavModule()).toBe('layers');
    localStorage.setItem(LS_NAV_MODULE, 'unknown');
    expect(readNavModule()).toBe('traits');
  });
});
