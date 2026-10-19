// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// First-entry behaviour of the geological time chart's era overlay (BUG-7).
//
// The 时间 panel's 「Show geological eras」 checkbox lives in global UI state
// (`showEras`), not in the project document: it must NOT enter the undo stack,
// and an effect must never rewrite `project.layout.type` (see the long note in
// TreeCanvas). So the "first time the user opens the time chart, turn the bands
// on once and explain where the controls are" rule is applied at the explicit
// layout-switch ENTRY POINTS instead:
//
//   * 样式 → Layout select            (`LayoutPanel`)
//   * 时间 → 「Switch to geological time chart」 (`TimePanel`)
//   * the canvas' time-data proposal toast action (`TreeCanvas`)
//
// One module owns both halves of the rule so the three call sites cannot drift:
//
// 1. `planTimeChartEntry(showEras, memory)` — pure decision. Never enables the
//    overlay again once the user has explicitly unchecked it; shows the
//    explanatory hint at most once per browser install.
// 2. `enterTimeChartLayout()` — the thin bridge that reads the live store,
//    applies the plan (`setShowEras`, toast) and persists the memory. It is
//    called from a click handler, never from a render/effect, so Undo cannot
//    re-trigger it and no edit is recorded.
//
// `showEras` is session state (reset with a new document); the memory below is
// the durable part: "the user opted out" and "the hint has already been shown".

import { useStore } from '../model/store';
import { isTimeCalibrated } from '../model/treeOps';
import { tr } from './strings';
import { notify } from './toast';

/** localStorage key holding the durable opt-out/hint memory. */
export const LS_KEY = 'cladeforge:timechart:eras';

export interface TimeChartErasMemory {
  /**
   * The user explicitly unchecked 「Show geological eras」 at some point. Their
   * choice outranks the convenience default: never auto-enable again, and do
   * not send the first-entry hint (they already know where the checkbox is).
   */
  erasOff: boolean;
  /** The one-time explanatory hint has already been shown/dismissed. */
  hintShown: boolean;
}

export const DEFAULT_TIME_CHART_ERAS_MEMORY: TimeChartErasMemory = {
  erasOff: false,
  hintShown: false,
};

/**
 * Read the durable memory. Any storage failure (private mode, blocked cookies,
 * quota) reads as "nothing remembered": the worst outcome is the first-entry
 * convenience instead of a user preference, never a crash or a white screen.
 * Malformed JSON is treated the same way.
 */
export function readTimeChartErasMemory(): TimeChartErasMemory {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_TIME_CHART_ERAS_MEMORY };
    const parsed = JSON.parse(raw) as Partial<TimeChartErasMemory> | null;
    return {
      erasOff: parsed?.erasOff === true,
      hintShown: parsed?.hintShown === true,
    };
  } catch {
    return { ...DEFAULT_TIME_CHART_ERAS_MEMORY };
  }
}

/** Persist the durable memory; a storage failure must never break the switch. */
export function writeTimeChartErasMemory(memory: TimeChartErasMemory): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(memory));
  } catch {
    /* storage blocked / full — the in-session behaviour still applies */
  }
}

/**
 * Record an EXPLICIT user toggle of the checkbox. Last choice wins: unchecking
 * opts out of auto-enable, re-checking opts back in. Called only from the
 * checkbox's onChange — never from the automatic enable below.
 */
export function rememberErasToggle(enabled: boolean): void {
  const memory = readTimeChartErasMemory();
  writeTimeChartErasMemory({ ...memory, erasOff: !enabled });
}

/** Record that the one-time hint has been shown, so it never nags twice. */
export function markTimeChartErasHintShown(): void {
  const memory = readTimeChartErasMemory();
  writeTimeChartErasMemory({ ...memory, hintShown: true });
}

export interface TimeChartEntryPlan {
  /** Turn the era overlay on because it is currently off. */
  enableEras: boolean;
  /** Show the one-time "where are the controls" hint. */
  showHint: boolean;
}

/**
 * Pure decision for entering the geological time chart with `showEras` in its
 * current state and the durable memory. Exported for the unit tests.
 */
export function planTimeChartEntry(
  showEras: boolean,
  memory: TimeChartErasMemory,
): TimeChartEntryPlan {
  // The user said no: neither the automatic enable nor the hint may reappear,
  // no matter how often they switch layouts.
  if (memory.erasOff) return { enableEras: false, showHint: false };
  const enableEras = !showEras;
  // The hint exists to explain an automatic change the user did not ask for.
  // If the bands were already on (user turned them on themselves, or they are
  // still on from an earlier switch) there is nothing to explain.
  return { enableEras, showHint: enableEras && !memory.hintShown };
}

/** Message of the one-time hint (bilingual, inline because 文案 lives in tr()). */
export function timeChartErasHintText(): string {
  return tr(
    '已为地质时间图开启地质年代带。时间轴与年代带可在「时间」模块中调整。',
    'Geological era bands were switched on for the time chart. The time axis and the bands can be adjusted in the Time module.',
  );
}

/** Action label that undoes the automatic enable with one click. */
export function timeChartErasHintActionLabel(): string {
  return tr('隐藏年代带', 'Hide era bands');
}

/**
 * Called by every layout-switch entry point AFTER the new layout has been
 * applied. Applies the first-entry plan if (and only if) the document actually
 * carries time data: on a purely topological tree the layout has no axis, the
 * checkbox is disabled, and silently checking it would leave the user with a
 * toggle they cannot undo until they add ages.
 *
 * Side effects are UI-only (`showEras`, a toast, one fit request) — nothing is
 * written to the project, so no undo step is created.
 */
export function enterTimeChartLayout(): void {
  const store = useStore.getState();
  if (store.project.layout.type !== 'time-calibrated') return;
  if (!isTimeCalibrated(store.project)) return;

  const plan = planTimeChartEntry(store.showEras, readTimeChartErasMemory());
  if (!plan.enableEras && !plan.showHint) return;

  if (plan.enableEras) {
    store.setShowEras(true);
    // Same as the checkbox's own handler: the era labels stack outside the
    // band, so the newly revealed rows need a fresh fit to sit in the viewport.
    store.requestFit();
  }
  if (plan.showHint) {
    // Record before showing: a toast that is missed (auto-dismissed, another
    // document activated) must still count as "already told", otherwise the
    // same hint would be un-dismissable across sessions.
    markTimeChartErasHintShown();
    notify.action(timeChartErasHintText(), timeChartErasHintActionLabel(), () => {
      const live = useStore.getState();
      live.setShowEras(false);
      rememberErasToggle(false);
    });
  }
}
