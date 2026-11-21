// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Left-hand global layout & style panel (展示 group).
//
// Everything here is VISUAL presentation: tree layout type & orientation,
// fixed spacing, support-threshold styling, branch appearance, depth gradient,
// default label typography and the canvas background. Per-object overrides
// live in the right-hand PropertiesPanel and always win. TIME DATA (units,
// era overlay, environmental events, calibration points) lives in the
// separate 时间 module — see TimePanel.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, type LegendLayout, type LegendPosition } from '../model/store';
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
} from '../model/treeOps';
import { STYLE_PRESETS, applyStylePreset } from '../model/presets';
import { Section } from './Section';
import {
  BranchShapeSelect,
  SwitchField,
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
import { useLanguage } from './i18n';
import { rerootAtSelection, ladderizeTree } from './fileMenu';

type Apply = (recipe: (d: Project) => void) => void;

export function LayoutPanel() {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const requestFit = useStore((s) => s.requestFit);
  // m1: which style preset is currently applied (drives the row's selected state).
  const stylePresetId = useStore((s) => s.stylePresetId);
  // Four presets fit one row on a normal panel and fall back to 2×2 when the
  // sidebar is narrow. The label widths differ between Chinese and English, so
  // the breakpoint follows the active language; ResizeObserver keeps the choice
  // in sync with the drag-resizable panel.
  const lang = useLanguage();
  const [presetColumns, setPresetColumns] = useState(4);
  const presetObserver = useRef<ResizeObserver | null>(null);
  const measurePresets = useCallback(
    (el: HTMLElement) => {
      const threshold = lang === 'zh' ? 220 : 260;
      setPresetColumns(el.clientWidth >= threshold ? 4 : 2);
    },
    [lang],
  );
  const attachPresetRow = useCallback(
    (el: HTMLDivElement | null) => {
      presetObserver.current?.disconnect();
      presetObserver.current = null;
      if (!el) return;
      measurePresets(el);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => measurePresets(el));
      observer.observe(el);
      presetObserver.current = observer;
    },
    [measurePresets],
  );
  useEffect(() => () => presetObserver.current?.disconnect(), []);
  // 用户反馈: legend placement + item arrangement (样式 › 图例设置).
  const legendPosition = useStore((s) => s.legendPosition);
  const setLegendPosition = useStore((s) => s.setLegendPosition);
  const legendLayout = useStore((s) => s.legendLayout);
  const setLegendLayout = useStore((s) => s.setLegendLayout);
  // D-P7: the 字号 row edits the SELECTED node's typography. With nothing
  // selected the edit has no target and was silently dropped, so the row is
  // disabled instead of looking fully active. Other rows here legitimately
  // edit document DEFAULTS and stay enabled.
  const selectionLength = useStore((s) => s.selection.length);

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
      <Section title={S.layoutPanel.presetSection} defaultOpen={false} pinable scope={project.id}>
        <div
          className="preset-row"
          ref={attachPresetRow}
          style={{ gridTemplateColumns: `repeat(${presetColumns}, minmax(0, 1fr))` }}
        >
          {STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              /* m1: equal-size rounded buttons; aria-pressed shows WHICH one
                 is applied. The 暗色 preset is canvas styling — distinct from
                 the preferences' dark THEME (its title says so). */
              className={`btn preset-btn${stylePresetId === p.id ? ' active' : ''}`}
              aria-pressed={stylePresetId === p.id}
              title={
                p.id === 'dark'
                  ? tr('深色图面（仅画布配色；界面主题在「偏好」中设置）', 'Dark figure palette (canvas only; the UI theme lives in Preferences)')
                  // A#8: with ellipsis on narrow panels, hover shows the full
                  // preset name.
                  : tr(p.label, p.labelEn)
              }
              onClick={() => {
                set((d) => applyStylePreset(d, p));
                useStore.getState().setStylePresetId(p.id);
              }}
            >
              {tr(p.label, p.labelEn)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={S.layoutPanel.layoutSection} defaultOpen={false} pinable scope={project.id}>
        <Field
          label={S.layoutPanel.type}
          stacked
          /* M30: switching layout or orientation discards every hand-placed
             position — the consequence is stated where the choice is made
             (undo restores). */
          title={tr(
            '更改布局会清除手动拖放的位置（⌘Z 可撤销）；「重新排布」按钮同样如此。',
            'Changing the layout discards hand-placed positions (⌘Z restores); the Re-layout button does the same.',
          )}
        >
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
              // Each layout has its own extents (circular on a dated tree is
              // far wider than the cladogram it replaces); keeping the previous
              // zoom/pan left most of the new layout outside the viewport.
              // UI-only, like the Re-layout button below.
              requestFit();
              // BUG-7: this selector is one of the explicit time-chart entry
              // points. On the first entry the era overlay is switched on once
              // and a one-time hint says where the controls are; a remembered
              // 「user unchecked the bands」opt-out is honoured. UI-only: no
              // project edit, no extra undo step, no layout effect.
              if (newType === 'time-calibrated') enterTimeChartLayout();
            }}
          >
            {/* 用户反馈：only the two layouts the tool actually services. */}
            <option value="rectangular-cladogram">{S.layoutType.cladogram}</option>
            <option value="time-calibrated">{S.layoutType.timeCalibrated}</option>
          </select>
        </Field>
        {/* m2 (UI_UX_REVIEW): one field form per section — stacked, like
            布局类型 above. */}
        <Field label={S.layoutPanel.orientation} stacked>
          <select
            value={layout.orientation}
            disabled={layout.type === 'circular'}
            onChange={(e) => {
              set((d) => {
                d.layout.orientation = e.target.value as Orientation;
                unpinAll(d);
              });
              // A quarter-turn swaps the extents, so the previous zoom can
              // push part of the tree out of view — refit, as Re-layout does.
              requestFit();
            }}
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

      <Section title={S.layoutPanel.spacingSection} defaultOpen={false} pinable scope={project.id}>
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

      <Section title={S.layoutPanel.branchSection} defaultOpen={false} pinable scope={project.id}>
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
        <Field label={S.layoutPanel.branchOpacity}>
          <SliderNumberField
            value={branch.opacity ?? 1}
            min={0.2}
            max={1}
            step={0.05}
            recipe={(v) => (d) => void (d.defaults.branch.opacity = v)}
          />
        </Field>
      </Section>

      <Section title={S.layoutPanel.gradientSection} defaultOpen={false} pinable scope={project.id}>
        {/* 用户反馈：rounded dropdown (启用 / 禁用) instead of a checkbox. */}
        <Field label={S.layoutPanel.gradientSection}>
          <select
            value={gradient.enabled ? 'enable' : 'disable'}
            onChange={(e) => set((d) => void (d.defaults.branchGradient.enabled = e.target.value === 'enable'))}
          >
            <option value="enable">{tr('启用', 'Enable')}</option>
            <option value="disable">{tr('禁用', 'Disable')}</option>
          </select>
        </Field>
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

      <Section title={S.layoutPanel.fontSection} defaultOpen={false} pinable scope={project.id}>
        <Field label={S.layoutPanel.fontSize}>
          <SliderNumberField
            value={node.fontSize}
            min={6}
            max={48}
            disabled={selectionLength === 0}
            recipe={(v) => (d) => void (d.defaults.node.fontSize = v)}
          />
        </Field>
        {/* D-P7: a disabled control with no explanation reads as a bug; say
            what is missing. Only shown while the row is actually disabled. */}
        {selectionLength === 0 && (
          <div className="hint">{tr('请先选中一个节点', 'Select a node first')}</div>
        )}
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
        <SwitchField
          label={S.layoutPanel.italic}
          checked={node.fontStyle === 'italic'}
          onChange={(v) =>
            set((d) => void (d.defaults.node.fontStyle = v ? 'italic' : 'normal'))
          }
        />
        {/* PhyloRecViewer label halo (用户反馈 2026-11-16). */}
        <SwitchField
          label={S.layoutPanel.labelHalo}
          checked={node.labelHalo ?? false}
          onChange={(v) => set((d) => void (d.defaults.node.labelHalo = v))}
        />
        <Field label={S.layoutPanel.labelColor}>
          <ColorField
            value={node.labelColor}
            onChange={(v) => set((d) => void (d.defaults.node.labelColor = v))}
          />
        </Field>
        <SwitchField
          label={S.layoutPanel.showLabel}
          checked={node.showLabel}
          onChange={(v) => set((d) => void (d.defaults.node.showLabel = v))}
        />
      </Section>

      {/* 用户反馈: the tree-structure operations moved OUT of the 文件 menu into
          the left panel. */}
      <Section title={tr('树操作', 'Tree operations')} defaultOpen={false} pinable scope={project.id}>
        <div className="field row-actions">
          <button className="btn" onClick={() => rerootAtSelection()}>
            {tr('从选中节点重新定根', 'Reroot at the selected node')}
          </button>
          <button className="btn" onClick={() => ladderizeTree()}>
            {tr('阶梯化整树', 'Ladderize the tree')}
          </button>
        </div>
      </Section>

      {/* 用户反馈: legend placement + item arrangement. */}
      <Section title={tr('图例设置', 'Legend settings')} defaultOpen={false} pinable scope={project.id}>
        <Field label={tr('图例位置', 'Legend position')}>
          <select
            value={legendPosition}
            onChange={(e) => setLegendPosition(e.target.value as LegendPosition)}
          >
            <option value="top-left">{tr('左上', 'Top-left')}</option>
            <option value="top-right">{tr('右上', 'Top-right')}</option>
            <option value="bottom-left">{tr('左下', 'Bottom-left')}</option>
            <option value="bottom-right">{tr('右下', 'Bottom-right')}</option>
          </select>
        </Field>
        <Field label={tr('项目排列', 'Item arrangement')}>
          <select
            value={legendLayout}
            onChange={(e) => setLegendLayout(e.target.value as LegendLayout)}
          >
            <option value="one-column">{tr('垂直一列', 'One column')}</option>
            <option value="two-columns">{tr('垂直两列', 'Two columns')}</option>
            <option value="one-row">{tr('水平一行', 'One row')}</option>
            <option value="two-rows">{tr('水平两行', 'Two rows')}</option>
          </select>
        </Field>
      </Section>

      <Section title={S.layoutPanel.canvasSection} defaultOpen={false} pinable scope={project.id}>
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
