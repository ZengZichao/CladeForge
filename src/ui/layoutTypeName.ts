// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// One locale-aware, never-empty display name for a layout id.
//
// Extracted from `TimePanel` and `TreeCanvas`, which each carried their own copy,
// because BUG-5 was reported as the Time module printing an empty layout name
// (「current layout is “”」). The four catalogue ids always resolve; what can
// still reach the UI is a document whose `layout.type` is missing, blank or
// written by a build that used another id — `projectIO` backfills
// `{ ...DEFAULT_LAYOUT, ...raw.layout }`, so a hand-edited `"type": ""` survives
// the load untouched (only the node graph is structurally validated). The
// renderer treats an unrecognised id as the rectangular cladogram, but the
// message quoting it must never put an empty string between the quotes, so:
//
//   known id    → the localised catalogue name
//   unknown id  → the id verbatim (still informative, e.g. a future/legacy name)
//   blank/absent→ an explicit 「未知布局 / Unknown layout」 label
//
// Keeping the rule in one place is the point: a second copy is a second chance
// for the fallback to be forgotten again.

import type { LayoutType } from '../model/types';
import { S, tr } from './strings';

export function layoutTypeName(type: LayoutType | string | null | undefined): string {
  switch (type) {
    case 'rectangular-cladogram':
      return S.layoutType.cladogram;
    case 'rectangular-phylogram':
      return S.layoutType.phylogram;
    case 'time-calibrated':
      return S.layoutType.timeCalibrated;
    case 'circular':
      return S.layoutType.circular;
    default:
      break;
  }
  // Only a non-blank string is worth echoing; `null` / `undefined` / `''` all
  // fall through to the explicit label below.
  if (typeof type === 'string' && type.trim() !== '') return type.trim();
  return tr('未知布局', 'Unknown layout');
}

/** True when the layout id is one this build knows (used by status hints). */
export function isKnownLayoutType(type: unknown): type is LayoutType {
  return (
    type === 'rectangular-cladogram' ||
    type === 'rectangular-phylogram' ||
    type === 'time-calibrated' ||
    type === 'circular'
  );
}
