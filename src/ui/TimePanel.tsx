// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Left "时间 Time" module: everything about TIME DATA — units, geological-era
// overlay toggle, age estimation, environmental-context events and fossil
// calibration points. These are document data, not styling, which is why they
// form their own single-purpose module instead of sitting in the 样式 layout
// module.
//
// STATE MACHINE: The panel implements a data-schema gate. Time
// features (era overlay, environmental events, calibration points) are only
// enabled when the tree carries time-calibration data (node ages or
// calibration points). On a purely topological tree the panel shows a warning
// and disables the time-consuming controls, preventing "orphan" time data.

import { useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, Cross1Icon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  hasEstimatedAges,
  addEnvironmentalEvent,
  removeEnvironmentalEvent,
  updateEnvironmentalEvent,
  addCalibrationPoint,
  removeCalibrationPoint,
  updateCalibrationPoint,
  isTimeCalibrated,
  validateTimeData,
  nodesMissingAges,
  newId,
  unpinAll,
} from '../model/treeOps';
import type { Project } from '../model/types';

/** Dropdown options = recognised geological units, in formal case. */
const TIME_UNIT_OPTIONS = ['ma', 'myr', 'ka', 'kyr', 'ga', 'gyr', 'yr'];

function shortTimeUnitLabel(unit: string): string {
  switch (unit) {
    case 'ma':
      return 'Ma';
    case 'myr':
      return 'Myr';
    case 'ka':
      return 'ka';
    case 'kyr':
      return 'kyr';
    case 'ga':
      return 'Ga';
    case 'gyr':
      return 'Gyr';
    case 'yr':
      return 'yr';
    default:
      return unit;
  }
}
import type { EraLevel } from '../layout/timescale';
import {
  ColorField,
  Field,
  NumberField,
  SwitchField,
  TextField,
} from './fields';
import { Section } from './Section';
import { IconSwap } from './IconSwap';
import { S, tr } from './strings';
import { timeUnitSymbol } from './units';
import { notify } from './toast';
// Shared, never-empty layout display name (BUG-5 defense: an unknown or blank
// `layout.type` must never render as 「current layout is “”」).
import { layoutTypeName } from './layoutTypeName';
import { enterTimeChartLayout, rememberErasToggle } from './timeChartEras';

type Apply = (recipe: (d: Project) => void) => void;

// Timeline environmental-context events (climate, drift, mass extinction, …).
// M4 (review finding 6): each row used to spread its colour + label + delete +
// from + to + unit across TWO always-visible lines in a ~280 px panel — the
// numeric row was cramped to the point of clipping. Each row now has a
// collapsed state (colour + label + one-line range summary + delete) and an
// expandable numeric editor.
function EnvEvents({ project, apply, disabled }: { project: Project; apply: Apply; disabled: boolean }) {
  const events = project.environmentalEvents;
  const unit = timeUnitSymbol(project.layout.timeUnit ?? 'Ma');
  return (
    <div className="env-events">
      {events.length === 0 && <div className="hint">{S.layoutPanel.envEmpty}</div>}
      {events.map((e) => (
        <EnvItem key={e.id} event={e} unit={unit} apply={apply} disabled={disabled} />
      ))}
      <button
        className="link-btn"
        disabled={disabled}
        onClick={() =>
          apply((d) =>
            addEnvironmentalEvent(d, {
              id: newId(),
              label: S.layoutPanel.envSection,
              from: 0,
              to: 0,
              // `<input type="color">` only accepts #rrggbb; a CSS variable
              // fell back to black inside the picker while the canvas drew the
              // resolved amber. `--amber-11` in the light theme is #ab6400 —
              // the same hue, stored as a value every colour field accepts.
              color: '#ab6400',
            }),
          )
        }
      >
        {S.layoutPanel.envAdd}
      </button>
    </div>
  );
}

