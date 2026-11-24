// The two same-named NEXUS menu entries must produce the SAME file. If a caller
// hands `actionExportNexus` the React click event, every include-flag reads
// `undefined` and the menu silently writes a TAXA + TREES-only document under the
// identical filename and success toast as the dialog. These tests capture what each
// entry point actually saves.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const saved: { name: string; content: string }[] = [];

// Hoisted so the module mocks below and the tests share the same spies.
const mocks = vi.hoisted(() => ({
  native: false,
  openText: vi.fn(async (): Promise<{ name: string; text: string } | null> => null),
  pushRecent: vi.fn(),
  readClipboardText: vi.fn(async (): Promise<string | null> => null),
  saveTextWithResult: vi.fn(async (name: string, _content: string, _filters: unknown): Promise<{ ok: boolean; path?: string }> => ({ ok: true, path: `/tmp/${name}` })),
  writeTextFileNative: vi.fn(async (_path: string, _contents: string) => [] as string[]),
  statFileMtimeNative: vi.fn(async (_path: string) => 1),
}));

vi.mock('./fileService', () => ({
  isTauri: () => mocks.native,
  openText: mocks.openText,
  saveBinary: vi.fn(async () => true),
  saveText: vi.fn(async (_name: string, content: string) => {
    saved.push({ name: _name, content });
    return true;
  }),
  saveTextWithResult: mocks.saveTextWithResult,
}));

