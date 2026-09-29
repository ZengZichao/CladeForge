// Shared inspector form controls.
//
// These small buffered inputs are used by both the left-hand LayoutPanel
// (global defaults) and the right-hand PropertiesPanel (per-object overrides).
// Text / number fields buffer locally and commit on blur or Enter so typing
// does not flood the undo history. Enter is ignored while an IME composition is
// open, otherwise confirming a Pinyin candidate would submit the
// half-written string. Colour fields coalesce a picker drag into ONE commit:
// every intermediate frame would otherwise be its own undo step, so dragging a
// colour once would burn dozens of the 100 history slots.

import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Cross1Icon } from '@radix-ui/react-icons';
import { type BranchShape, type DashStyle } from '../model/types';
import { isImeComposing } from './imeGuard';
import { S, tr } from './strings';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  // `id` can only be attached to a host element. A component child (TextField,
  // …) ignores it, and emitting `htmlFor` anyway leaves the label pointing at
  // an element that does not exist — which Chrome reports as "incorrect use of
  // <label for=…>". Those children have to carry `aria-label` themselves.
  let hostChild = false;
  const childWithId = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && typeof child.type !== 'string') {
      // A component child renders its own control, so `id` cannot reach it and
      // `htmlFor` would dangle. Give it the field's label as its accessible name
      // instead — unless it already declares one. Without this, every
      // `<Field><ColorField/></Field>` pair would be a nameless input: only
      // `TextField` takes an explicit `ariaLabel`.
      const props = child.props as Record<string, unknown>;
      if (props.ariaLabel === undefined && props['aria-label'] === undefined) {
        return React.cloneElement(child, { ariaLabel: label } as never);
      }
      return child;
    }
    if (!React.isValidElement(child)) return child;
    hostChild = true;
    const props = { id } as Record<string, string>;
    return React.cloneElement(child, props);
  });
  return (
    <div className="field">
      <label {...(hostChild ? { htmlFor: id } : {})}>{label}</label>
      {childWithId}
    </div>
  );
}

// Checkbox field: left-aligned checkbox + label.
// Does NOT reuse the space-between Field layout — checkboxes should follow
// the universal convention of control-on-left.
export function CheckboxField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field check">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

// Color field with inline hex value display.
//
// `onChange` keeps its name but its cadence is deliberate: a native colour
// picker emits an `input` event for every pixel of the drag, and each one would
// otherwise become an undo step (`ns({ fill: v })` → `apply`). Values are buffered
// and flushed once the drag settles (trailing debounce, blur, pointerup, or the
// host unmounting), so one interaction records one step. The swatch and the hex
// readout stay live.
//
// Every panel that colours something goes through this component — the inspector,
// the 性状 state swatches and gradient ends, and the 时间 environmental events.
// A raw `<input type="color" onChange={apply}>` at any of those call sites
// re-opens the flood: it is not a style preference, it is the undo budget.
const COLOR_COMMIT_MS = 250;
export function ColorField({
  value,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest picker value, read by the deferred flush (the timeout's closure would
  // otherwise see the `draft` of the render that scheduled it).
  const pending = useRef(value);
  useEffect(() => setDraft(value), [value]);
  // Read at flush time, not captured: the deferred commit must compare against the
  // value the parent holds NOW, and call the parent's current `onChange`.
  const live = useRef({ value, onChange });
  useEffect(() => {
    live.current = { value, onChange };
  });

  const commit = (v: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (v !== live.current.value) live.current.onChange(v);
  };
  const flush = () => commit(pending.current);
  const schedule = (v: string) => {
    pending.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current !== live.current.value) live.current.onChange(pending.current);
    }, COLOR_COMMIT_MS);
  };
  // A debounce that dies with the field would also eat the colour: closing the
  // character editor (or flipping its type, which replaces the swatch rows) inside
  // the trailing window would discard the pick the user just made. Only an
  // outstanding timer flushes, so a field that merely unmounted commits nothing.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        if (pending.current !== live.current.value) live.current.onChange(pending.current);
      }
    },
    [],
  );

  return (
    <div className="color-field">
      <input
        type="color"
        aria-label={ariaLabel}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          schedule(e.target.value);
        }}
        onPointerUp={flush}
        onBlur={flush}
      />
      <span className="color-hex">{draft}</span>
    </div>
  );
}

