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
import { unpinAll, hasBranchLengths, isTimeCalibrated, nodesMissingAges } from '../model/treeOps';
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
  NumberField,
} from './fields';
import { S, tr } from './strings';
import { notify } from './toast';

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
      if (shape === 'line') {
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

      {/* Support threshold visualisation.
          NOTE: these settings are currently non-functional — the threshold
          is not consumed by the renderer and collapseBelowSupport() has no
          caller. They are hidden until the feature is fully implemented so
          users don't get a false impression of control. */}

      <Section title={S.layoutPanel.spacingSection} defaultOpen={false} pinable>
        <Field label={S.layoutPanel.branchGap}>
          <NumberField
            value={layout.vGap}
            min={8}
            max={240}
            step={2}
            onCommit={(v) => v !== undefined && set((d) => void (d.layout.vGap = v))}
          />
        </Field>
        <Field label={S.layoutPanel.levelGap}>
          <NumberField
            value={layout.hGap}
            min={20}
            max={400}
            step={10}
            onCommit={(v) => v !== undefined && set((d) => void (d.layout.hGap = v))}
          />
        </Field>
      </Section>

      <Section title={S.layoutPanel.branchSection} defaultOpen={false} pinable>
        <Field label={S.layoutPanel.branchShape}>
          <BranchShapeSelect value={branch.shape} onChange={setBranchShape} />
        </Field>
        <Field label={S.layoutPanel.branchWidth}>
          <NumberField
            value={branch.width}
            min={0.5}
            max={40}
            step={0.5}
            onCommit={(v) => v !== undefined && set((d) => void (d.defaults.branch.width = v))}
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
          <NumberField
            value={node.fontSize}
            min={6}
            max={48}
            onCommit={(v) => v !== undefined && set((d) => void (d.defaults.node.fontSize = v))}
          />
        </Field>
        <Field label={S.layoutPanel.fontWeight}>
          <FontWeightSelect
            value={weight}
            onChange={(v) => set((d) => void (d.defaults.node.fontWeight = v))}
          />
        </Field>
        <Field label={S.layoutPanel.rotation}>
          <NumberField
            value={node.labelRotation}
            min={-180}
            max={180}
            step={5}
            onCommit={(v) => v !== undefined && set((d) => void (d.defaults.node.labelRotation = v))}
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
