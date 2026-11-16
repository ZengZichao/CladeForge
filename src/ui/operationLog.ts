// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Central operation log (2026-11-15 OP-22).
//
// Import notes already had a home-made report; export failures, partial
// successes and validation warnings only existed as toasts that evaporated in
// seconds. The log subscribes to the ONE place every notification is created
// (`useToasts.push`), so nothing can be announced without being recorded —
// the panel then shows the whole story: what was attempted, what succeeded,
// what degraded, and why.

export type OperationKind = 'info' | 'success' | 'error';

export interface OperationEntry {
  id: number;
  kind: OperationKind;
  message: string;
  at: number;
}

const MAX_ENTRIES = 300;

let entries: OperationEntry[] = [];
let seq = 0;
const listeners = new Set<(entries: OperationEntry[]) => void>();

/** Record one operation. Called by the toast store; do not call directly. */
export function logOperation(kind: OperationKind, message: string): void {
  seq += 1;
  entries = [...entries, { id: seq, kind, message, at: Date.now() }].slice(-MAX_ENTRIES);
  for (const fn of listeners) fn(entries);
}

export function getOperationLog(): OperationEntry[] {
  return entries;
}

export function clearOperationLog(): void {
  entries = [];
  for (const fn of listeners) fn(entries);
}

export function subscribeOperationLog(fn: (entries: OperationEntry[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