/** One collapsible environmental-event row (see EnvEvents for the rationale). */
function EnvItem({
  event,
  unit,
  apply,
  disabled,
}: {
  event: Project['environmentalEvents'][number];
  unit: string;
  apply: Apply;
  disabled: boolean;
}) {
  // Collapsed by default: the summary answers "what and when"; expanding is
  // only needed when the numbers themselves change.
  const [open, setOpen] = useState(false);
  // 用户反馈: always show the RANGE, never a bare single age — an event's time
  // is an interval (a point event is the degenerate from === to case).
  const summary = `${event.from}–${event.to} ${unit}`;
  return (
    <div className="env-item">
      <div className="env-row">
        {/* A raw `<input type="color" onChange={apply}>` would push one undo
            step per pixel of the native picker's drag; ColorField coalesces a
            drag into one step. */}
        <ColorField
          value={event.color}
          disabled={disabled}
          ariaLabel={tr('环境事件颜色', 'Environmental event colour')}
          onChange={(v) =>
            apply((d) => updateEnvironmentalEvent(d, event.id, { color: v }))
          }
        />
        <TextField
          value={event.label}
          ariaLabel={S.layoutPanel.envSection}
          onCommit={(v) => apply((d) => updateEnvironmentalEvent(d, event.id, { label: v }))}
        />
        <span
          className="env-summary"
          title={tr(
            '时间范围（与节点年龄相同的时间单位）',
            'Time range (same unit as the node ages)',
          )}
        >
          {summary}
        </span>
        <button
          className="btn icon"
          title={open ? tr('收起', 'Collapse') : tr('展开编辑时间范围', 'Edit the time range')}
          aria-label={open ? tr('收起', 'Collapse') : tr('展开编辑时间范围', 'Edit the time range')}
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          <IconSwap active={open} on={<ChevronDownIcon />} off={<ChevronRightIcon />} />
        </button>
        <button
          className="btn icon ghost-danger"
          title={S.layoutPanel.envDelete}
          aria-label={S.layoutPanel.envDelete}
          disabled={disabled}
          onClick={() => apply((d) => removeEnvironmentalEvent(d, event.id))}
        >
          <Cross1Icon />
        </button>
      </div>
      {open && (
        <div className="env-row">
          <label>{S.layoutPanel.envFrom}</label>
          {/* One shared unit chip instead of one per field: two chips in a
              ~200 px row squeezed each input below two-digit width, so "34"
              rendered as "3" plus a clipped digit. The unit is the project's
              time unit, the same axis the node ages are read on. */}
          <NumberField
            value={event.from}
            step={0.1}
            validate={(v) =>
              v > event.to
                ? tr('起始不能晚于结束（From ≤ To）', 'Start cannot be after the end (From ≤ To)')
                : null
            }
            onCommit={(v) => v !== undefined && apply((d) => updateEnvironmentalEvent(d, event.id, { from: v }))}
          />
          <label>{S.layoutPanel.envTo}</label>
          <NumberField
            value={event.to}
            step={0.1}
            validate={(v) =>
              v < event.from
                ? tr('结束不能早于起始（From ≤ To）', 'End cannot be before the start (From ≤ To)')
                : null
            }
            onCommit={(v) => v !== undefined && apply((d) => updateEnvironmentalEvent(d, event.id, { to: v }))}
          />
          <span
            className="number-unit"
            title={tr(
              '与节点年龄相同的时间单位（可在本模块「时间单位」中修改）',
              'The same time unit as the node ages (change it under “Time unit” in this module)',
            )}
          >
            {unit}
          </span>
        </div>
      )}
    </div>
  );
}

// Fossil calibration point manager for time-calibrated layouts.
function CalibrationPoints({ project, apply, disabled }: { project: Project; apply: Apply; disabled: boolean }) {
  const points = project.calibrationPoints;
  const internalNodes = Object.values(project.nodes).filter((n) => n.childrenIds.length > 0);
  return (
    <div className="env-events">
      {points.length === 0 && <div className="hint">{S.layoutPanel.calibrationEmpty}</div>}
      {points.map((c) => (
        <div className="env-item" key={c.id}>
          <div className="env-row">
            {/* S09 (Sonus): the node picker needs a programmatic name — four
                calibration selects read as four identical unnamed menus. */}
            <select
              value={c.nodeId}
              disabled={disabled}
              aria-label={`${S.layoutPanel.calibrationNode} #${points.indexOf(c) + 1}`}
              onChange={(e) => apply((d) => updateCalibrationPoint(d, c.id, { nodeId: e.target.value }))}
            >
              {internalNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || n.id.slice(0, 6)}
                </option>
              ))}
            </select>
            <button
              className="btn icon ghost-danger"
              title={S.layoutPanel.calibrationDelete}
              aria-label={`${S.layoutPanel.calibrationDelete} #${points.indexOf(c) + 1}`}
              disabled={disabled}
              onClick={() => apply((d) => removeCalibrationPoint(d, c.id))}
            >
              <Cross1Icon />
            </button>
          </div>
          {/* S05 (Sonus): one flex row squeezed both number inputs to 14px —
              unreadable. Object on one row, min/max as two stacked columns;
              the unit chip stays with each field. */}
          <div className="cal-age-grid">
            <label className="cal-age-cell">
              <span className="cal-age-label">{S.layoutPanel.calibrationMin}</span>
              <NumberField
                value={c.minAge}
                step={0.1}
                unit={timeUnitSymbol(project.layout.timeUnit ?? 'Ma')}
                validate={(v) =>
                  v > c.maxAge
                    ? tr('最小年龄不能大于最大年龄', 'Minimum age cannot exceed maximum age')
                    : null
                }
                onCommit={(v) => v !== undefined && apply((d) => updateCalibrationPoint(d, c.id, { minAge: v }))}
              />
            </label>
            <label className="cal-age-cell">
              <span className="cal-age-label">{S.layoutPanel.calibrationMax}</span>
              <NumberField
                value={c.maxAge}
                step={0.1}
                unit={timeUnitSymbol(project.layout.timeUnit ?? 'Ma')}
                validate={(v) =>
                  v < c.minAge
                    ? tr('最大年龄不能小于最小年龄', 'Maximum age cannot be less than minimum age')
                    : null
                }
                onCommit={(v) => v !== undefined && apply((d) => updateCalibrationPoint(d, c.id, { maxAge: v }))}
              />
            </label>
          </div>
        </div>
      ))}
      <button
        className="link-btn"
        disabled={disabled}
        onClick={() => {
          const firstInternal = internalNodes[0];
          if (!firstInternal) return;
          apply((d) =>
            addCalibrationPoint(d, {
              id: newId(),
              nodeId: firstInternal.id,
              minAge: 0,
              maxAge: 100,
            }),
          );
        }}
      >
        {S.layoutPanel.calibrationAdd}
      </button>
    </div>
  );
}

