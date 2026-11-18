// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
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

export function Field({
  label,
  title,
  children,
  stacked,
}: {
  label: string;
  /** Hover text for a label that had to be shortened for a narrow panel. */
  title?: string;
  children: ReactNode;
  /** Put the label above the control when the control needs the full width
   *  (a select whose longest option is wider than a two-column row). */
  stacked?: boolean;
}) {
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
    <div className={stacked ? 'field stacked' : 'field'}>
      <label {...(hostChild ? { htmlFor: id } : {})} title={title}>{label}</label>
      {childWithId}
    </div>
  );
}

// Checkbox field: left-aligned checkbox + label.
// Does NOT reuse the space-between Field layout — checkboxes should follow
// the universal convention of control-on-left.
export function CheckboxField({
  label,
  title,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  /** Hover text for a label that had to be shortened for a narrow panel. */
  title?: string;
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
      <label htmlFor={id} title={title}>
        {label}
      </label>
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

  const HEX_RE = /^#?([0-9a-fA-F]{6})$/;
  const normalize = (v: string) => `#${v.replace('#', '').toLowerCase()}`;
  const textInputRef = useRef<HTMLInputElement | null>(null);
  // P-14: an invalid value that already lives in the document used to be fed
  // straight to <input type="color">, which sanitises it to #000000 — the next
  // picker interaction then committed BLACK over the stored value. Show a safe
  // white swatch instead and say why; typed-invalid drafts still revert.
  const storedInvalid = !HEX_RE.test(value);

  return (
    <div className="color-field">
      <input
        type="color"
        aria-label={ariaLabel}
        value={HEX_RE.test(draft) ? normalize(draft) : storedInvalid ? '#ffffff' : value}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          schedule(e.target.value);
        }}
        onPointerUp={flush}
        onBlur={flush}
      />
      {/* 用户反馈：a rounded box that ACCEPTS a typed hex code, not just a
          readout. Any 6-digit hex (with or without `#`) commits through the
          same debounced path as the picker; anything else is left as an
          unfinished draft and reverts on blur. */}
      <input
        ref={textInputRef}
        type="text"
        className="color-hex color-hex-input"
        value={draft}
        disabled={disabled}
        spellCheck={false}
        aria-label={ariaLabel ? `${ariaLabel} (hex)` : tr('颜色十六进制代码', 'Colour hex code')}
        aria-invalid={storedInvalid || undefined}
        title={
          storedInvalid
            ? tr(
                '存储的颜色值不是有效的 #rrggbb，色板按白色显示；重新选择颜色即可覆盖。',
                'The stored colour is not a valid #rrggbb; the swatch shows white. Pick a colour to replace it.',
              )
            : undefined
        }
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          if (HEX_RE.test(v.trim())) schedule(normalize(v.trim()));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') textInputRef.current?.blur();
        }}
        onBlur={() => {
          flush();
          if (!HEX_RE.test(draft.trim())) setDraft(value);
        }}
      />
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
  onChange,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  /**
   * Optional LIVE mirror of the draft (GUI-B BUG-07). The buffered commit is
   * for document edits that must not flood the undo history; a form field
   * whose only consumer is a button's enabled state needs the current text
   * immediately — including a single paste / password-manager fill, which
   * produces one `input` event and no blur.
   */
  onChange?: (v: string) => void;
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
      onChange={(e) => {
        setV(e.target.value);
        onChange?.(e.target.value);
      }}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        // Enter belongs to the IME while a candidate list is open.
        if (e.key === 'Enter' && !isImeComposing(e)) (e.target as HTMLInputElement | null)?.blur();
      }}
    />
  );
}

/**
 * Multi-line sibling of `TextField` (review finding 5 / M3): a hypothesis CLAIM
 * or falsifiable PREDICTION is prose — a sentence or three — and a single-line
 * input hid all but the head of it. Same buffered-commit contract as TextField
 * (blur or Enter), same IME guard; Shift+Enter inserts a newline instead of
 * committing, which is the multi-line convention.
 */
export function TextAreaField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  rows = 3,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      className="textarea-field"
      rows={rows}
      value={v}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement | null)?.blur();
        }
      }}
    />
  );
}

