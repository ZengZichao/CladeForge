// Global "busy" indicator for long-running async operations (export, save…).
//
// A tiny Zustand store holds an optional status message; fileActions wraps its
// await boundaries with `withBusy` so the UI can show a non-blocking overlay
// (see BusyOverlay) instead of appearing frozen while a large tree exports.

import { create } from 'zustand';

interface BusyState {
  message: string | null;
  set: (message: string | null) => void;
}

export const useBusy = create<BusyState>((set) => ({
  message: null,
  set: (message) => set({ message }),
}));

/**
 * Run an async task while a busy overlay shows `message`. The overlay is
 * always cleared in `finally`, even if the task throws.
 */
export async function withBusy<T>(message: string, task: () => Promise<T>): Promise<T> {
  useBusy.getState().set(message);
  try {
    return await task();
  } finally {
    useBusy.getState().set(null);
  }
}