export function TimePanel() {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const requestFit = useStore((s) => s.requestFit);
  const showEras = useStore((s) => s.showEras);
  const setShowEras = useStore((s) => s.setShowEras);
  const eraLevel = useStore((s) => s.eraLevel);
  const setEraLevel = useStore((s) => s.setEraLevel);
  // A14: the canvas overlay toggle for calibration intervals.

  // "Custom…" is a MODE, not a value: selecting it must keep the input on
  // screen. Deriving the select's value purely from `timeUnit` made choosing
  // 自定义… write `'Ma'` and then immediately hide the very field it was meant
  // to reveal (the stored unit was a preset again). This flag survives until
  // the user picks a preset or commits a custom value.
  const [customUnitMode, setCustomUnitMode] = useState(false);
  const storedUnit = project.layout.timeUnit ?? 'Ma';
  const storedIsPreset = TIME_UNIT_OPTIONS.includes(storedUnit.toLowerCase());
  // P-07: choosing Custom… opens an EMPTY input. It used to be pre-filled with
  // the current preset ('ma'), which read as an already-applied custom unit and
  // left the user unsure whether typing anything had an effect.
  const [customDraft, setCustomDraft] = useState('');
  useEffect(() => {
    if (customUnitMode) setCustomDraft('');
    else setCustomDraft(storedUnit);
  }, [customUnitMode, storedUnit]);
  const showCustomField = !storedIsPreset || customUnitMode;

  // STATE MACHINE: check whether the tree carries time-calibration data.
  const timeReady = isTimeCalibrated(project);
  // Validate time-data consistency (parent ages >= child ages, etc.).
  const timeIssues = timeReady ? validateTimeData(project) : [];

  // Layered status: detect nodes missing ages when the time-calibrated layout
  // is active (or when time data exists but the layout is wrong). The missing
  // nodes are only relevant in the time-calibrated layout because that is the
  // only layout that reads `age`.
  const isTimeLayout = project.layout.type === 'time-calibrated';
  const missingNodes = isTimeLayout ? nodesMissingAges(project) : [];

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.time}</span>
              </div>

      {/* --- Layered status hints --- */}
      {/* Case 0: no time data at all — show the "not calibrated" warning. */}
      {!timeReady && (
        <div className="panel-note">
          <div className="panel-note-title">{S.layoutPanel.timeNotCalibrated}</div>
          <div className="hint">{S.layoutPanel.timeNotCalibratedHint}</div>
        </div>
      )}
      {/* Case 1: time data exists but the layout is not the geological time
          chart — offer a one-click switch so the remedy is at hand here. */}
      {timeReady && !isTimeLayout && (
        <div className="time-warning">
          <div className="time-warning-title">
            {S.layoutPanel.timeDataButWrongLayout(layoutTypeName(project.layout.type))}
          </div>
          <div className="field row-actions">
            <button
              className="btn"
              onClick={() => {
                // Same heads-up as the 样式 module's layout selector: nodes
                // without ages will silently land at present (0).
                const missing = nodesMissingAges(project).length;
                apply((d) => {
                  d.layout.type = 'time-calibrated';
                  unpinAll(d);
                });
                if (missing > 0) notify.info(S.notify.missingAgesToast(missing));
                requestFit();
                // BUG-7: entering the time chart through this button is one of the
                // explicit switch entry points, so it gets the same first-entry
                // behaviour as the 样式 selector (auto-enable era bands once + the
                // one-time hint; a remembered opt-out is honoured).
                enterTimeChartLayout();
                // The toast wording for this button is the clicked variant, not
                // 「已自动切换」: the layout changes because it was clicked, never on
                // its own.
                notify.success(
                  tr('已切换到时间校准树布局', 'Switched to the time-calibrated tree layout'),
                );
              }}
            >
              {S.layoutPanel.switchToTimeChart}
            </button>
          </div>
        </div>
      )}
      {/* Time-data consistency issues (shown alongside the missing-ages warning). */}
      {timeReady && timeIssues.length > 0 && (
        <div className="time-warning">
          <div className="time-warning-title">{S.notify.timeDataInconsistent(timeIssues.length)}</div>
          <ul className="time-issue-list">
            {timeIssues.map((issue, i) => (
              <li key={i} className="hint">{issue}</li>
            ))}
          </ul>
        </div>
      )}
      {/* Case 3: everything is fine — time data present, no issues, no missing ages. */}
      {timeReady && timeIssues.length === 0 && isTimeLayout && missingNodes.length === 0 && (
        <div className="hint time-ok">{S.layoutPanel.timeCalibrated}</div>
      )}
      {/* 用户反馈：the section starts COLLAPSED like every other submodule of
          the merged panel. */}
      <Section title={S.layoutPanel.timeSection} defaultOpen={false} pinable scope={project.id}>
        <Field label={S.layoutPanel.timeUnit}>
          {/* Known units become a dropdown; the custom entry stays available
              for exotic units. */}
          <select
            value={
              customUnitMode || !storedIsPreset
                ? 'custom'
                : storedUnit.toLowerCase()
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                setCustomUnitMode(true);
                return;
              }
              setCustomUnitMode(false);
              apply((d) => void (d.layout.timeUnit = v));
            }}
          >
            {TIME_UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {shortTimeUnitLabel(u)}
              </option>
            ))}
            <option value="custom">{tr('自定义…', 'Custom…')}</option>
          </select>
        </Field>
        {showCustomField && (
          <Field label={tr('自定义单位', 'Custom unit')}>
            <TextField
              value={customDraft}
              placeholder={tr('例如 kya、Myr', 'e.g. kya, Myr')}
              onCommit={(v) => {
                setCustomUnitMode(false);
                const next = v.trim();
                if (next !== '') apply((d) => void (d.layout.timeUnit = next));
              }}
            />
            {/* P-07: the axis updates on commit — say so instead of leaving the
                user to guess why typing alone did nothing. */}
            <div className="hint">
              {tr(
                '输入单位标签后按 Enter 或点击别处生效；例如 kya。',
                'Press Enter or click away to apply the unit label, e.g. kya.',
              )}
            </div>
          </Field>
        )}
        <SwitchField
          label={S.layoutPanel.showEras}
          checked={showEras}
          disabled={!timeReady}
          onChange={(v) => {
            // An EXPLICIT choice is remembered across sessions (BUG-7
            // follow-up); the automatic first-entry enable records nothing.
            rememberErasToggle(v);
            setShowEras(v);
            if (v) requestFit();
          }}
        />
        <Field label={S.layoutPanel.eraLevelLabel}>
          <select
            value={eraLevel}
            disabled={!timeReady || !showEras}
            onChange={(e) => {
              setEraLevel(e.target.value as EraLevel);
              requestFit();
            }}
          >
            <option value="eon">{S.layoutPanel.eraLevelEon}</option>
            <option value="era">{S.layoutPanel.eraLevelEra}</option>
            <option value="period">{S.layoutPanel.eraLevelPeriod}</option>
            <option value="both">{S.layoutPanel.eraLevelBoth}</option>
          </select>
        </Field>
        {/* `hasEstimatedAges` marks every node the estimator wrote, so
            the panel keeps saying "these ages are inferred" after the toast is
            gone instead of the values quietly becoming facts. */}
        {hasEstimatedAges(project) && (
          <div className="hint" style={{ marginBottom: 8 }}>
            {S.layoutPanel.agesAreEstimated}
          </div>
        )}
      </Section>
      <Section title={S.layoutPanel.envSection} defaultOpen={false} pinable scope={project.id}>
        <EnvEvents project={project} apply={apply} disabled={!timeReady} />
      </Section>

      <Section title={S.layoutPanel.calibrationSection} defaultOpen={false} pinable scope={project.id}>
        {/* 用户反馈: the hint paragraph is gone — the manager stays usable on a
            purely topological tree so the first calibration can be added at
            all; once one exists, `timeReady` flips true and the other controls
            unlock. */}
        <CalibrationPoints project={project} apply={apply} disabled={false} />
      </Section>
    </>
  );
}
