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
const ALLOWED_COMMANDS = new Set(['app_info', 'read_text_file', 'write_text_file', 'write_binary_file']);

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

export function writeTextFileNative(path: string, contents: string): Promise<void> {
  if (!isTauri()) return Promise.reject(new Error('writeTextFileNative requires the desktop shell'));
  return invoke<void>('write_text_file', { path: assertNativePath(path), contents });
}

export function writeBinaryFileNative(path: string, bytes: Uint8Array): Promise<void> {
  if (!isTauri()) return Promise.reject(new Error('writeBinaryFileNative requires the desktop shell'));
  // Tauri serialises a number[] argument into the command's Vec<u8>.
  return invoke<void>('write_binary_file', { path: assertNativePath(path), contents: Array.from(bytes) });
}
