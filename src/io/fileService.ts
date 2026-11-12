// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// File-system abstraction. Inside the desktop shell it pairs Tauri's native
// dialog (open/save picker) with our own scoped IO commands (see io/native.ts);
// in a plain browser it falls back to download / <input type=file>. This lets
// the whole app be developed and tested in a browser, and keeps the desktop
// build free of any broad filesystem capability.

import {
  isTauri,
  readBinaryFileNative,
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

export interface OpenedText {
  name: string;
  text: string;
  path?: string;
  /**
   * Non-fatal decoding notes (e.g. "decoded as GB18030 instead of UTF-8").
   * The caller surfaces them — a silent transcode is exactly the kind of
   * partial success this app refuses to hide.
   */
  notes?: string[];
}

/**
 * Decode bytes as UTF-8 strictly; on failure fall back to GB18030 (a superset
 * of GBK/GB2312 — the default output of Chinese-locale Excel, i.e. the single
 * most common input this app receives from its target users). The fallback is
 * always announced: mojibake flowing into label matching used to surface as a
 * baffling "N rows unmatched" with the real cause (the encoding) invisible.
 */
export function decodeBytesWithFallback(bytes: Uint8Array, name: string): OpenedText {
  const strict = new TextDecoder('utf-8', { fatal: true });
  try {
    return { name, text: strict.decode(bytes) };
  } catch {
    const gb = new TextDecoder('gb18030');
    const text = gb.decode(bytes);
    const bad = (text.match(/\uFFFD/g) ?? []).length;
    return {
      name,
      text,
      notes: [
        tr(
          `文件「${name}」不是 UTF-8 编码，已按 GB18030（兼容 GBK/GB2312）解码${bad > 0 ? `，仍有 ${bad} 个字节无法映射` : ''}。建议在 Excel 或文本编辑器中将其另存为 UTF-8 后再使用。`,
          `File "${name}" is not UTF-8; it was decoded as GB18030 (GBK/GB2312-compatible)${bad > 0 ? `, with ${bad} unmappable byte${bad === 1 ? '' : 's'}` : ''}. Consider re-saving it as UTF-8 in Excel or a text editor.`,
        ),
      ],
    };
  }
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
): Promise<OpenedText | null> {
  // Rejects (instead of resolving null) on real failures — an oversized pick is
  // a failed open, not a cancelled one, and the caller's catch surfaces the
  // reason as a toast. The old shape resolved first and threw afterwards, so
  // the error became an unhandled rejection the user never saw.
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptFromFilters(filters);
    let settled = false;
    const finish = (v: OpenedText | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(v);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      reject(e);
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
        fail(
          new Error(
            tr(
              `文件过大（${(file.size / 1e6).toFixed(1)} MB），上限为 ${(maxBytes / 1e6).toFixed(1)} MB。`,
              `File is too large (${(file.size / 1e6).toFixed(1)} MB); the limit is ${(maxBytes / 1e6).toFixed(1)} MB.`,
            ),
          ),
        );
        return;
      }
      try {
        // Decode through the strict-UTF-8 → GB18030 fallback: a GBK CSV from
        // Chinese-locale Excel used to become silent mojibake here.
        const bytes = new Uint8Array(await file.arrayBuffer());
        finish(decodeBytesWithFallback(bytes, file.name));
      } catch (e) {
        fail(
          new Error(
            tr(
              `无法读取文件内容：${e instanceof Error ? e.message : String(e)}`,
              `Could not read the file: ${e instanceof Error ? e.message : String(e)}`,
            ),
          ),
        );
      }
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
  const r = await saveTextWithResult(defaultName, content, filters);
  return r.ok;
}

/**
 * Like `saveText`, but reports WHICH path was written so the caller can adopt
 * it as the document's sourcePath (the Document ↔ File binding ⌘S needs).
 * `ok === false` means the user cancelled.
 */
export async function saveTextWithResult(
  defaultName: string,
  content: string,
  filters: DialogFilter[],
): Promise<{ ok: boolean; path?: string }> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return { ok: false };
    await writeTextFileNative(path, content);
    return { ok: true, path };
  }
  // Browser semantics, stated (C#19): "saved" here means "handed to the
  // browser's download pipeline", not "written to a remembered path".
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), defaultName);
  return { ok: true };
}

/**
 * Above this size a binary write shows the busy overlay for the IPC hop.
 * The JSON number-array bridge costs ≈ 3–4 characters per byte, so a 100 MB
 * figure can take seconds on the WRITE alone — after the (already busy) render
 * finished, the UI used to look frozen again with no hint anything was
 * happening. The real fix is a raw-bytes IPC channel (Rust-side change, needs
 * a desktop build to verify); until then this keeps the user informed.
 */
const LARGE_IPC_WRITE_BYTES = 16 * 1024 * 1024;

export async function saveBinary(
  defaultName: string,
  blob: Blob,
  filters: DialogFilter[],
): Promise<{ ok: boolean; path?: string }> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return { ok: false };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > LARGE_IPC_WRITE_BYTES) {
      const { withBusy } = await import('../ui/busy');
      await withBusy(
        tr(
          `正在写入 ${Math.ceil(bytes.length / (1024 * 1024))} MB 的文件…`,
          `Writing the ${Math.ceil(bytes.length / (1024 * 1024))} MB file…`,
        ),
        () => writeBinaryFileNative(path, bytes),
      );
    } else {
      await writeBinaryFileNative(path, bytes);
    }
    // The path travels back (C#9): the success toast can say WHERE the figure
    // went, not just that it went somewhere.
    return { ok: true, path };
  }
  downloadBlob(blob, defaultName);
  return { ok: true };
}

export async function openText(
  filters: DialogFilter[],
): Promise<OpenedText | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ multiple: false, directory: false, filters });
    if (!selected || Array.isArray(selected)) return null;
    const path = selected as string;
    // Ask Rust for the largest ceiling any text document may need here, so a
    // wrong-file pick is refused before the bytes are read and IPC-copied into
    // the webview. `openText` serves both projects and trees and does not know
    // which, so this is the looser of the two. The limit is a CHARACTER count
    // passed as a BYTE count (C#22): one JS char is at least one UTF-8 byte,
    // so the byte ceiling is never larger than the intended character budget —
    // conservative for CJK text (3 bytes/char), exact for ASCII, and the
    // client-side length check after read stays authoritative.
    const name = path.split(/[\\/]/).pop() ?? 'file';
    try {
      const text = await readTextFileNative(path, MAX_PROJECT_CHARS);
      return { name, text, path };
    } catch (e) {
      // A non-UTF-8 file (GBK CSV from Chinese-locale Excel is the classic
      // case) used to die here with an English "stream did not contain valid
      // UTF-8". Re-read as bytes and decode in the webview, where the encoding
      // fallback and its user-facing note live.
      const message = e instanceof Error ? e.message : String(e);
      if (!/utf-?8/i.test(message)) throw e;
      const bytes = await readBinaryFileNative(path, MAX_PROJECT_CHARS);
      const decoded = decodeBytesWithFallback(bytes, name);
      return { ...decoded, path };
    }
  }
  return browserOpenText(filters, MAX_PROJECT_CHARS);
}
