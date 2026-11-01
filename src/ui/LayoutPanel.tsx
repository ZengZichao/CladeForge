// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Left-hand global layout & style panel (展示 group).
//
// Everything here is VISUAL presentation: tree layout type & orientation,
// fixed spacing, support-threshold styling, branch appearance, depth gradient,
// default label typography and the canvas background. Per-object overrides
// live in the right-hand PropertiesPanel and always win. TIME DATA (units,
// era overlay, environmental events, calibration points) lives in the
// separate 时间 module — see TimePanel.

import { useStore } from '../model/store';
import {
  fontWeightValue,
  type BranchShape,
  type LayoutType,
  type Orientation,
  type Project,
} from '../model/types';
import {
  unpinAll,
  hasBranchLengths,
  isTimeCalibrated,
  nodesMissingAges,
  collapseAll,
  expandAll,
  sortTipsByCharacter,
} from '../model/treeOps';
import { STYLE_PRESETS, applyStylePreset } from '../model/presets';
import { Section } from './Section';
import {
  BranchShapeSelect,
  CheckboxField,
  ColorField,
  DashSelect,
  DismissibleHint,
  Field,
  FontWeightSelect,
} from './fields';
import { SliderNumberField } from './SliderNumberField';
import { S, tr } from './strings';
import { notify } from './toast';
import { enterTimeChartLayout } from './timeChartEras';

type Apply = (recipe: (d: Project) => void) => void;

