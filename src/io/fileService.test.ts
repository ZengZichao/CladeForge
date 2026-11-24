// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';

const mocks = vi.hoisted(() => ({
  writeTextFileNative: vi.fn(),
}));

vi.mock('./native', () => ({
  isTauri: () => false,
  readBinaryFileNative: vi.fn(),
  readTextFileNative: vi.fn(),
  writeBinaryFileNative: vi.fn(),
  writeTextFileNative: mocks.writeTextFileNative,
}));

import { saveTextWithResult } from './fileService';

describe('browser saveTextWithResult persistence boundary', () => {
  let blobs: Blob[];

  beforeEach(() => {
    blobs = [];
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return `blob:test-${blobs.length}`;
      }),
      revokeObjectURL: vi.fn(),
    });
    mocks.writeTextFileNative.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports only a dispatched download click, with no durable path or native write', async () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    await expect(saveTextWithResult('project.cladeforge.json', '{"project":{}}', [])).resolves.toEqual({ ok: true });
    expect(downloads).toEqual(['project.cladeforge.json']);
    expect(blobs).toHaveLength(1);
    await expect(blobs[0].text()).resolves.toBe('{"project":{}}');
    expect(mocks.writeTextFileNative).not.toHaveBeenCalled();
  });

  it('does not throw or claim persistence when the browser silently blocks multiple download requests', async () => {
    // A blocked browser may ignore anchor.click() entirely. There is no rejection
    // or persistence callback, so every request still has the same weak result.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const results = await Promise.all([
      saveTextWithResult('alpha.cladeforge.json', 'alpha', []),
      saveTextWithResult('beta.cladeforge.json', 'beta', []),
    ]);

    expect(click).toHaveBeenCalledTimes(2);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(mocks.writeTextFileNative).not.toHaveBeenCalled();
  });
});