vi.mock('./native', () => ({
  readBinaryFileNative: vi.fn(),
  readTextFileNative: vi.fn(),
  statFileMtimeNative: mocks.statFileMtimeNative,
  writeTextFileNative: mocks.writeTextFileNative,
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
  actionSaveProject,
  actionSaveProjectAs,
  actionSaveAllProjects,
  actionRerootAtNode,
} from './fileActions';
import { DEFAULT_NEXUS_OPTIONS, type NexusExportOptions } from './nexus';
import { useStore } from '../model/store';
import { createSampleProject } from '../model/sampleTree';
import { parseNewick } from './newick';
import { useToasts } from '../ui/toast';
import { registerConfirmHandler, type ConfirmRequest } from '../ui/confirmDialog';

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

// --- BUG-004: Save all tabs must account for every modified document ----------

describe('actionSaveAllProjects', () => {
  let confirmRequests: ConfirmRequest[];
  let unregisterConfirm: (() => void) | undefined;

  beforeEach(() => {
    confirmRequests = [];
    unregisterConfirm = registerConfirmHandler((req) => confirmRequests.push(req));
    useToasts.getState().toasts.forEach((t) => useToasts.getState().dismiss(t.id));
    mocks.native = false;
    mocks.saveTextWithResult.mockReset();
    mocks.saveTextWithResult.mockImplementation(async () => ({ ok: true }));
    mocks.writeTextFileNative.mockReset();
    mocks.writeTextFileNative.mockResolvedValue([]);
    mocks.statFileMtimeNative.mockReset();
    mocks.statFileMtimeNative.mockResolvedValue(1);
    // Start from one clean tab, then create two independently modified tabs.
    useStore.getState().loadWorkspace([createSampleProject()], 0);
  });

  afterEach(() => {
    unregisterConfirm?.();
    unregisterConfirm = undefined;
  });

  function twoModifiedTabs(nativePaths = false, pathSuffix = ''): { activeId: string; inactiveId: string } {
    useStore.getState().openInNewTab(createSampleProject());
    const inactiveId = useStore.getState().activeTabId;
    useStore.getState().apply((d) => {
      d.name = 'Alpha edited';
      if (nativePaths) d.sourcePath = `/tmp/alpha${pathSuffix}.cladeforge.json`;
    });
    useStore.getState().openInNewTab(createSampleProject());
    const activeId = useStore.getState().activeTabId;
    useStore.getState().apply((d) => {
      d.name = 'Beta edited';
      if (nativePaths) d.sourcePath = `/tmp/beta${pathSuffix}.cladeforge.json`;
    });
    return { activeId, inactiveId };
  }

  function summary(): string {
    return useToasts.getState().toasts.map((t) => t.message).join('\n');
  }

  function expectTabSaved(id: string): void {
    const st = useStore.getState();
    if (id === st.activeTabId) {
      expect(st.revision).toBe(st.lastSavedRevision);
      expect(st.project.savedAt).toBeTruthy();
    } else {
      const snap = st.tabStore[id];
      expect(snap.revision).toBe(snap.lastSavedRevision);
      expect(snap.project.savedAt).toBeTruthy();
    }
  }

  it('guards concurrent Save All runs instead of duplicating download requests', async () => {
    twoModifiedTabs();
    const first = actionSaveAllProjects();
    const second = actionSaveAllProjects();
    expect(confirmRequests).toHaveLength(1);
    expect(summary()).toMatch(/in progress|进行中|正在保存/i);
    confirmRequests[0].onConfirm();
    await Promise.all([first, second]);
    expect(mocks.saveTextWithResult).toHaveBeenCalledTimes(2);
  });

  it('does not download or rewrite clean tabs', async () => {
    await actionSaveAllProjects();
    expect(mocks.saveTextWithResult).not.toHaveBeenCalled();
    expect(mocks.writeTextFileNative).not.toHaveBeenCalled();
    expect(confirmRequests).toHaveLength(0);
    expect(summary()).toMatch(/没有修改|no modified/i);
  });

  it('downloads both modified never-saved web tabs after explaining browser multi-downloads', async () => {
    const { inactiveId } = twoModifiedTabs();
    const pending = actionSaveAllProjects();

    // Nothing is discarded or downloaded before the user understands that the
    // browser will receive one download request per document.
    expect(confirmRequests).toHaveLength(1);
    expect(confirmRequests[0].message).toMatch(/2/);
    expect(confirmRequests[0].message).toMatch(/multiple|分别|每个/);
    expect(mocks.saveTextWithResult).not.toHaveBeenCalled();

    confirmRequests[0].onConfirm();
    await pending;

    expect(mocks.saveTextWithResult.mock.calls.map(([name]) => name)).toEqual([
      'Alpha edited.cladeforge.json',
      'Beta edited.cladeforge.json',
    ]);
    const documents = mocks.saveTextWithResult.mock.calls.map(([, content]) => JSON.parse(content));
    expect(documents.map((p) => p.project.name)).toEqual(['Alpha edited', 'Beta edited']);
    const st = useStore.getState();
    expect(st.tabStore[inactiveId].revision).not.toBe(st.tabStore[inactiveId].lastSavedRevision);
    expect(st.tabStore[inactiveId].project.savedAt).toBeUndefined();
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(st.project.savedAt).toBeUndefined();
    expect(summary()).toMatch(/触发下载 2|download triggered 2/);
    expect(summary()).not.toMatch(/从未保存过|never saved/);
    const downloadToasts = useToasts.getState().toasts.filter((toast) =>
      /Download requested|Download triggered|已请求下载|已触发下载/.test(toast.message),
    );
    expect(downloadToasts).toHaveLength(2);
    expect(downloadToasts.every((toast) => toast.kind === 'info')).toBe(true);
  });

  it('guards concurrent single-project saves against duplicate native writes', async () => {
    mocks.native = true;
    twoModifiedTabs(true);
    let finishWrite!: () => void;
    mocks.writeTextFileNative.mockImplementation(() => new Promise<string[]>((resolve) => {
      finishWrite = () => resolve([]);
    }));

    const first = actionSaveProject();
    await vi.waitFor(() => expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(1));
    expect(await actionSaveProject()).toBe('none');
    expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(1);
    finishWrite();
    expect(await first).toBe('in-place');
  });

  it('does not transfer a deferred native save to another active tab', async () => {
    mocks.native = true;
    const { activeId, inactiveId } = twoModifiedTabs(true);
    let finishWrite!: () => void;
    mocks.writeTextFileNative.mockImplementation(() => new Promise<string[]>((resolve) => {
      finishWrite = () => resolve([]);
    }));

    const pending = actionSaveProject();
    await vi.waitFor(() => expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(1));
    useStore.getState().switchTab(inactiveId);
    finishWrite();
    expect(await pending).toBe('in-place');

    const st = useStore.getState();
    const savedTab = st.tabStore[activeId];
    expect(savedTab.revision).toBe(savedTab.lastSavedRevision);
    expect(savedTab.project.savedAt).toBeTruthy();
    expect(savedTab.project.sourcePath).toBe('/tmp/beta.cladeforge.json');
    expect(st.project.name).toBe('Alpha edited');
    expect(st.project.sourcePath).toBe('/tmp/alpha.cladeforge.json');
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(st.project.savedAt).toBeUndefined();
    expect(summary()).not.toMatch(/stale|changed|已变化|已修改/i);
  });

  it('does not recreate or stamp a tab closed during a native save', async () => {
    mocks.native = true;
    const { activeId, inactiveId } = twoModifiedTabs(true);
    let finishWrite!: () => void;
    mocks.writeTextFileNative.mockImplementation(() => new Promise<string[]>((resolve) => {
      finishWrite = () => resolve([]);
    }));

    const pending = actionSaveProject();
    await vi.waitFor(() => expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(1));
    useStore.getState().closeTab(activeId);
    finishWrite();
    expect(await pending).toBe('stale');

    const st = useStore.getState();
    expect(st.tabs).not.toContain(activeId);
    expect(st.tabStore[activeId]).toBeUndefined();
    expect(st.activeTabId).toBe(inactiveId);
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(st.project.savedAt).toBeUndefined();
    expect(summary()).toMatch(/stale|changed|已变化|已修改/i);
  });

  it('keeps edits made during a native save dirty and reports the stale completion', async () => {
    mocks.native = true;
    const { activeId } = twoModifiedTabs(true);
    let finishWrite!: () => void;
    mocks.writeTextFileNative.mockImplementation(() => new Promise<string[]>((resolve) => {
      finishWrite = () => resolve([]);
    }));

    const pending = actionSaveProject();
    await vi.waitFor(() => expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(1));
    useStore.getState().apply((d) => { d.name = 'Beta edited again'; });
    const written = mocks.writeTextFileNative.mock.calls[0][1];
    finishWrite();
    expect(await pending).toBe('stale');

    const st = useStore.getState();
    expect(st.activeTabId).toBe(activeId);
    expect(st.project.name).toBe('Beta edited again');
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(st.project.savedAt).toBeUndefined();
    expect(JSON.parse(written).project.name).toBe('Beta edited');
    expect(summary()).toMatch(/stale|changed|已变化|已修改/i);
    expect(summary()).not.toMatch(/Saved to|已保存到/i);
  });

  function expectBrowserDownloadRequestToast(): void {
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({
        kind: 'info',
        message: expect.stringMatching(
          /^(Download requested for Beta edited\.cladeforge\.json; document remains unsaved|已请求下载 Beta edited\.cladeforge\.json；文档仍标记为未保存)$/,
        ),
      }),
    ]);
  }

  it.each(['accepted', 'silently blocked'])(
    'reports browser Save as an informational request when dispatch is %s',
    async () => {
      const { activeId } = twoModifiedTabs();
      // A browser returns the same dispatch-only result whether it accepts the
      // download or silently blocks it; neither outcome proves a disk write.
      mocks.saveTextWithResult.mockResolvedValue({ ok: true });
      expect(await actionSaveProject()).toBe('downloaded');

      const st = useStore.getState();
      expect(st.activeTabId).toBe(activeId);
      expect(st.revision).not.toBe(st.lastSavedRevision);
      expect(st.project.savedAt).toBeUndefined();
      expect(st.project.sourcePath).toBeUndefined();
      expectBrowserDownloadRequestToast();
    },
  );

  it('does not adopt a Save As path when the originating revision changes before completion', async () => {
    mocks.native = true;
    twoModifiedTabs();
    let finishSave!: (value: { ok: boolean; path: string }) => void;
    mocks.saveTextWithResult.mockImplementation(() => new Promise((resolve) => {
      finishSave = resolve;
    }));

    const pending = actionSaveProjectAs();
    await vi.waitFor(() => expect(mocks.saveTextWithResult).toHaveBeenCalledTimes(1));
    useStore.getState().apply((d) => { d.name = 'Beta changed before Save As completed'; });
    finishSave({ ok: true, path: '/tmp/stale-choice.cladeforge.json' });
    await pending;

    const st = useStore.getState();
    expect(st.project.name).toBe('Beta changed before Save As completed');
    expect(st.project.sourcePath).toBeUndefined();
    expect(st.project.savedAt).toBeUndefined();
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(summary()).toMatch(/stale|changed|已变化|已修改/i);
    expect(summary()).not.toMatch(/Saved as|已另存为/i);
  });

  it.each(['accepted', 'silently blocked'])(
    'reports browser Save As as an informational request when dispatch is %s',
    async () => {
      twoModifiedTabs();
      // Even a path-shaped mock result is not persistence evidence in a browser.
      mocks.saveTextWithResult.mockResolvedValue({ ok: true, path: '/not/a/browser/path.json' });
      await actionSaveProjectAs();

      const st = useStore.getState();
      expect(st.revision).not.toBe(st.lastSavedRevision);
      expect(st.project.savedAt).toBeUndefined();
      expect(st.project.sourcePath).toBeUndefined();
      expectBrowserDownloadRequestToast();
    },
  );

  it('does not adopt a deferred Save As path or clean flag on another tab', async () => {
    mocks.native = true;
    const { activeId, inactiveId } = twoModifiedTabs(true);
    let finishSave!: (value: { ok: boolean; path: string }) => void;
    mocks.saveTextWithResult.mockImplementation(() => new Promise((resolve) => {
      finishSave = resolve;
    }));

    const pending = actionSaveProjectAs();
    await vi.waitFor(() => expect(mocks.saveTextWithResult).toHaveBeenCalledTimes(1));
    useStore.getState().switchTab(inactiveId);
    finishSave({ ok: true, path: '/tmp/chosen.cladeforge.json' });
    await pending;

    const st = useStore.getState();
    const savedTab = st.tabStore[activeId];
    expect(savedTab.revision).toBe(savedTab.lastSavedRevision);
    expect(savedTab.project.sourcePath).toBe('/tmp/chosen.cladeforge.json');
    expect(savedTab.project.savedAt).toBeTruthy();
    expect(st.project.sourcePath).toBe('/tmp/alpha.cladeforge.json');
    expect(st.project.savedAt).toBeUndefined();
    expect(st.revision).not.toBe(st.lastSavedRevision);
  });

  it('does not write or mark any tab saved when the web pre-action confirmation is canceled', async () => {
    const { inactiveId } = twoModifiedTabs();
    const before = [useStore.getState().project.savedAt, useStore.getState().tabStore[inactiveId].project.savedAt];
    const pending = actionSaveAllProjects();
    expect(confirmRequests).toHaveLength(1);
    confirmRequests[0].onCancel?.();
    await pending;

    expect(mocks.saveTextWithResult).not.toHaveBeenCalled();
    expect([useStore.getState().project.savedAt, useStore.getState().tabStore[inactiveId].project.savedAt]).toEqual(before);
    const st = useStore.getState();
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(st.tabStore[inactiveId].revision).not.toBe(st.tabStore[inactiveId].lastSavedRevision);
    expect(summary()).toMatch(/取消|canceled/i);
  });

  it('keeps a web tab dirty when its download trigger is canceled and reports it truthfully', async () => {
    const { inactiveId } = twoModifiedTabs();
    mocks.saveTextWithResult.mockImplementation(async (name) => ({ ok: !name.startsWith('Alpha') }));
    const pending = actionSaveAllProjects();
    confirmRequests[0].onConfirm();
    await pending;

    const st = useStore.getState();
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(st.project.savedAt).toBeUndefined();
    expect(st.tabStore[inactiveId].revision).not.toBe(st.tabStore[inactiveId].lastSavedRevision);
    expect(summary()).toMatch(/触发下载 1|download triggered 1/);
    expect(summary()).toMatch(/取消 1|canceled 1/);
    expect(summary()).not.toMatch(/从未保存过|never saved/);
  });

  it('downloads only modified web tabs, including a background tab behind a clean active tab', async () => {
    const { inactiveId } = twoModifiedTabs();
    useStore.getState().undo();
    const pending = actionSaveAllProjects();
    confirmRequests[0].onConfirm();
    await pending;

    expect(mocks.saveTextWithResult).toHaveBeenCalledTimes(1);
    expect(mocks.saveTextWithResult.mock.calls[0][0]).toBe('Alpha edited.cladeforge.json');
    const snap = useStore.getState().tabStore[inactiveId];
    expect(snap.revision).not.toBe(snap.lastSavedRevision);
    expect(snap.project.savedAt).toBeUndefined();
    expect(summary()).toMatch(/触发下载 1|download triggered 1/);
  });

  it('writes every modified native tab in place, refreshes mtimes and restores the active tab', async () => {
    mocks.native = true;
    const { activeId, inactiveId } = twoModifiedTabs(true);
    await actionSaveAllProjects();

    expect(mocks.writeTextFileNative.mock.calls.map(([path]) => path)).toEqual([
      '/tmp/alpha.cladeforge.json',
      '/tmp/beta.cladeforge.json',
    ]);
    expect(mocks.statFileMtimeNative).toHaveBeenCalledWith('/tmp/alpha.cladeforge.json');
    expect(mocks.statFileMtimeNative).toHaveBeenCalledWith('/tmp/beta.cladeforge.json');
    expectTabSaved(activeId);
    expectTabSaved(inactiveId);
    expect(useStore.getState().activeTabId).toBe(activeId);
    expect(summary()).toMatch(/写入磁盘 2|written in place 2/);
    expect(summary()).not.toMatch(/从未保存过|never saved/);
  });

  it('reports a stale native Save All write without cleaning an edited background tab', async () => {
    mocks.native = true;
    const { activeId, inactiveId } = twoModifiedTabs(true);
    let finishWrite!: () => void;
    mocks.writeTextFileNative.mockImplementationOnce(() => new Promise<string[]>((resolve) => {
      finishWrite = () => resolve([]);
    }));

    const pending = actionSaveAllProjects();
    await vi.waitFor(() => expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(1));
    useStore.getState().apply((d) => { d.name = 'Alpha edited again'; });
    finishWrite();
    await pending;

    const st = useStore.getState();
    const snap = st.tabStore[inactiveId];
    expect(snap.project.name).toBe('Alpha edited again');
    expect(snap.revision).not.toBe(snap.lastSavedRevision);
    expect(snap.project.savedAt).toBeUndefined();
    expect(st.activeTabId).toBe(activeId);
    expect(summary()).toMatch(/stale 1|已变化 1/i);
    expect(summary()).toMatch(/写入磁盘 1|written in place 1/);
  });

  it('preserves the native external-change overwrite confirmation and mtime refresh', async () => {
    mocks.native = true;
    const { activeId } = twoModifiedTabs(true, '-external-check');
    await actionSaveAllProjects();
    useStore.getState().apply((d) => { d.name = 'Beta external-edit check'; });
    mocks.statFileMtimeNative.mockResolvedValue(2);

    const canceled = actionSaveProject();
    await vi.waitFor(() => expect(confirmRequests).toHaveLength(1));
    expect(confirmRequests[0].key).toBe('save-overwrite-external-change');
    confirmRequests[0].onCancel?.();
    expect(await canceled).toBe('none');
    expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(2);
    expect(useStore.getState().revision).not.toBe(useStore.getState().lastSavedRevision);

    const confirmed = actionSaveProject();
    await vi.waitFor(() => expect(confirmRequests).toHaveLength(2));
    confirmRequests[1].onConfirm();
    expect(await confirmed).toBe('in-place');
    expect(mocks.writeTextFileNative).toHaveBeenCalledTimes(3);
    expect(mocks.statFileMtimeNative).toHaveBeenLastCalledWith('/tmp/beta-external-check.cladeforge.json');
    const st = useStore.getState();
    expect(st.activeTabId).toBe(activeId);
    expect(st.revision).toBe(st.lastSavedRevision);
  });

  it('does not mark a native background tab saved when its write fails', async () => {
    mocks.native = true;
    const { activeId, inactiveId } = twoModifiedTabs(true);
    mocks.writeTextFileNative.mockImplementation(async (path) => {
      if (path === '/tmp/alpha.cladeforge.json') throw new Error('disk full');
      return [];
    });
    await actionSaveAllProjects();

    expectTabSaved(activeId);
    const snap = useStore.getState().tabStore[inactiveId];
    expect(snap.revision).not.toBe(snap.lastSavedRevision);
    expect(snap.project.savedAt).toBeUndefined();
    expect(summary()).toMatch(/写入磁盘 1|written in place 1/);
    expect(summary()).toMatch(/失败 1|failed 1/);
  });

  it('counts canceled native Save As dialogs without marking those never-saved tabs saved', async () => {
    mocks.native = true;
    const { activeId, inactiveId } = twoModifiedTabs();
    mocks.saveTextWithResult.mockResolvedValue({ ok: false });
    await actionSaveAllProjects();

    const st = useStore.getState();
    expect(st.revision).not.toBe(st.lastSavedRevision);
    expect(st.tabStore[inactiveId].revision).not.toBe(st.tabStore[inactiveId].lastSavedRevision);
    expect(st.activeTabId).toBe(activeId);
    expect(summary()).toMatch(/取消 2|canceled 2/);
    expect(summary()).not.toMatch(/从未保存过|never saved/);
  });
});

describe('actionRerootAtNode time-consistency refusal', () => {
  it('keeps the root unchanged and explains a rejected age inversion', () => {
    const project = parseNewick('(Y:1,Z:1)R;', 'dated-reroot');
    const y = Object.values(project.nodes).find((node) => node.label === 'Y')!;
    const z = Object.values(project.nodes).find((node) => node.label === 'Z')!;
    y.age = 40;
    z.age = 80;
    project.nodes[project.rootId].age = 100;
    useStore.getState().loadProject(project);
    const rootBefore = useStore.getState().project.rootId;
    const requests: ConfirmRequest[] = [];
    const unregister = registerConfirmHandler((request) => requests.push(request));
    useToasts.getState().toasts.forEach((toast) => useToasts.getState().dismiss(toast.id));

    actionRerootAtNode(y.id);
    expect(requests).toHaveLength(1);
    requests[0].onConfirm();
    unregister();

    expect(useStore.getState().project.rootId).toBe(rootBefore);
    expect(useToasts.getState().toasts.some((toast) =>
      /Reroot rejected|无法重新定根/.test(toast.message),
    )).toBe(true);
  });
});
