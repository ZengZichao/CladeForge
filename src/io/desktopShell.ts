// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Desktop-shell wiring: the two OS-integration paths the browser build never
// sees, both requested by the 2026-11-10 review round (A-01 / A-02 / C#1–C#3):
//
//   1. UNSAVED-CHANGES CLOSE GUARD — the Rust shell intercepts
//      `CloseRequested` (the window × button, Alt+F4, ⌘Q) and asks this module
//      to decide. A dirty tab shows the same confirm dialog a tab close shows;
//      a clean workspace closes immediately. Before the webview signals
//      readiness the shell lets closes pass through, so a failed frontend load
//      can never wedge the window shut.
//
//   2. OS FILE ASSOCIATION — paths the process was launched with (double-click
//      on an associated file) and paths forwarded by the single-instance
//      plugin (a second launch while we are running) all land in
//      `openPathFromShell`, the same pipeline as ⌘O / the canvas dropzone.
//
// Everything here is a no-op in a plain browser.

import { useStore } from '../model/store';
import { requestConfirm } from '../ui/confirmDialog';
import { notify } from '../ui/toast';
import { S, tr } from '../ui/strings';
import { openPathFromShell } from './fileActions';
import { confirmCloseWindow, isTauri, listenShellEvent, notifyWebviewReady, takeLaunchPaths } from './native';

/** True when ANY tab holds unsaved changes (same test the tab bar's dot uses). */
export function hasUnsavedChanges(): boolean {
  const s = useStore.getState();
  if (s.revision !== s.lastSavedRevision) return true;
  for (const [tabId, snap] of Object.entries(s.tabStore)) {
    if (tabId === s.activeTabId) continue;
    if (snap.revision !== snap.lastSavedRevision) return true;
  }
  return false;
}

function closeWindowNow(): void {
  void confirmCloseWindow();
}

/**
 * The ⌘W chord with a SINGLE tab: there is no tab to close, so the chord means
 * "close the window" — route it through the same dirty-check guard the OS
 * close button uses. In a browser the window cannot be closed from script, so
 * the chord says what it did instead of being swallowed (C#13).
 */
export function requestWindowClose(): void {
  if (!isTauri()) {
    notify.info(
      tr(
        '浏览器中 ⌘W 属于浏览器本身；请用窗口/标签关闭按钮，或直接退出应用。',
        'In a browser ⌘W belongs to the browser itself; use the window/tab close button, or quit the app.',
      ),
    );
    return;
  }
  handleShellCloseRequest();
}

function handleShellCloseRequest(): void {
  if (!hasUnsavedChanges()) {
    closeWindowNow();
    return;
  }
  requestConfirm({
    // A distinct key from the tab-close confirm: answering one must never be
    // mistaken for answering the other.
    key: 'close-window-unsaved',
    title: S.tabs.closeConfirmTitle,
    message: tr(
      '有未保存的修改。直接退出的话，这些修改只存在于浏览器的自动保存中（存储不可用或配额已满时会丢失）；先保存可以把它们写入文件。',
      'There are unsaved changes. Quitting now leaves them only in the browser autosave (lost if storage is unavailable or full); saving first writes them to a file.',
    ),
    confirmLabel: tr('退出而不保存', 'Quit without saving'),
    danger: true,
    onConfirm: closeWindowNow,
  });
}

let activeCleanup: (() => void) | null = null;

/**
 * Register every desktop-shell hook. Idempotent: a second call (App remounts
 * on a language switch) unregisters the previous set first, and a cleanup that
 * races a still-pending registration unlistens as soon as it resolves.
 */
export function initDesktopShell(): () => void {
  activeCleanup?.();
  const unlisteners: (() => void)[] = [];
  let disposed = false;
  const track = (unlisten: () => void) => {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  };
  void (async () => {
    try {
      // Register the listeners BEFORE signalling readiness, so a close that
      // races startup can never fall between the two.
      track(await listenShellEvent('cladeforge:close-requested', () => handleShellCloseRequest()));
      track(await listenShellEvent('cladeforge:open-path', (path) => void openPathFromShell(path)));
      await notifyWebviewReady();
      // Paths this process itself was launched with (file association).
      const paths = await takeLaunchPaths();
      for (const path of paths) await openPathFromShell(path);
    } catch (e) {
      // Shell wiring must never take the app down: report and keep running
      // (the autosave still protects the work).
      console.error('CladeForge desktop shell wiring failed:', e);
    }
  })();
  const cleanup = () => {
    disposed = true;
    for (const fn of unlisteners.splice(0)) fn();
    if (activeCleanup === cleanup) activeCleanup = null;
  };
  activeCleanup = cleanup;
  return cleanup;
}
