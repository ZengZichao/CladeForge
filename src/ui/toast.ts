// Non-blocking toast notifications, replacing window.alert. A tiny Zustand
// store holds the active toasts; `notify.*` are the imperative entry points
// used from non-React code (file actions, etc.). Errors linger longer and must
// be dismissed or time out; info/success auto-dismiss quickly.

import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { logOperation } from './operationLog';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, action?: ToastAction, ttl?: number) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, action, ttl) => {
    if (get().toasts.some((t) => t.kind === kind && t.message === message)) return;
    // Every announcement becomes part of the reviewable operation log (OP-22).
    logOperation(kind, message);
    const id = nanoid(6);
    // M40: errors linger 30s (the old 7s raced against reading a long message);
    // info/success still auto-dismiss quickly, and every toast now has an
    // explicit close button in Toaster.tsx.
    const timeout = ttl ?? (action ? 6000 : kind === 'error' ? 30000 : 3500);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, action }] }));
    if (timeout > 0) {
      setTimeout(() => get().dismiss(id), timeout);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const notify = {
  info: (message: string) => useToasts.getState().push('info', message),
  success: (message: string) => useToasts.getState().push('success', message),
  error: (message: string) => useToasts.getState().push('error', message),
  /** An info toast with a single action button (e.g. Undo); lingers longer. */
  action: (message: string, label: string, run: () => void) =>
    useToasts.getState().push('info', message, { label, run }),
};
