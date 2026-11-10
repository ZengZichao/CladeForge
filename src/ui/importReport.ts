// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Import report: a persistent, reviewable record of the notes an import
// produced (review finding A-03 / M4 / C#15).
//
// The old path surfaced import warnings only as 7-second toasts, truncated at
// three, with "re-import the file to see them all" as the only way back — a
// promise that replayed the very same truncation. The full list now lives
// here, survives the toasts, and is reviewable from a dialog (every toast
// carries a "view all" action, so nothing depends on remembering to look).

import { create } from 'zustand';

export interface ImportReport {
  /** Human title (usually the file name that produced the notes). */
  title: string;
  issues: string[];
  at: number;
}

interface ImportReportState {
  report: ImportReport | null;
  open: boolean;
  record: (title: string, issues: string[]) => void;
  setOpen: (open: boolean) => void;
  clear: () => void;
}

export const useImportReport = create<ImportReportState>((set) => ({
  report: null,
  open: false,
  record: (title, issues) => set({ report: issues.length > 0 ? { title, issues, at: Date.now() } : null, open: false }),
  setOpen: (open) => set((s) => ({ open, report: open ? s.report : s.report })),
  clear: () => set({ report: null, open: false }),
}));
