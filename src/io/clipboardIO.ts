// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Clipboard access, in one place.
//
// The app had NO clipboard path at all: no Newick paste, no table paste, no
// "copy the figure". The Web Clipboard API is the one cross-platform channel
// that works in the webview without native plugins; every failure is reported
// (permission denied / no API / empty) rather than swallowed.

import { tr } from '../ui/strings';

/** Read text from the system clipboard; null when unavailable or denied. */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null;
    const text = await navigator.clipboard.readText();
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/** Write text to the system clipboard; false when unavailable or denied. */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The user-facing message for "the clipboard is not reachable here". */
export function clipboardUnavailableMessage(): string {
  return tr(
    '无法读取剪贴板（权限不可用或浏览器不支持）。请改用「文件」菜单中的导入功能（打开工程 / 导入树 / 导入表格）。',
    'The clipboard could not be read (permission unavailable or not supported). Use the import entries in the File menu instead (open project / import trees / import table).',
  );
}
