// Autosave status channel.
//
// The old `writeWorkspace` swallowed every storage exception and the status bar
// printed "已保存" purely from a timer, so a quota-full or blocked localStorage
// looked exactly like a successful save — the one failure mode in this app that
// can cost a user their work. Writes now return whether they succeeded, the
// outcome is published here, and a failure raises an explicit warning toast on
// its own so the truth is visible even before every caller reads the result.

import { notify } from '../ui/toast';
import { tr } from '../ui/strings';

export type AutosaveFailure = 'quota' | 'unavailable' | 'serialize' | 'write';

export interface WriteResult {
  ok: boolean;
  failure?: AutosaveFailure;
  /** Human-readable cause, ready to show. */
  message?: string;
  /** Bytes handed to storage (used to explain a quota rejection). */
  bytes?: number;
}

export interface AutosaveState extends WriteResult {
  /** Epoch ms of the attempt. */
  at: number;
}

let latest: AutosaveState | null = null;
const listeners = new Set<(s: AutosaveState) => void>();

/** Most recent autosave attempt, or null before the first one. */
export function getLastAutosave(): AutosaveState | null {
  return latest;
}

/**
 * Subscribe to autosave outcomes. The status bar uses this to show the *real*
 * state ("saved" only after a write that actually returned ok) instead of
 * guessing from a debounce timer.
 */
export function subscribeAutosave(fn: (s: AutosaveState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Classify a `localStorage.setItem` / `getItem` exception. */
export function classifyStorageError(e: unknown): AutosaveFailure {
  const err = e as { name?: string; code?: number; message?: string } | null;
  const name = err?.name ?? '';
  const code = err?.code;
  if (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  ) {
    return 'quota';
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') return 'unavailable';
  return 'write';
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function failureMessage(failure: AutosaveFailure, bytes?: number): string {
  switch (failure) {
    case 'quota':
      return tr(
        `自动保存失败：浏览器存储空间已满（本次写入约 ${bytes ? mb(bytes) : '若干'}）。最新改动只存在于内存中，请立即用「文件 › 保存项目」写入磁盘，或关闭多余标签页后重试。`,
        `Autosave failed: browser storage is full (this write was ~${bytes ? mb(bytes) : 'several MB'}). The newest edits exist only in memory — use File › Save project now, or close surplus tabs and retry.`,
      );
    case 'unavailable':
      return tr(
        '自动保存失败：本地存储不可用（隐私模式或浏览器设置禁用了它）。请改用「文件 › 保存项目」保存到磁盘。',
        'Autosave failed: local storage is unavailable (private mode or browser settings). Use File › Save project to write to disk instead.',
      );
    case 'serialize':
      return tr(
        '自动保存失败：工程数据无法序列化（可能含循环引用）。请立即用「文件 › 保存项目」重试并查看错误详情。',
        'Autosave failed: the document could not be serialised (a cyclic reference is the usual cause). Use File › Save project now and check the error detail.',
      );
    case 'write':
    default:
      return tr(
        '自动保存失败：写入本地存储时出错。最新改动尚未持久化。',
        'Autosave failed: writing to local storage errored. The latest edits are not persisted.',
      );
  }
}

// A quota failure repeats on every debounced edit; warning once per distinct
// failure (until a success resets it) keeps the toast from stacking up.
let lastWarned: AutosaveFailure | null = null;

/** Publish an autosave outcome and warn loudly on failure. */
export function recordAutosave(result: WriteResult): AutosaveState {
  latest = { ...result, at: Date.now() };
  if (result.ok) {
    lastWarned = null;
  } else if (result.failure !== lastWarned) {
    lastWarned = result.failure ?? 'write';
    notify.error(result.message ?? failureMessage(latest.failure ?? 'write', latest.bytes));
  }
  for (const fn of [...listeners]) fn(latest);
  return latest;
}

/** Test hook / app teardown: forget the throttling and the subscribers. */
export function resetAutosaveState(): void {
  latest = null;
  lastWarned = null;
  listeners.clear();
}
