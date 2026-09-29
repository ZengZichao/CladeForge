// The two same-named NEXUS menu entries must produce the SAME file. If a caller
// hands `actionExportNexus` the React click event, every include-flag reads
// `undefined` and the menu silently writes a TAXA + TREES-only document under the
// identical filename and success toast as the dialog. These tests capture what each
// entry point actually saves.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved: { name: string; content: string }[] = [];

vi.mock('./fileService', () => ({
  isTauri: () => false,
  openText: vi.fn(async () => null),
  saveBinary: vi.fn(async () => true),
  saveText: vi.fn(async (name: string, content: string) => {
    saved.push({ name, content });
    return true;
  }),
}));

import { actionExportNexus, isNexusOptions } from './fileActions';
import { DEFAULT_NEXUS_OPTIONS, type NexusExportOptions } from './nexus';
import { useStore } from '../model/store';
import { createSampleProject } from '../model/sampleTree';

/** Top-level block names a NEXUS reader will see, in order. */
function blocks(text: string): string[] {
  const names = [...text.matchAll(/^BEGIN\s+([A-Za-z]+);/gim)].map((m) => m[1].toUpperCase());
  return ['#NEXUS', ...names];
}

/** The extra blocks the dialog can add — absent from the minimal document. */
const OPTIONAL_BLOCKS = ['CHARACTERS', 'ASSUMPTIONS', 'MRBAYES', 'BEAST'];

/** A React `MouseEvent` shaped like the real synthetic event. */
const clickEvent = {
  type: 'click',
  target: {},
  currentTarget: {},
  eventPhase: 0,
  bubbles: true,
  cancelable: true,
  defaultPrevented: false,
  isTrusted: false,
  nativeEvent: new Event('click'),
  preventDefault: () => undefined,
  stopPropagation: () => undefined,
  persist: () => undefined,
} as unknown as NexusExportOptions;

async function contentAfter(run: () => Promise<void>): Promise<{ name: string; content: string }> {
  saved.length = 0;
  await run();
  expect(saved).toHaveLength(1);
  return saved[0];
}

describe('actionExportNexus — one file per name, whatever the entry point', () => {
  beforeEach(() => {
    saved.length = 0;
    useStore.getState().openInNewTab(createSampleProject());
  });

  it('the menu path (no arguments) exports the same blocks as the dialog defaults', async () => {
    // `fileMenu.ts` wires the menu item as `onClick: () => actionExportNexus()`.
    const menu = await contentAfter(() => actionExportNexus());
    // `NexusExportDialog` exports its untouched checkbox state, which IS
    // DEFAULT_NEXUS_OPTIONS.
    const dialog = await contentAfter(() => actionExportNexus({ ...DEFAULT_NEXUS_OPTIONS }));
    expect(blocks(menu.content)).toEqual(blocks(dialog.content));
    expect(menu.content).toBe(dialog.content);
    expect(menu.name).toBe(dialog.name);
    // Sanity: the shared default really is the minimal document.
    expect(blocks(menu.content)).toEqual(['#NEXUS', 'TAXA', 'TREES']);
  });

  it('a click event is rejected as an options bag, a real one is not', async () => {
    // The guard, pinned directly: this is what keeps a mis-wired `onClick`
    // handler from turning a synthetic event into "all flags undefined".
    expect(isNexusOptions(clickEvent)).toBe(false);
    expect(isNexusOptions(undefined)).toBe(false);
    expect(isNexusOptions({})).toBe(false);
    expect(isNexusOptions({ includeCharacters: true })).toBe(true);
    expect(
      isNexusOptions({
        includeCharacters: false,
        includeHypothesis: false,
        includeMrBayes: false,
        includeBeast: false,
      }),
    ).toBe(true);

    const clean = await contentAfter(() => actionExportNexus());
    const dirty = await contentAfter(() => actionExportNexus(clickEvent));
    expect(dirty.content).toBe(clean.content);
    expect(dirty.name).toBe(clean.name);
  });

  it('the dialog can still ADD blocks, so "same default" is not "always minimal"', async () => {
    const minimal = await contentAfter(() => actionExportNexus());
    const full = await contentAfter(() =>
      actionExportNexus({
        includeCharacters: true,
        includeHypothesis: true,
        includeMrBayes: true,
        includeBeast: true,
      }),
    );
    for (const b of OPTIONAL_BLOCKS) {
      expect(blocks(minimal.content)).not.toContain(b);
    }
    // The sample document carries a character matrix, so every block is emitted.
    expect(blocks(full.content)).toEqual([
      '#NEXUS',
      'TAXA',
      'TREES',
      'CHARACTERS',
      'CHARACTERS',
      'ASSUMPTIONS',
      'MRBAYES',
      'BEAST',
    ]);
    expect(full.content).toContain('STATELABELS');
    expect(full.content.length).toBeGreaterThan(minimal.content.length);
  });
});