export function LayoutPanel() {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const requestFit = useStore((s) => s.requestFit);

  const layout = project.layout;
  const branch = project.defaults.branch;
  const gradient = project.defaults.branchGradient;
  const node = project.defaults.node;
  const weight = fontWeightValue(node.fontWeight);

  const set: Apply = (recipe) => apply(recipe);

  // Selecting a thick shape bumps a still-thin branch to a visible thickness,
  // and returning to a thin line restores a hairline width, so each option
  // looks the way its name implies without a second trip to the width field.
  const setBranchShape = (shape: BranchShape) =>
    set((d) => {
      d.defaults.branch.shape = shape;
      const w = d.defaults.branch.width;
      if (shape === 'line' || shape === 'curved') {
        // Both are thin-stroke styles: a leftover thick bar would swamp the
        // curve instead of reading as a branch.
        if (w > 4) d.defaults.branch.width = 1.5;
      } else if (w < 4) {
        d.defaults.branch.width = 8;
      }
    });

  return (
    <>
      <DismissibleHint id="layout-global-hint">{S.layoutPanel.applyHint}</DismissibleHint>
      <Section title={S.layoutPanel.presetSection} pinable>
        <div className="preset-row">
          {STYLE_PRESETS.map((p) => (
            <button key={p.id} className="btn" onClick={() => set((d) => applyStylePreset(d, p))}>
              {tr(p.label, p.labelEn)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={S.layoutPanel.layoutSection} pinable>
        <Field label={S.layoutPanel.type}>
          <select
            value={layout.type}
            onChange={(e) => {
              const newType = e.target.value as LayoutType;
              // Warn when switching to phylogram without branch lengths.
              if (newType === 'rectangular-phylogram' && !hasBranchLengths(project)) {
                notify.info(S.notify.noBranchLength);
              }
              // State-machine gate: warn when switching to
              // time-calibrated without time data.
              if (newType === 'time-calibrated' && !isTimeCalibrated(project)) {
                notify.info(S.notify.timeNotCalibrated);
              }
              // Warn about nodes missing ages: they will be silently placed
              // at present (0 Ma), which looks like a rendering bug.
              if (newType === 'time-calibrated') {
                const missing = nodesMissingAges(project);
                if (missing.length > 0) {
                  notify.info(S.notify.missingAgesToast(missing.length));
                }
              }
              set((d) => {
                d.layout.type = newType;
                unpinAll(d);
              });
              // BUG-7: this selector is one of the explicit time-chart entry
              // points. On the first entry the era overlay is switched on once
              // and a one-time hint says where the controls are; a remembered
              // 「user unchecked the bands」opt-out is honoured. UI-only: no
              // project edit, no extra undo step, no layout effect.
              if (newType === 'time-calibrated') enterTimeChartLayout();
            }}
          >
            <option value="rectangular-cladogram">{S.layoutType.cladogram}</option>
            <option value="rectangular-phylogram">{S.layoutType.phylogram}</option>
            <option value="time-calibrated">{S.layoutType.timeCalibrated}</option>
            <option value="circular">{S.layoutType.circular}</option>
          </select>
        </Field>
        {/* The circular layout never reads node ages, so
            choosing it on a dated tree drops the time axis, the era bands and the
            environmental-event ribbon. The data is intact — but a reader of the
            figure cannot know that from the picture, so say it where the choice is
            made (the canvas repeats it from `computeLayout`'s own issue list). */}
        {layout.type === 'circular' && isTimeCalibrated(project) && (
          <div className="hint" style={{ marginBottom: 8 }}>
            {S.layoutPanel.circularIgnoresAges}
          </div>
        )}
        <Field label={S.layoutPanel.orientation}>
          <select
            value={layout.orientation}
            disabled={layout.type === 'circular'}
            onChange={(e) =>
              set((d) => {
                d.layout.orientation = e.target.value as Orientation;
                unpinAll(d);
              })
            }
          >
            <option value="LR">{S.orientation.LR}</option>
            <option value="RL">{S.orientation.RL}</option>
            <option value="TB">{S.orientation.TB}</option>
            <option value="BT">{S.orientation.BT}</option>
          </select>
        </Field>
        <div className="field row-actions">
          <button
            className="btn"
            title={S.toolbar.relayoutTitle}
            onClick={() => {
              set((d) => unpinAll(d));
              requestFit();
            }}
          >
            {S.toolbar.relayout}
          </button>
        </div>
      </Section>

      {/* Support threshold — FUNCTIONAL: the canvas dims/dashes branches whose
          (scale-aware) support falls below the threshold, and the exporter
          applies the same rule, so the control is honest on both sides. */}
      <Section title={tr('支持值阈值', 'Support threshold')} defaultOpen={false} pinable>
        <Field label={tr('阈值（0–100）', 'Threshold (0–100)')}>
          <SliderNumberField
            value={layout.supportThreshold ?? 70}
            min={0}
            max={100}
            step={1}
            recipe={(v) => (d) => void (d.layout.supportThreshold = v)}
          />
        </Field>
        <div className="hint">
          {tr(
            '低于阈值的枝以虚线、半透明显示；支持值的刻度（0–1 或 0–100）在导入时声明并随节点保存。',
            'Branches below the threshold draw dashed and dimmed; the support scale (0–1 vs 0–100) is declared at import and stored per node.',
          )}
        </div>
      </Section>

      {/* Time-axis length + nonlinear mapping: the axis used to be derived from
          the topological depth, which made deep-time figures mathematically
          unreadable. An explicit length decouples pixels from topology; the
          sqrt/log mappings open up the recent end of a 4 Ga axis. */}
      {isTimeCalibrated(project) && (
        <Section title={tr('时间轴', 'Time axis')} defaultOpen={false} pinable>
          <Field label={tr('时间轴长度（px，0 = 按拓扑推导）', 'Axis length (px; 0 = derive from topology)')}>
            <SliderNumberField
              value={layout.timeAxisLength ?? 0}
              min={0}
              max={4000}
              step={50}
              recipe={(v) => (d) => void (d.layout.timeAxisLength = v > 0 ? v : undefined)}
            />
          </Field>
          <Field label={tr('深度映射', 'Depth mapping')}>
            <select
              value={layout.timeScale ?? 'linear'}
              onChange={(e) =>
                apply((d) => {
                  d.layout.timeScale = e.target.value as 'linear' | 'sqrt' | 'log';
                })
              }
            >
              <option value="linear">{tr('线性', 'Linear')}</option>
              <option value="sqrt">{tr('平方根', 'Square root')}</option>
              <option value="log">{tr('对数 log10(1+t/t₀)', 'Log log10(1+t/t₀)')}</option>
            </select>
          </Field>
          <div className="hint">
            {tr(
              '深时数据用 sqrt/log：线性 4 Ga 轴把整个新生代压进不到 1% 的画幅。',
              'Use sqrt/log for deep time: a linear 4 Ga axis squeezes the entire Cenozoic into under 1% of the figure.',
            )}
          </div>
        </Section>
      )}

      {/* Bulk structure commands: collapse-all / expand-all / sort by state. */}
      <Section title={tr('批量结构操作', 'Bulk structure')} defaultOpen={false} pinable>
        <div className="field row-actions">
          <button className="btn" onClick={() => set((d) => void collapseAll(d))}>
            {S.review.cmdCollapseAll}
          </button>
          <button className="btn" onClick={() => set((d) => void expandAll(d))}>
            {S.review.cmdExpandAll}
          </button>
        </div>
        {project.characters.filter((c) => c.type === 'discrete').length > 0 && (
          <Field label={tr('按性状状态排序末端', 'Sort tips by character state')}>
            <select
              value=""
              onChange={(e) => {
                const cid = e.target.value;
                if (!cid) return;
                const n = sortTipsByCharacter(project, cid);
                if (n > 0) {
                  set((d) => void sortTipsByCharacter(d, cid));
                  notify.info(tr(`已按状态重排 ${n} 组姊妹枝`, `Reordered ${n} sibling group(s) by state`));
                }
              }}
            >
              <option value="">{tr('选择性状…', 'Pick a character…')}</option>
              {project.characters
                .filter((c) => c.type === 'discrete')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </Section>

      <Section title={S.layoutPanel.spacingSection} defaultOpen={false} pinable>
        <Field label={S.layoutPanel.branchGap}>
          <SliderNumberField
            value={layout.vGap}
            min={8}
            max={240}
            step={2}
            recipe={(v) => (d) => void (d.layout.vGap = v)}
          />
        </Field>
        <Field label={S.layoutPanel.levelGap}>
          <SliderNumberField
            value={layout.hGap}
            min={20}
            max={400}
            step={10}
            recipe={(v) => (d) => void (d.layout.hGap = v)}
          />
        </Field>
      </Section>

      <Section title={S.layoutPanel.branchSection} defaultOpen={false} pinable>
        <Field label={S.layoutPanel.branchShape}>
          <BranchShapeSelect value={branch.shape} onChange={setBranchShape} />
        </Field>
        <Field label={S.layoutPanel.branchWidth}>
          <SliderNumberField
            value={branch.width}
            min={0.5}
            max={40}
            step={0.5}
            recipe={(v) => (d) => void (d.defaults.branch.width = v)}
          />
        </Field>
        <Field label={S.layoutPanel.branchColor}>
          <ColorField
            value={branch.color}
            onChange={(v) => set((d) => void (d.defaults.branch.color = v))}
          />
        </Field>
        <Field label={S.node.dash}>
          <DashSelect
            value={branch.dash}
            onChange={(v) => set((d) => void (d.defaults.branch.dash = v))}
          />
        </Field>
      </Section>

      <Section title={S.layoutPanel.gradientSection} defaultOpen={false} pinable>
        <CheckboxField
          label={S.layoutPanel.gradientEnable}
          checked={gradient.enabled}
          onChange={(v) => set((d) => void (d.defaults.branchGradient.enabled = v))}
        />
        <Field label={S.layoutPanel.gradientFrom}>
          <ColorField
            value={gradient.from}
            disabled={!gradient.enabled}
            onChange={(v) => set((d) => void (d.defaults.branchGradient.from = v))}
          />
        </Field>
        <Field label={S.layoutPanel.gradientTo}>
          <ColorField
            value={gradient.to}
            disabled={!gradient.enabled}
            onChange={(v) => set((d) => void (d.defaults.branchGradient.to = v))}
          />
        </Field>
        <DismissibleHint id="gradient-hint">{S.layoutPanel.gradientHint}</DismissibleHint>
      </Section>

      <Section title={S.layoutPanel.fontSection} defaultOpen={false} pinable>
        <Field label={S.layoutPanel.fontSize}>
          <SliderNumberField
            value={node.fontSize}
            min={6}
            max={48}
            recipe={(v) => (d) => void (d.defaults.node.fontSize = v)}
          />
        </Field>
        <Field label={S.layoutPanel.fontWeight}>
          <FontWeightSelect
            value={weight}
            onChange={(v) => set((d) => void (d.defaults.node.fontWeight = v))}
          />
        </Field>
        <Field label={S.layoutPanel.rotation}>
          <SliderNumberField
            value={node.labelRotation}
            min={-180}
            max={180}
            step={5}
            recipe={(v) => (d) => void (d.defaults.node.labelRotation = v)}
          />
        </Field>
        <Field label={S.node.labelOffsetX}>
          <SliderNumberField
            value={node.labelOffsetX ?? 0}
            sliderMin={-100}
            sliderMax={100}
            step={1}
            unit="px"
            recipe={(v) => (d) => void (d.defaults.node.labelOffsetX = v)}
          />
        </Field>
        <Field label={S.node.labelOffsetY}>
          <SliderNumberField
            value={node.labelOffsetY ?? 0}
            sliderMin={-100}
            sliderMax={100}
            step={1}
            unit="px"
            recipe={(v) => (d) => void (d.defaults.node.labelOffsetY = v)}
          />
        </Field>
        <CheckboxField
          label={S.layoutPanel.italic}
          checked={node.fontStyle === 'italic'}
          onChange={(v) => set((d) => void (d.defaults.node.fontStyle = v ? 'italic' : 'normal'))}
        />
        <CheckboxField
          label={S.layoutPanel.bold}
          checked={weight >= 600}
          onChange={(v) => set((d) => void (d.defaults.node.fontWeight = v ? 700 : 400))}
        />
        <Field label={S.layoutPanel.labelColor}>
          <ColorField
            value={node.labelColor}
            onChange={(v) => set((d) => void (d.defaults.node.labelColor = v))}
          />
        </Field>
        <CheckboxField
          label={S.layoutPanel.showLabel}
          checked={node.showLabel}
          onChange={(v) => set((d) => void (d.defaults.node.showLabel = v))}
        />
      </Section>

      <Section title={S.layoutPanel.canvasSection} defaultOpen={false} pinable>
        <Field label={S.layoutPanel.background}>
          <ColorField
            value={project.canvas.background}
            onChange={(v) => set((d) => void (d.canvas.background = v))}
          />
        </Field>
        <Field label={S.layoutPanel.edgeColor}>
          <ColorField
            value={project.defaults.edge.color}
            onChange={(v) => set((d) => void (d.defaults.edge.color = v))}
          />
        </Field>
      </Section>
    </>
  );
}
