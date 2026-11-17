// The two same-named NEXUS menu entries must produce the SAME file. If a caller
// hands `actionExportNexus` the React click event, every include-flag reads
// `undefined` and the menu silently writes a TAXA + TREES-only document under the
// identical filename and success toast as the dialog. These tests capture what each
// entry point actually saves.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved: { name: string; content: string }[] = [];

// Hoisted so the module mocks below and the tests share the same spies.
const mocks = vi.hoisted(() => ({
  openText: vi.fn(async (): Promise<{ name: string; text: string } | null> => null),
  pushRecent: vi.fn(),
  readClipboardText: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock('./fileService', () => ({
  isTauri: () => false,
  openText: mocks.openText,
  saveBinary: vi.fn(async () => true),
  saveText: vi.fn(async (name: string, content: string) => {
    saved.push({ name, content });
    return true;
  }),
}));

// pushRecent is spied so the clipboard/recent contract can be asserted without
// a DOM localStorage; clipboardIO is stubbed for the paste action.
vi.mock('./recent', () => ({ pushRecent: mocks.pushRecent }));
vi.mock('./clipboardIO', () => ({
  readClipboardText: mocks.readClipboardText,
  clipboardUnavailableMessage: () => 'clipboard unavailable',
}));

import {
  actionExportNexus,
  isNexusOptions,
  formatExportSize,
  actionImportTable,
  actionImportTree,
  actionPasteTreeFromClipboard,
} from './fileActions';
import { DEFAULT_NEXUS_OPTIONS, type NexusExportOptions } from './nexus';
import { useStore } from '../model/store';
import { createSampleProject } from '../model/sampleTree';
import { parseNewick } from './newick';
import { useToasts } from '../ui/toast';

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

// --- F-ISSUE-08: one size format for every export ------------------------------

describe('formatExportSize', () => {
  it('never reports 0 KB for a non-empty file and switches to MB', () => {
    expect(formatExportSize(0)).toBe('<1 KB');
    expect(formatExportSize(1)).toBe('<1 KB');
    expect(formatExportSize(1023)).toBe('<1 KB');
    expect(formatExportSize(1024)).toBe('1 KB');
    expect(formatExportSize(2048)).toBe('2 KB');
    expect(formatExportSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatExportSize(Math.round(1.2 * 1024 * 1024))).toBe('1.2 MB');
  });
});

// --- D-P8 / E-P11: table header guard and clipboard recents -------------------

describe('import guards', () => {
  beforeEach(() => {
    useToasts.getState().toasts.forEach((t) => useToasts.getState().dismiss(t.id));
    mocks.pushRecent.mockClear();
    mocks.openText.mockResolvedValue(null);
    mocks.readClipboardText.mockResolvedValue(null);
  });

  it("warns when a headerless table's first row is really a tip label (matrix)", async () => {
    useStore.getState().openInNewTab(parseNewick('(A,B);'));
    mocks.openText.mockResolvedValue({ name: 'traits.csv', text: 'A,trait\nB,1\n' });
    await actionImportTable('matrix');
    const messages = useToasts.getState().toasts.map((t) => t.message);
    expect(messages.some((m) => m.includes('header') || m.includes('表头'))).toBe(true);
  });

  it('warns for the annotations mode too', async () => {
    useStore.getState().openInNewTab(parseNewick('(A,B);'));
    mocks.openText.mockResolvedValue({ name: 'notes.csv', text: 'A,host\nB,human\n' });
    await actionImportTable('annotations');
    const messages = useToasts.getState().toasts.map((t) => t.message);
    expect(messages.some((m) => m.includes('header') || m.includes('表头'))).toBe(true);
  });

  it('does not warn when the first row is a real header', async () => {
    useStore.getState().openInNewTab(parseNewick('(A,B);'));
    mocks.openText.mockResolvedValue({ name: 'traits.csv', text: 'taxon,trait\nA,0\nB,1\n' });
    await actionImportTable('matrix');
    const messages = useToasts.getState().toasts.map((t) => t.message);
    expect(messages.some((m) => m.includes('header') || m.includes('表头'))).toBe(false);
  });

  it('does not record a clipboard paste in 最近, but does record a file import', async () => {
    mocks.readClipboardText.mockResolvedValue('(A,B);');
    await actionPasteTreeFromClipboard();
    expect(mocks.pushRecent).not.toHaveBeenCalled();

    mocks.openText.mockResolvedValue({ name: 'tree.nwk', text: '(A,B);' });
    await actionImportTree();
    expect(mocks.pushRecent).toHaveBeenCalledTimes(1);
  });
});
