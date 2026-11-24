import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from './strings';
import type { ConfirmRequest } from './confirmDialog';

const mocks = vi.hoisted(() => ({
  native: false,
  saveProject: vi.fn(),
  requestConfirm: vi.fn(),
}));

vi.mock('../io/fileService', () => ({ isTauri: () => mocks.native }));
vi.mock('../io/fileActions', () => ({ actionSaveProject: mocks.saveProject }));
vi.mock('./confirmDialog', () => ({ requestConfirm: mocks.requestConfirm }));

import { confirmCloseTab } from './tabs';
import { useStore } from '../model/store';
import { createEmptyProject } from '../model/sampleTree';
import type { SaveProjectOutcome } from '../io/fileActions';

let dirtyTabId: string;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = false;
  setLanguage('en');
  useStore.getState().loadProject(createEmptyProject('Neighbour'));
  useStore.getState().openInNewTab(createEmptyProject('Edited'));
  dirtyTabId = useStore.getState().activeTabId;
  useStore.getState().apply((draft) => { draft.name = 'Unsaved edits'; });
});

function closeRequest(): ConfirmRequest {
  confirmCloseTab(dirtyTabId);
  expect(mocks.requestConfirm).toHaveBeenCalledTimes(1);
  return mocks.requestConfirm.mock.calls[0][0] as ConfirmRequest;
}

async function finishSave(outcome: SaveProjectOutcome, beforeOutcome?: () => void): Promise<void> {
  let resolve!: (value: SaveProjectOutcome) => void;
  mocks.saveProject.mockImplementation(() => {
    beforeOutcome?.();
    return new Promise<SaveProjectOutcome>((done) => { resolve = done; });
  });
  closeRequest().alternate!.onAction();
  expect(mocks.saveProject).toHaveBeenCalledTimes(1);
  resolve(outcome);
  // The save continuation was queued before this one and runs synchronously
  // after its outcome resolves.
  await Promise.resolve();
}

describe('confirmCloseTab save alternative', () => {
  it.each([
    {
      language: 'en' as const,
      native: false,
      label: 'Download and close',
      message: 'Tab “Unsaved edits” has changes not yet written to a project file. The browser cannot confirm that the file was saved to disk; this action requests a download, then closes the tab. Closing removes it from the workspace; the local recovery copy is kept.',
    },
    {
      language: 'zh' as const,
      native: false,
      label: '下载并关闭',
      message: '标签页「Unsaved edits」有尚未写入项目文件的更改。浏览器无法确认文件已保存到磁盘；此操作会请求下载，然后关闭标签页。关闭后会从工作区移出，本地恢复副本仍保留。',
    },
    {
      language: 'en' as const,
      native: true,
      label: 'Save and close',
      message: 'Tab “Unsaved edits” has changes not yet written to a project file. Closing removes it from the workspace; the local recovery copy is kept.',
    },
    {
      language: 'zh' as const,
      native: true,
      label: '保存并关闭',
      message: '标签页「Unsaved edits」有尚未写入项目文件的更改。关闭后会从工作区移出，本地恢复副本仍保留。',
    },
  ])(
    'uses explicit $language browser=$native save-and-close copy',
    ({ language, native, label, message }) => {
      setLanguage(language);
      mocks.native = native;
      const request = closeRequest();

      expect(request.alternate?.label).toBe(label);
      expect(request.message).toBe(message);
    },
  );

  it('closes a native tab only after a successful save clears its dirty state', async () => {
    mocks.native = true;

    await finishSave('in-place', () => {
      const state = useStore.getState();
      expect(state.markTabSaved(dirtyTabId)).toBe(true);
    });

    expect(useStore.getState().tabs).not.toContain(dirtyTabId);
    expect(useStore.getState().project.name).toBe('Neighbour');
  });

  it('keeps a native tab open if an in-place outcome does not leave it clean', async () => {
    mocks.native = true;

    await finishSave('in-place', () => {
      const state = useStore.getState();
      expect(state.markTabSaved(dirtyTabId)).toBe(true);
      state.apply((draft) => { draft.name = 'Edited during save'; });
    });

    expect(useStore.getState().tabs).toContain(dirtyTabId);
    expect(useStore.getState().project.name).toBe('Edited during save');
  });

  it.each(['failed', 'none', 'stale'] as const)(
    'keeps a native tab open after a %s save outcome',
    async (outcome) => {
      mocks.native = true;
      await finishSave(outcome);

      expect(useStore.getState().tabs).toContain(dirtyTabId);
      expect(useStore.getState().activeTabId).toBe(dirtyTabId);
      expect(useStore.getState().project.name).toBe('Unsaved edits');
    },
  );

  it('closes a browser tab after a download is requested even though it stays dirty', async () => {
    await finishSave('downloaded');

    expect(useStore.getState().tabs).not.toContain(dirtyTabId);
    expect(useStore.getState().project.name).toBe('Neighbour');
  });

  it.each(['failed', 'none', 'stale'] as const)(
    'keeps a browser tab open after a %s save outcome',
    async (outcome) => {
      await finishSave(outcome);

      expect(useStore.getState().tabs).toContain(dirtyTabId);
      expect(useStore.getState().activeTabId).toBe(dirtyTabId);
      expect(useStore.getState().project.name).toBe('Unsaved edits');
    },
  );
});
