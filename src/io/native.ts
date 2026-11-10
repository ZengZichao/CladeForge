// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The single place the frontend crosses into native (Rust) code.
//
// Every `#[tauri::command]` is wrapped here with a typed signature, so future
// heavy compute (simulation / inference) has one obvious boundary to grow into.
// `@tauri-apps/api/core` is imported lazily so a plain-browser build (npm run
// dev without Tauri) never pulls it in; callers guard with `isTauri()`.

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export interface AppInfo {
  name: string;
  version: string;
  tauri: string;
}

/**
 * Client-side mirror of the Rust path allow-list. It is *not* the
 * security boundary — the Rust command validates again, and a compromised
 * webview can bypass anything here — but it turns an obviously bad path into a
 * readable JS error before a round trip.
 *
 * The rules are deliberately identical to `validate_path` in src-tauri/src/lib.rs:
 * absolute, non-empty, no `..`. `.` is NOT rejected here, because Rust's
 * `Path::components()` normalises it away and the command accepts such a path —
 * refusing it client-side would have made the two sides disagree about what a
 * legal path is. `src/io/native.test.ts` runs the same case table
 * against both implementations.
 */
export function assertNativePath(path: string): string {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Native file path is empty');
  const isAbsolute = path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');
  if (!isAbsolute) throw new Error(`Native file path must be absolute: ${path}`);
  if (path.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`Native file path may not traverse upwards: ${path}`);
  }
  return path;
}

/**
 * Commands the webview may call. Everything else is rejected client-side, and
 * the Rust side owns the authoritative allow-list (`src-tauri/src/lib.rs`).
 */
const ALLOWED_COMMANDS = new Set([
  'app_info',
  'read_text_file',
  'read_binary_file',
  'stat_file_mtime',
  'write_text_file',
  'write_binary_file',
  // Desktop-shell wiring: the unsaved-changes close guard and the OS file
  // association. Both are no-ops in a plain browser (isTauri() guards).
  'notify_webview_ready',
  'confirm_close_window',
  'take_launch_paths',
]);

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!ALLOWED_COMMANDS.has(cmd)) throw new Error(`Refusing to invoke unknown command "${cmd}"`);
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** Native app/version info, or null when running in a plain browser. */
export async function getAppInfo(): Promise<AppInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<AppInfo>('app_info');
  } catch {
    return null;
  }
}

/**
 * `maxBytes` must be the ceiling the CALLER is about to enforce, not the Rust
 * hard limit: reading a whole 200 MB file only for `assertTreeInput` to reject it
 * afterwards meant marshalling and IPC-copying data that was always going to be
 * thrown away.
 */
export function readTextFileNative(path: string, maxBytes?: number): Promise<string> {
  if (!isTauri()) return Promise.reject(new Error('readTextFileNative requires the desktop shell'));
  return invoke<string>('read_text_file', {
    path: assertNativePath(path),
    maxBytes,
  });
}

/**
 * Modification time (ms since epoch) of a scoped path, or null. The frontend
 * half of the external-modification guard on in-place saves (M12).
 */
export async function statFileMtimeNative(path: string): Promise<number | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<number | null>('stat_file_mtime', { path: assertNativePath(path) });
  } catch {
    return null;
  }
}

/**
 * Raw bytes for the encoding-fallback open path: when the strict-UTF-8 text
 * read refuses a file (GBK CSV from Chinese-locale Excel), the webview decodes
 * the bytes itself with `TextDecoder('gb18030')`.
 */
export function readBinaryFileNative(path: string, maxBytes?: number): Promise<Uint8Array> {
  if (!isTauri()) return Promise.reject(new Error('readBinaryFileNative requires the desktop shell'));
  return invoke<number[]>('read_binary_file', {
    path: assertNativePath(path),
    maxBytes,
  }).then((bytes) => Uint8Array.from(bytes));
}

export function writeTextFileNative(path: string, contents: string): Promise<string[]> {
  if (!isTauri()) return Promise.reject(new Error('writeTextFileNative requires the desktop shell'));
  return invoke<string[]>('write_text_file', { path: assertNativePath(path), contents }).then(surfaceWriteWarnings);
}

export function writeBinaryFileNative(path: string, bytes: Uint8Array): Promise<string[]> {
  if (!isTauri()) return Promise.reject(new Error('writeBinaryFileNative requires the desktop shell'));
  // Tauri serialises a number[] argument into the command's Vec<u8>.
  return invoke<string[]>('write_binary_file', {
    path: assertNativePath(path),
    contents: Array.from(bytes),
  }).then(surfaceWriteWarnings);
}

/**
 * Surface the Rust writer's non-fatal notes (C#14): a parent-dir flush failure
 * or a leftover staging directory used to go to stderr — invisible in a
 * release desktop build, so the user never heard about a save that
 * half-succeeded.
 */
async function surfaceWriteWarnings(warnings: string[]): Promise<string[]> {
  if (warnings.length === 0) return warnings;
  const [{ notify }, { tr }] = await Promise.all([
    import('../ui/toast'),
    import('../ui/strings'),
  ]);
  for (const w of warnings) {
    notify.info(tr(`保存完成，但有一处注意事项：${w}`, `Saved, with one caveat: ${w}`));
  }
  return warnings;
}

// --- desktop-shell wiring (close guard + file association) -------------------

/**
 * Tell the Rust shell the webview is up and its close-guard listener is
 * registered. Until this fires, the shell lets CloseRequested pass straight
 * through: nothing can be dirty before the UI exists, and a failed frontend
 * load must never wedge the window shut.
 */
export function notifyWebviewReady(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>('notify_webview_ready');
}

/** Close the window for real, after the user confirmed (or nothing was dirty). */
export function confirmCloseWindow(): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke<void>('confirm_close_window');
}

/**
 * File paths this process was launched with (OS file association: double-click
 * / "open with"). Consumed once — later launches arrive through the
 * single-instance plugin as `cladeforge:open-path` events instead.
 */
export function takeLaunchPaths(): Promise<string[]> {
  if (!isTauri()) return Promise.resolve([]);
  return invoke<string[]>('take_launch_paths');
}

/**
 * Subscribe to shell events the Rust side emits. Returns an unlisten function.
 * Returns a no-op in a plain browser.
 */
export async function listenShellEvent(
  event: 'cladeforge:close-requested' | 'cladeforge:open-path',
  handler: (payload: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>(event, (e) => handler(e.payload));
}
