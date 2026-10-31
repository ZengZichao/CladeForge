// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Number input + slider for one numeric style property.
//
// Kept OUT of `fields.tsx` on purpose: fields.tsx is the store-free form
// primitives module, and importing the store here would pull the i18n
// bootstrap (a module side effect) into every consumer of the plain fields.

import { useEffect, useRef } from 'react';
import { useStore } from '../model/store';
import type { Project } from '../model/types';
import { NumberField } from './fields';
import { tr } from './strings';

/**
 * Numeric style field with BOTH an editable number and a slider.
 *
 * The number keeps `NumberField`'s buffered commit; the slider previews live
 * through the store's begin/live/commit interaction API, so dragging it
 * repaints the canvas immediately and the whole drag records ONE undo step.
 * Committing through `apply` on every `input` frame would otherwise burn the
 * 100-entry history in a single gesture.
 */
export function SliderNumberField({
  value,
  recipe,
  min,
  max,
  sliderMin,
  sliderMax,
  step = 1,
  unit,
  unitTitle,
  ariaLabel,
}: {
  value: number;
  /** Draft mutation for one value, e.g. `(v) => (d) => d.defaults.branch.width = v`. */
  recipe: (v: number) => (d: Project) => void;
  /** Optional validation bounds for the typed number (omit for unbounded). */
  min?: number;
  max?: number;
  /** Optional slider bounds when they differ from the typed-number bounds. */
  sliderMin?: number;
  sliderMax?: number;
  step?: number;
  unit?: string;
  unitTitle?: string;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
}) {
  const apply = useStore((s) => s.apply);
  const beginInteraction = useStore((s) => s.beginInteraction);
  const live = useStore((s) => s.live);
  const commitInteraction = useStore((s) => s.commitInteraction);
  const dragging = useRef(false);

  const start = () => {
    if (dragging.current) return;
    dragging.current = true;
    beginInteraction();
  };
  const preview = (v: number) => {
    start();
    live(recipe(v));
  };
  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    commitInteraction();
  };
  // A panel closing mid-drag — or the window losing focus before pointerup —
  // must not leave `interactionBase` set forever: TreeCanvas/EventLayer read it
  // as "a gesture is in progress" and would keep serving the pre-drag collision
  // plan for every later render.
  useEffect(() => {
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      useStore.getState().commitInteraction();
    };
    window.addEventListener('blur', end);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    document.addEventListener('visibilitychange', end);
    return () => {
      window.removeEventListener('blur', end);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.removeEventListener('visibilitychange', end);
      end();
    };
  }, []);

  // The slider needs concrete bounds; callers that leave the typed number
  // unbounded (label offsets) pass a narrower sliderMin/sliderMax instead.
  const sMin = sliderMin ?? min ?? 0;
  const sMax = sliderMax ?? max ?? Math.max(sMin + 1, 100);
  const sliderValue = Number.isFinite(value) ? Math.min(sMax, Math.max(sMin, value)) : sMin;
  return (
    <div className="slider-number-field">
      <NumberField
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        unitTitle={unitTitle}
        ariaLabel={ariaLabel}
        onCommit={(v) => {
          if (v !== undefined) apply(recipe(v));
        }}
      />
      <input
        type="range"
        min={sMin}
        max={sMax}
        step={step}
        value={sliderValue}
        aria-label={ariaLabel ? `${ariaLabel} ${tr('滑块', 'slider')}` : undefined}
        onPointerDown={start}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={start}
        onKeyUp={finish}
        onBlur={finish}
        onChange={(e) => preview(parseFloat(e.target.value))}
      />
    </div>
  );
}