// Dismissible hint: shown until the user closes it; state persisted to
// localStorage so it stays dismissed across sessions.
const LS_HINT_PREFIX = 'cladeforge:hint:';
export function DismissibleHint({ id, children }: { id: string; children: ReactNode }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(LS_HINT_PREFIX + id) === 'true';
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <div className="hint-row">
      <div className="hint">{children}</div>
      <button
        className="hint-close"
        title={tr("关闭提示","Dismiss hint")}
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(LS_HINT_PREFIX + id, 'true');
          } catch {
            /* ignore */
          }
        }}
      >
        <Cross1Icon />
      </button>
    </div>
  );
}

export function TextField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  /**
   * Accessible name. `placeholder` is not one (a screen reader drops it as soon
   * as the field has content, and Chrome flags placeholder-only fields), and a
   * <Field> wrapper cannot supply its own label here because the id would have
   * to be forwarded through this component.
   */
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type="text"
      value={v}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        // Enter belongs to the IME while a candidate list is open.
        if (e.key === 'Enter' && !isImeComposing(e)) (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

// Numeric field with inline range validation: values outside [min,max]
// show an inline error and are NOT committed, so illegal data (negative ages,
// out-of-range support values) can't silently enter the document.
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  allowEmpty = false,
  unit,
  ariaLabel,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  /** Optional unit suffix shown as a placeholder hint (e.g. "0–1"). */
  unit?: string;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value === undefined ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setV(value === undefined ? '' : String(value)), [value]);

  const commit = () => {
    if (v === '') {
      setError(null);
      if (allowEmpty) onCommit(undefined);
      return;
    }
    const n = parseFloat(v);
    if (!Number.isFinite(n)) {
      setError(tr('请输入有效数值','Enter a valid number'));
      return;
    }
    if (min !== undefined && n < min) {
      setError(tr(`最小值为 ${min}`, `Minimum is ${min}`));
      return;
    }
    if (max !== undefined && n > max) {
      setError(tr(`最大值为 ${max}`, `Maximum is ${max}`));
      return;
    }
    setError(null);
    onCommit(n);
  };

  return (
    <div className="number-wrap">
      <input
        type="number"
        aria-label={ariaLabel}
        value={v}
        min={min}
        max={max}
        step={step}
        aria-invalid={error ? true : undefined}
        placeholder={unit}
        className={error ? 'has-error' : undefined}
        onChange={(e) => {
          setV(e.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isImeComposing(e)) (e.target as HTMLInputElement).blur();
        }}
      />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function RangeField({
  value,
  onCommit,
  min,
  max,
  step,
  ariaLabel,
}: {
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step: number;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={v}
      onChange={(e) => setV(parseFloat(e.target.value))}
      onPointerUp={() => onCommit(v)}
      onBlur={() => onCommit(v)}
    />
  );
}

export function DashSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: DashStyle;
  onChange: (v: DashStyle) => void;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as DashStyle)}
    >
      <option value="solid">{S.dash.solid}</option>
      <option value="dashed">{S.dash.dashed}</option>
      <option value="dotted">{S.dash.dotted}</option>
    </select>
  );
}

export function BranchShapeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: BranchShape;
  onChange: (v: BranchShape) => void;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as BranchShape)}
    >
      <option value="line">{S.branchShape.line}</option>
      <option value="rectangular">{S.branchShape.rectangular}</option>
      <option value="rounded">{S.branchShape.rounded}</option>
    </select>
  );
}

/** Numeric CSS font-weight picker (300–900). */
export function FontWeightSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      <option value={300}>{S.fontWeightOpts.light}</option>
      <option value={400}>{S.fontWeightOpts.normal}</option>
      <option value={500}>{S.fontWeightOpts.medium}</option>
      <option value={600}>{S.fontWeightOpts.semibold}</option>
      <option value={700}>{S.fontWeightOpts.bold}</option>
      <option value={900}>{S.fontWeightOpts.black}</option>
    </select>
  );
}
