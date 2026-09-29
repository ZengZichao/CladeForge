// File-system abstraction. Inside the desktop shell it pairs Tauri's native
// dialog (open/save picker) with our own scoped IO commands (see io/native.ts);
// in a plain browser it falls back to download / <input type=file>. This lets
// the whole app be developed and tested in a browser, and keeps the desktop
// build free of any broad filesystem capability.

import {
  isTauri,
  readTextFileNative,
  writeBinaryFileNative,
  writeTextFileNative,
} from './native';
import { MAX_PROJECT_CHARS } from './limits';
import { tr } from '../ui/strings';

export { isTauri };

export interface DialogFilter {
  name: string;
  extensions: string[];
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function acceptFromFilters(filters: DialogFilter[]): string {
  const exts = filters.flatMap((f) => f.extensions.map((e) => `.${e}`));
  return exts.join(',');
}

function browserOpenText(
  filters: DialogFilter[],
  maxBytes: number,
): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptFromFilters(filters);
    let settled = false;
    const finish = (v: { name: string; text: string } | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(v);
    };
    // Dismissing the picker fires no reliable `cancel` event across browsers, so
    // the promise could hang forever. When the window regains focus without a
    // chosen file, resolve null so the open flow always settles.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish(null);
      }, 300);
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      // `File.size` is known before a single byte is read, so the ceiling the
      // native path already applies has to be honoured here too. Reading
      // first and rejecting afterwards meant a mistyped 200 MB pick was copied
      // wholesale into the webview before anything complained about it.
      if (Number.isFinite(file.size) && file.size > maxBytes) {
        finish(null);
        throw new Error(
          tr(
            `文件过大（${(file.size / 1e6).toFixed(1)} MB），上限为 ${(maxBytes / 1e6).toFixed(1)} MB。`,
            `File is too large (${(file.size / 1e6).toFixed(1)} MB); the limit is ${(maxBytes / 1e6).toFixed(1)} MB.`,
          ),
        );
      }
      const text = await file.text();
      finish({ name: file.name, text });
    };
    input.oncancel = () => finish(null);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

export async function saveText(
  defaultName: string,
  content: string,
  filters: DialogFilter[],
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return false;
    await writeTextFileNative(path, content);
    return true;
  }
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), defaultName);
  return true;
}

export async function saveBinary(
  defaultName: string,
  blob: Blob,
  filters: DialogFilter[],
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return false;
    await writeBinaryFileNative(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  downloadBlob(blob, defaultName);
  return true;
}

export async function openText(
  filters: DialogFilter[],
): Promise<{ name: string; text: string; path?: string } | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: false, directory: false, filters });
    if (!selected || Array.isArray(selected)) return null;
    const path = selected as string;
    // Ask Rust for the largest ceiling any text document may need here, so a
    // wrong-file pick is refused before the bytes are read and IPC-copied into the
    // webview. `openText` serves both projects and trees and does not know which,
    // so this is the looser of the two.
    const text = await readTextFileNative(path, MAX_PROJECT_CHARS);
    const name = path.split(/[\\/]/).pop() ?? 'file';
    return { name, text, path };
  }
  return browserOpenText(filters, MAX_PROJECT_CHARS);
}