// Numeric field with inline range validation: values outside [min,max]
// show an inline error and are NOT committed, so illegal data (negative ages,
// out-of-range support values) can't silently enter the document.
//
// `unit` is a VISIBLE decoration next to the input, not a placeholder: the
// inspector used to rely on `placeholder="Ma"`, which vanishes the moment the
// field has a value — i.e. exactly when the user is reading the number. The
// decoration is optional (callers that pass nothing get the previous layout),
// can sit before or after the input, and carries a tooltip/spoken description
// (`unitTitle`) for units whose symbol is not self-explanatory ("Ma = Mya").
// A pasted "35 Ma" / "0.5 %" is reduced to its numeric part: the unit lives in
// the decoration, so it must not be able to reject a copy-paste.
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  allowEmpty = false,
  disabled,
  unit,
  unitTitle,
  unitSide = 'suffix',
  hint,
  ariaLabel,
  validate,
}: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  /** Renders the input inert (dimmed by `.field input:disabled`). Used when the
   *  value only makes sense for a selection that does not exist right now. */
  disabled?: boolean;
  /**
   * Cross-field / cross-record check run AFTER the single-field min/max gate.
   * P-10: a calibration Min above Max, or an environmental From after To, must
   * be refused with a visible reason instead of silently drawing an inverted
   * interval. Return null (or omit) when the value is acceptable.
   */
  validate?: (v: number) => string | null;
  /** Visible unit decoration (e.g. "Ma", "px", "s/s"). Optional. */
  unit?: string;
  /** Hover/spoken expansion of the unit (e.g. "million years ago (Ma = Mya)"). */
  unitTitle?: string;
  /** Which side of the input the unit decoration is rendered on. */
  unitSide?: 'prefix' | 'suffix';
  /** Placeholder shown only while the field is empty (e.g. "0–1 or 0–100"). */
  hint?: string;
  /** Accessible name; `Field` supplies the row label automatically. */
  ariaLabel?: string;
}) {
  const [v, setV] = useState(value === undefined ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setV(value === undefined ? '' : String(value)), [value]);
  // Described-by target for the visible unit, so a screen reader announces
  // "Age, 35, Ma" instead of dropping the decoration as decoration-only.
  const unitId = useId();

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
      // F-ISSUE-02: a refused draft used to stay in the box, so an out-of-range
      // number read as "accepted". Restore the stored value — the field must
      // never display a number the document does not hold.
      setV(value === undefined ? '' : String(value));
      return;
    }
    if (max !== undefined && n > max) {
      setError(tr(`最大值为 ${max}`, `Maximum is ${max}`));
      setV(value === undefined ? '' : String(value));
      return;
    }
    const cross = validate?.(n);
    if (cross) {
      setError(cross);
      return;
    }
    setError(null);
    onCommit(n);
  };

  const unitNode = unit ? (
    <span className="number-unit" id={unitId} title={unitTitle ?? unit}>
      {unit}
    </span>
  ) : null;

  return (
    <div className="number-wrap">
      <div className={`number-input-row${unitSide === 'prefix' ? ' unit-prefix' : ''}`}>
        {unitSide === 'prefix' && unitNode}
        <input
          type="number"
          aria-label={ariaLabel}
          aria-describedby={unit ? unitId : undefined}
          title={unitTitle}
          value={v}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          placeholder={hint}
          className={error ? 'has-error' : undefined}
          onChange={(e) => {
            setV(e.target.value);
            if (error) setError(null);
          }}
          onPaste={(e) => {
            // "35 Ma", "0.5 %", "12px" → the numeric part only; a number input
            // would otherwise reject the whole paste and silently clear it.
            const text = e.clipboardData?.getData('text') ?? '';
            const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*(?:[A-Za-z%°µ][\w./²³ ]*)?\s*$/.exec(text);
            if (!m) return;
            e.preventDefault();
            setV(m[1]);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isImeComposing(e)) (e.target as HTMLInputElement | null)?.blur();
          }}
        />
        {unitSide !== 'prefix' && unitNode}
      </div>
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
    // A numeric readout next to the slider (M15): the ASR threshold's current
    // value used to be findable only by scanning a sentence of hint text.
    // `width:100%` made this wrapper demand the row's full width even beside a
    // label, so the readout was pushed past the dialog's right edge; as a
    // shrinking flex item it shares the row instead.
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '1 1 auto', minWidth: 0 }}>
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
        style={{ flex: 1 }}
      />
      <span className="field-value" style={{ minWidth: 44, textAlign: 'right', fontSize: 12 }}>
        {Number.isInteger(step) ? v : v.toFixed(2)}
      </span>
    </span>
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
      <option value="curved">{S.branchShape.curved}</option>
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
