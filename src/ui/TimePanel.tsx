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

import { Cross1Icon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  estimateAges,
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
import type { LayoutType, Project } from '../model/types';
import type { EstimateAgesResult } from '../model/treeOps';
import { estimateAgesText } from './treeEditNotices';
import type { EraLevel } from '../layout/timescale';
import {
  CheckboxField,
  ColorField,
  DismissibleHint,
  Field,
  NumberField,
  TextField,
} from './fields';
import { Section } from './Section';
import { S, tr } from './strings';
import { notify } from './toast';

/** Human-readable name for a layout type, locale-aware. */
function layoutTypeName(type: LayoutType): string {
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
      return type;
  }
}

/** Build a comma-separated list of missing-age node names (max 5, then "…N more"). */
function missingAgeNames(names: string[]): string {
  const shown = names.slice(0, 5);
  const rest = names.length - shown.length;
  const parts = shown.join(', ');
  if (rest > 0) {
    return `${parts} ${S.layoutPanel.missingAgesMore(rest)}`;
  }
  return parts;
}

type Apply = (recipe: (d: Project) => void) => void;

// Timeline environmental-context events (climate, drift, mass extinction, …).
function EnvEvents({ project, apply, disabled }: { project: Project; apply: Apply; disabled: boolean }) {
  const events = project.environmentalEvents;
  return (
    <div className="env-events">
      {events.length === 0 && <div className="hint">{S.layoutPanel.envEmpty}</div>}
      {events.map((e) => (
        <div className="env-item" key={e.id}>
          <div className="env-row">
            {/* A raw `<input type="color" onChange={apply}>` would push one undo
                step per pixel of the native picker's drag; ColorField coalesces a
                drag into one step. */}
            <ColorField
              value={e.color}
              disabled={disabled}
              ariaLabel={tr('环境事件颜色', 'Environmental event colour')}
              onChange={(v) =>
                apply((d) => updateEnvironmentalEvent(d, e.id, { color: v }))
              }
            />
            <TextField
              value={e.label}
              ariaLabel={S.layoutPanel.envSection}
              onCommit={(v) => apply((d) => updateEnvironmentalEvent(d, e.id, { label: v }))}
            />
            <button
              className="btn icon danger"
              title={S.character.deleteCharacter}
              disabled={disabled}
              onClick={() => apply((d) => removeEnvironmentalEvent(d, e.id))}
            >
              <Cross1Icon />
            </button>
          </div>
          <div className="env-row">
            <label>{S.layoutPanel.envFrom}</label>
            <NumberField
              value={e.from}
              step={0.1}
              onCommit={(v) => v !== undefined && apply((d) => updateEnvironmentalEvent(d, e.id, { from: v }))}
            />
            <label>{S.layoutPanel.envTo}</label>
            <NumberField
              value={e.to}
              step={0.1}
              onCommit={(v) => v !== undefined && apply((d) => updateEnvironmentalEvent(d, e.id, { to: v }))}
            />
          </div>
        </div>
      ))}
      <button
        className="btn"
        disabled={disabled}
        onClick={() =>
          apply((d) =>
            addEnvironmentalEvent(d, {
              id: newId(),
              label: S.layoutPanel.envSection,
              from: 0,
              to: 0,
              color: '#f59e0b',
            }),
          )
        }
      >
        {S.layoutPanel.envAdd}
      </button>
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
            <select
              value={c.nodeId}
              disabled={disabled}
              onChange={(e) => apply((d) => updateCalibrationPoint(d, c.id, { nodeId: e.target.value }))}
            >
              {internalNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label || n.id.slice(0, 6)}
                </option>
              ))}
            </select>
            <button
              className="btn icon danger"
              title={S.character.deleteCharacter}
              disabled={disabled}
              onClick={() => apply((d) => removeCalibrationPoint(d, c.id))}
            >
              <Cross1Icon />
            </button>
          </div>
          <div className="env-row">
            <label>{S.layoutPanel.calibrationMin}</label>
            <NumberField
              value={c.minAge}
              step={0.1}
              onCommit={(v) => v !== undefined && apply((d) => updateCalibrationPoint(d, c.id, { minAge: v }))}
            />
            <label>{S.layoutPanel.calibrationMax}</label>
            <NumberField
              value={c.maxAge}
              step={0.1}
              onCommit={(v) => v !== undefined && apply((d) => updateCalibrationPoint(d, c.id, { maxAge: v }))}
            />
          </div>
        </div>
      ))}
      <button
        className="btn"
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
  const missingNames = missingNodes.map(
    (n) => n.label || n.id.slice(0, 6),
  );

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.time}</span>
        <span className="panel-header-subtitle">{S.layoutPanel.timeSection}</span>
      </div>

      {/* --- Layered status hints --- */}
      {/* Case 0: no time data at all — show the "not calibrated" warning. */}
      {!timeReady && (
        <div className="time-warning">
          <div className="time-warning-title">{S.layoutPanel.timeNotCalibrated}</div>
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
                // The toast wording for this button is the clicked variant, not
                // 「已自动切换」: the layout changes because it was clicked, never on
                // its own.
                notify.success(
                  tr('已切换到「地质时间图」布局', 'Switched to the geological time chart layout'),
                );
              }}
            >
              {S.layoutPanel.switchToTimeChart}
            </button>
          </div>
        </div>
      )}
      {/* Case 2: time-calibrated layout is active but some nodes lack ages. */}
      {timeReady && isTimeLayout && missingNodes.length > 0 && (
        <div className="time-warning">
          <div className="time-warning-title">
            {S.layoutPanel.missingAgesWarning(missingNodes.length)}
          </div>
          <div className="hint">
            {S.layoutPanel.missingAgesListPrefix}{missingAgeNames(missingNames)}
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

      <Section title={S.layoutPanel.timeSection} pinable>
        <Field label={S.layoutPanel.timeUnit}>
          <TextField
            value={project.layout.timeUnit ?? 'Ma'}
            onCommit={(v) => apply((d) => void (d.layout.timeUnit = v))}
          />
        </Field>
        <CheckboxField
          label={S.layoutPanel.showEras}
          checked={showEras}
          disabled={!timeReady}
          onChange={(v) => {
            setShowEras(v);
            // The era labels stack above the band edge; refit so the newly
            // revealed label rows are inside the viewport.
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
            <option value="period">{S.layoutPanel.eraLevelPeriod}</option>
            <option value="both">{S.layoutPanel.eraLevelBoth}</option>
          </select>
        </Field>
        <div className="field row-actions">
          <button
            className="btn"
            onClick={() => {
              // `estimateAges` returns what it wrote, and that result drives the
              // toast. Discarding it and toasting a flat "done" would hide both
              // that user-entered ages were preserved and — the dangerous part —
              // that with no absolute age anywhere the numbers are EDGE COUNTS,
              // not Ma; a "0–12 Ma Phanerozoic" axis gets built that way.
              const box: { result: EstimateAgesResult | null } = { result: null };
              apply((d) => {
                box.result = estimateAges(d);
              });
              requestFit();
              const text = box.result ? estimateAgesText(box.result) : S.layoutPanel.agesEstimated;
              const absolute = !!box.result && box.result.changed && box.result.unit === 'project';
              if (absolute) notify.success(text);
              else notify.info(text);
            }}
          >
            {S.layoutPanel.estimateAges}
          </button>
        </div>
        {/* `hasEstimatedAges` marks every node the estimator wrote, so
            the panel keeps saying "these ages are inferred" after the toast is
            gone instead of the values quietly becoming facts. */}
        {hasEstimatedAges(project) && (
          <div className="hint" style={{ marginBottom: 8 }}>
            {S.layoutPanel.agesAreEstimated}
          </div>
        )}
        <DismissibleHint id="time-hint">{S.layoutPanel.timeHint}</DismissibleHint>
      </Section>

      <Section title={S.layoutPanel.envSection} pinable>
        <EnvEvents project={project} apply={apply} disabled={!timeReady} />
      </Section>

      <Section title={S.layoutPanel.calibrationSection} pinable>
        {/* Clarification: calibration points are NEXUS-export-only; they do
            not affect the layout (no solver exists yet). */}
        <div className="hint" style={{ marginBottom: '8px' }}>
          {S.layoutPanel.calibrationHint}
        </div>
        <CalibrationPoints project={project} apply={apply} disabled={false} />
      </Section>
    </>
  );
}
