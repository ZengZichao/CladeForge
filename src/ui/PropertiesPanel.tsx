// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Context-sensitive inspector (right column). Shows node styling, custom-edge
// styling or multi-selection batch styling for the current selection. When
// nothing is selected it shows a short hint. Uses an Accordion (collapsible
// Sections) with a live search filter that matches field-level keywords and
// per-section favorites — similar to Figma / Illustrator / Blender inspector
// panels.
//
// Project-wide defaults intentionally live ONLY in the left "样式" module
// (LayoutPanel) — this panel is purely per-object editing, with a visible
// "inherits global / overridden" badge so the override relationship is never a
// mystery.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  deleteNode,
  getCalibrationForNode,
  removeCustomEdge,
  renameNode,
  setBranchLength,
  setBranchStyle,
  setCalibrationForNode,
  setEdgeLabel,
  setEdgeStyle,
  setNodeAge,
  updateCalibrationPoint,
  setHypothesisNote,
  setNodeStyle,
  setSubtreeBranchColor,
  unpinNode,
} from '../model/treeOps';
import {
  fontWeightValue,
  resolveBranchStyle,
  resolveNodeStyle,
  type BranchShape,
  type BranchStyle,
  type CustomEdge,
  type LabelPosition,
  type NodeId,
  type NodeShape,
  type Project,
  type TreeNode,
} from '../model/types';
import {
  BranchShapeSelect,
  SwitchField,
  ColorField,
  DashSelect,
  Field,
  FontWeightSelect,
  NumberField,
  TextField,
} from './fields';
import { SliderNumberField } from './SliderNumberField';
import { Section } from './Section';
import { EventEditor } from './EventEditor';
import { requestDeletion } from './deleteGuard';
import { requestConfirm } from './confirmDialog';
import { S, tr, selectedCount } from './strings';
import { timeUnitLabel, timeUnitSymbol } from './units';
import { notify } from './toast';
import * as file from '../io/fileActions';


type Apply = (recipe: (d: Project) => void) => void;

// Section-level keywords for the inspector search: each section lists
// the field labels / synonyms it contains so a query like "颜色" or "字号"
// finds the right (possibly closed) section.
//
// Keyed by the STRINGS FIELD NAME, never by `S.node.section` — the translated
// title — because a module-level object is built once at import time: keyed by
// the title, its keys freeze in whichever language is active then, and after a
// language switch every lookup below returns `undefined`, silently disabling
// section search.
// The keyword lists themselves are language-neutral data: they carry both
// Chinese and English terms on purpose, so a query matches in either locale.
type NodeSectionKey =
  | 'section'
  | 'timeConstraintSection'
  | 'styleSection'
  | 'labelSection'
  | 'branchSection';

const NODE_SECTION_KEYWORDS: Record<NodeSectionKey, string[]> = {
  section: ['名称', '枝长', '支持度', '年龄', '时间', '假说', '标注', 'name', 'branch length', 'support', 'age', 'hypothesis', 'note', 'annotation'],
  timeConstraintSection: ['时间约束', '校准', '区间', '最小年代', '最大年代', 'calibration', 'constraint', 'min age', 'max age'],
  styleSection: ['填充颜色', '描边颜色', '填充色', '描边色', '大小', '形状', '描边', '颜色', '字号', 'fill', 'stroke', 'size', 'shape', 'colour', 'color'],
  labelSection: ['标签', '字号', '字体', '颜色', '旋转', '斜体', '加粗', '字重', '位置', '方位', '偏移', 'label', 'font', 'size', 'colour', 'color', 'rotate', 'italic', 'bold', 'position', 'offset'],
  branchSection: ['分支', '颜色', '线宽', '线型', '粗细', '形状', 'branch', 'colour', 'color', 'width', 'dash', 'shape'],
};

// 用户反馈: the per-node 性状状态 editor (NodeCharRow) was removed from the
// inspector; the parsimony-suggestion machinery that fed it went with it.
// Character data still lives on the document and drives the canvas change
// flags, ASR and exports — only the inspector editing surface is gone.

// --- Tip annotations (structured metadata) -----------------------------------

/** Editable rows for the node's structured annotations (host / country /
 *  accession / date / lineage …). Written by the CSV annotation-table join;
 *  stored on `node.annotations`, not the free-form meta bag, so it is
 *  queryable and exports with the annotations CSV. */
function AnnotationRows({
  node,
  apply,
}: {
  node: TreeNode;
  apply: Apply;
}) {
  const entries = Object.entries(node.annotations ?? {});
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(([key, value]) => (
        <Field key={key} label={key}>
          <TextField
            value={String(value)}
            onCommit={(v) =>
              apply((d) => {
                const n = d.nodes[node.id];
                if (!n) return;
                if (v.trim() === '') delete n.annotations?.[key];
                else {
                  if (!n.annotations) n.annotations = {};
                  const num = Number(v);
                  n.annotations[key] = Number.isFinite(num) && v.trim() !== '' ? num : v;
                }
              })
            }
          />
        </Field>
      ))}
    </>
  );
}

// --- Label position controller (directional pad + XY offsets) ---------------

// The nine label-placement buttons. The tooltip is translated AT RENDER TIME
// (`tr(p.zh, p.en)` below): a module-level `title: tr(...)` would freeze
// whichever language was active at import, so after a language switch every
// tooltip would keep saying 左上/Top-left in the wrong language.
const LABEL_POSITIONS: { value: LabelPosition; zh: string; en: string }[] = [
  { value: 'top-left', zh: '左上', en: 'Top-left' },
  { value: 'top', zh: '上', en: 'Top' },
  { value: 'top-right', zh: '右上', en: 'Top-right' },
  { value: 'left', zh: '左', en: 'Left' },
  { value: 'auto', zh: '自动', en: 'Auto' },
  { value: 'right', zh: '右', en: 'Right' },
  { value: 'bottom-left', zh: '左下', en: 'Bottom-left' },
  { value: 'bottom', zh: '下', en: 'Bottom' },
  { value: 'bottom-right', zh: '右下', en: 'Bottom-right' },
];

export function LabelPositionController({
  value,
  onChange,
}: {
  value: LabelPosition;
  onChange: (v: LabelPosition) => void;
}) {
  return (
    // Pure-geometry 3×3 indicator (mature-product polish pass): each cell draws
    // a small dot at its own position — no unicode arrows, identical across
    // platforms and fonts, and the pad reads as one widget rather than nine
    // loose glyphs. "auto" is the hollow centre dot. The words live in the
    // tooltip + accessible name, where text is necessary.
    <div className="label-position-pad">
      {LABEL_POSITIONS.map((p) => (
        <button
          key={p.value}
          className={`label-position-btn${value === p.value ? ' active' : ''}`}
          title={tr(p.zh, p.en)}
          aria-label={tr(p.zh, p.en)}
          onClick={() => onChange(p.value)}
        >
          <span className={`lp-dot lp-${p.value}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

// --- Collapsed-section value previews ---------------------------------------
// A folded inspector group used to show only "5 ITEMS": the count says how much
// is hidden, never WHAT. Each of the four collapsible groups below now supplies
// a one-line, read-only preview of its most meaningful current values (the
// `summary` prop of `Section`), so the folded state stays informative and the
// fields only need expanding when the user actually wants to edit. Everything
// is translated/formatted at render time: a module-level `tr(...)` would freeze
// the language at import time (see localeFreeze.test.ts).


function NodePanel({
  node,
  project,
  apply,
  search,
}: {
  node: TreeNode;
  project: Project;
  apply: Apply;
  search: string;
}) {
  const clearSelection = useStore((s) => s.clearSelection);
  const reconSpeciesEdit = useStore(
    (s) => s.reconMode && s.reconEditTarget === 'species' && !s.geneEditBackup,
  );
  // ID-11: copy/paste style between nodes — cloning a carefully styled node
  // used to mean re-dialing every field by hand.
  const styleClipboard = useStore((s) => s.styleClipboard);
  const copyStyle = useStore((s) => s.copyStyle);
  const style = resolveNodeStyle(node, project);
  const branch = resolveBranchStyle(node, project);
  const id = node.id;

  // Unified data model: the calibration point for this node
  // (if any) is the SAME data source shown in the left "时间" panel's
  // calibration manager. Editing min/max age here updates the calibration
  // point directly, and editing the node's scalar age stays within the
  // [minAge, maxAge] constraint.
  const calibration = getCalibrationForNode(project, id);
  // Project-wide time unit ("Ma" by default). All ages and the calibration
  // range render with it as a visible suffix instead of a vanishing placeholder.
  const timeUnit = project.layout.timeUnit ?? 'Ma';

  // Override-relationship badge: once the user touches any
  // per-node style, this node "overrides" the global default.
  const overridden = Boolean(node.style) || Boolean(node.branchStyle);

  const ns = (patch: Parameters<typeof setNodeStyle>[2]) => apply((d) => setNodeStyle(d, id, patch));
  const bs = (patch: Parameters<typeof setBranchStyle>[2]) =>
    apply((d) => setBranchStyle(d, id, patch));
  const weight = fontWeightValue(style.fontWeight);
  const setNodeBranchShape = (shape: BranchShape) => {
    const patch: Parameters<typeof setBranchStyle>[2] = { shape };
    if (shape === 'line' || shape === 'curved') {
      if (branch.width > 4) patch.width = 1.5;
    } else if (branch.width < 4) {
      patch.width = 8;
    }
    bs(patch);
  };

  const requestDelete = () => {
    // One tip-based risk predicate, a key of its own for THIS entry point
    // (sharing `delete-node` with the context menu would let opting out here
    // silence the prompt there too), and an Undo bound to this delete.
    requestDeletion(project, [id], 'inspector-node', () => {
      apply((d) => deleteNode(d, id, true));
      clearSelection();
    });
  };

  return (
    <>
      <Section
        title={S.node.section}
        searchQuery={search}
        favoritable
        count={5}
        keywords={NODE_SECTION_KEYWORDS.section}
      >
        <Field label={S.node.name}>
          {/* A#7 / BUG-14: an empty name used to be committed silently, leaving
              the node invisible on the canvas (no label to click). Refuse it at
              the edit boundary with a word about why. */}
          <TextField
            value={node.label}
            onCommit={(v) => {
              if (!v.trim()) {
                notify.info(
                  tr(
                    '名称不能为空：已保留原名称，避免画布上的节点标签消失。',
                    'The name cannot be empty: the original name was kept so the canvas label does not disappear.',
                  ),
                );
                return;
              }
              apply((d) => renameNode(d, id, v));
            }}
          />
        </Field>
        {/* Structured tip metadata (joined from a CSV table) renders right
            under the name: accession, host, country, date, lineage — the
            per-isolate record a microbial figure needs. */}
        <AnnotationRows node={node} apply={apply} />
        <Field label={S.node.hypothesisNote}>
          <TextField
            value={node.hypothesisNote ?? ''}
            placeholder={S.node.hypothesisNotePlaceholder}
            onCommit={(v) => apply((d) => setHypothesisNote(d, id, v))}
          />
        </Field>
        <Field label={S.node.branchLength}>
          {/* 用户反馈：no unit chip — the number is the branch itself. Editing
              the branch length recomputes the node's age from its parent
              (node.age = parent.age − length) when both ages are known, so the
              two fields follow each other instead of drifting apart. */}
          <NumberField
            value={node.branchLength}
            allowEmpty
            min={0}
            step={0.1}
            onCommit={(v) =>
              apply((d) => {
                setBranchLength(d, id, v);
                if (reconSpeciesEdit && v !== undefined && d.layout.type === 'rectangular-cladogram') {
                  d.layout.type = 'rectangular-phylogram';
                }
                // 随动: age ← parent.age − branchLength.
                const n = d.nodes[id];
                if (!n || v === undefined) return;
                const parent = n.parentId ? d.nodes[n.parentId] : undefined;
                if (parent?.age !== undefined && v >= 0) {
                  const derived = parent.age - v;
                  if (derived >= 0) n.age = derived;
                }
              })
            }
          />
        </Field>
        <Field label={S.node.age}>
          <NumberField
            value={node.age}
            allowEmpty
            step={0.1}
            /* BUG-03 residual: an age is a point in deep time, so it can never
               be negative. Without a calibration the field had no lower bound
               at all and accepted -10, drawing the node far above the axis;
               the bound is the tighter of "now" (0) and the calibration's
               minimum, matching the branch-length field right above. */
            min={Math.max(0, calibration?.minAge ?? 0)}
            max={calibration?.maxAge}
            unit={timeUnitSymbol(timeUnit)}
            unitTitle={tr(
              `年龄（单位：${timeUnitLabel(timeUnit)}）；Ma = 百万年前`,
              `Age in ${timeUnitLabel(timeUnit)}; Ma = million years ago`,
            )}
            onCommit={(v) =>
              apply((d) => {
                setNodeAge(d, id, v);
                // 随动: branchLength ← parent.age − node.age.
                const n = d.nodes[id];
                if (!n || v === undefined) return;
                const parent = n.parentId ? d.nodes[n.parentId] : undefined;
                if (parent?.age !== undefined) {
                  const derived = parent.age - v;
                  if (derived >= 0) n.branchLength = derived;
                }
              })
            }
          />
        </Field>
      </Section>

      {/* 用户反馈：该节点的枝样式 sits directly under 节点. */}
      <Section
        title={S.node.branchSection}
        defaultOpen={false}
        searchQuery={search}
        favoritable
        keywords={NODE_SECTION_KEYWORDS.branchSection}
      >
        <Field label={S.node.branchShape}>
          <BranchShapeSelect value={branch.shape} onChange={setNodeBranchShape} />
        </Field>
        <Field label={S.node.color}>
          <ColorField value={branch.color} onChange={(v) => bs({ color: v })} />
        </Field>
        {/* 用户反馈: a 范围 dropdown instead of the one-shot 应用到整个子树
            button — 单个节点 is the resting state (the 颜色 field above already
            colours this branch), 整个子树 applies the colour downstream in one
            undoable step and the select then resets to 单个节点. */}
        <Field label={tr('范围', 'Scope')}>
          <select
            value="node"
            onChange={(e) => {
              if (e.target.value !== 'subtree') return;
              let changed = 0;
              apply((d) => {
                changed = setSubtreeBranchColor(d, id, branch.color);
              });
              if (changed > 0) {
                notify.success(S.node.applyBranchColorDone(changed));
              }
            }}
          >
            <option value="node">{tr('单个节点', 'This node')}</option>
            <option value="subtree">{tr('整个子树', 'Whole subtree')}</option>
          </select>
        </Field>
        <Field label={S.node.width}>
          <SliderNumberField
            value={branch.width}
            min={0.5}
            max={40}
            step={0.5}
            unit="px"
            recipe={(v) => (d) => setBranchStyle(d, id, { width: v })}
          />
        </Field>
        <Field label={S.node.dash}>
          <DashSelect value={branch.dash} onChange={(v) => bs({ dash: v })} />
        </Field>
      </Section>

      {/* M6 (UI_UX_REVIEW): the science sections come right after identity —
          a tool whose pitch is hypothesis scaffolding had 性状状态/事件 buried
          behind three appearance sections. New order: identity → science
          (traits/events/time) → appearance (style/label/branch) → actions. */}
      {/* 用户反馈: the per-node 性状状态 editor is gone from the inspector. */}
      {project.characters.length > 0 && (
        <EventEditor node={node} project={project} apply={apply} />
      )}
      {project.characters.length === 0 && (
        /* M31: the event editor used to vanish silently when no character
           existed — the dependency (events key off character states) was
           never stated. Say it, and name the fix. */
        <div className="hint" title={tr('演化事件引用性状状态，故需先定义性状', 'Evolutionary events reference character states, so define a character first')}>
          {tr(
            '演化事件需引用性状状态：先在左侧「性状」模块新建至少一个性状，此处即可添加事件。',
            'Evolutionary events reference character states: create at least one character in the Characters module first, then events become available here.',
          )}
        </div>
      )}

      {/* Time Constraint section: mirrors the left panel's
          calibration data for this node, ensuring two-way binding. */}
      <Section
        title={S.node.timeConstraintSection}
        searchQuery={search}
        favoritable
        defaultOpen={false}
        keywords={NODE_SECTION_KEYWORDS.timeConstraintSection}
      >
        {calibration ? (
          <>
            <Field label={S.node.calibrationMin}>
              <NumberField
                value={calibration.minAge}
                step={0.1}
                min={0}
                unit={timeUnitSymbol(timeUnit)}
                unitTitle={tr(
                  `年龄（单位：${timeUnitLabel(timeUnit)}）；Ma = 百万年前`,
                  `Age in ${timeUnitLabel(timeUnit)}; Ma = million years ago`,
                )}
                validate={(v) =>
                  v > calibration.maxAge
                    ? tr(
                        '最小年龄不能大于最大年龄（Min age ≤ Max age）',
                        'Minimum age cannot exceed maximum age (Min age ≤ Max age)',
                      )
                    : null
                }
                onCommit={(v) =>
                  v !== undefined &&
                  apply((d) => {
                    const c = d.calibrationPoints.find((cp) => cp.nodeId === id);
                    if (c) updateCalibrationPoint(d, c.id, { minAge: v });
                  })
                }
              />
            </Field>
            <Field label={S.node.calibrationMax}>
              <NumberField
                value={calibration.maxAge}
                step={0.1}
                min={0}
                unit={timeUnitSymbol(timeUnit)}
                unitTitle={tr(
                  `年龄（单位：${timeUnitLabel(timeUnit)}）；Ma = 百万年前`,
                  `Age in ${timeUnitLabel(timeUnit)}; Ma = million years ago`,
                )}
                validate={(v) =>
                  v < calibration.minAge
                    ? tr(
                        '最大年龄不能小于最小年龄（Max age ≥ Min age）',
                        'Maximum age cannot be less than minimum age (Max age ≥ Min age)',
                      )
                    : null
                }
                onCommit={(v) =>
                  v !== undefined &&
                  apply((d) => {
                    const c = d.calibrationPoints.find((cp) => cp.nodeId === id);
                    if (c) updateCalibrationPoint(d, c.id, { maxAge: v });
                  })
                }
              />
            </Field>
            <div className="hint">
              {tr('此节点已绑定校准区间', 'This node has a calibration range')}
              {calibration.minAge}–{calibration.maxAge} {timeUnit}
            </div>
            <div className="hint">
              {tr(
                '默认状态为无校准覆盖；重置不会改写节点年龄。',
                'The default is no calibration override; reset leaves the node age unchanged.',
              )}
            </div>
            <div className="field row-actions">
              <button
                className="btn danger"
                title={tr(
                  '移除该节点的时间校准覆盖；不恢复样本数值',
                  'Remove this node’s time calibration override; no sample values are restored',
                )}
                onClick={() =>
                  apply((d) => {
                    d.calibrationPoints = d.calibrationPoints.filter(
                      (cp) => cp.nodeId !== id,
                    );
                  })
                }
              >
                {tr('恢复默认（移除校准）', 'Reset to default (remove calibration)')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="hint">{S.node.noCalibration}</div>
            <div className="field row-actions">
              <button
                className="btn"
                onClick={() =>
                  apply((d) =>
                    setCalibrationForNode(
                      d,
                      id,
                      node.age ? Math.floor(node.age * 0.9) : 0,
                      node.age ? Math.ceil(node.age * 1.1) : 100,
                    ),
                  )
                }
              >
                {S.node.addCalibration}
              </button>
            </div>
          </>
        )}
      </Section>

      {overridden && (
        <div className="override-badge active" title={S.inspector.restoreDefaultTitle}>
          <span>{S.inspector.overridden}</span>
          <button
            className="override-restore"
            onClick={() => apply((d) => {
              delete d.nodes[id].style;
              delete d.nodes[id].branchStyle;
            })}
          >
            {S.inspector.restoreDefault}
          </button>
        </div>
      )}

      <Section
        title={S.node.styleSection}
        defaultOpen={false}
        searchQuery={search}
        favoritable
        keywords={NODE_SECTION_KEYWORDS.styleSection}
      >
        <Field label={S.node.shape}>
          <select value={style.shape} onChange={(e) => ns({ shape: e.target.value as NodeShape })}>
            <option value="circle">{S.node.shapeCircle}</option>
            <option value="square">{S.node.shapeSquare}</option>
            <option value="diamond">{S.node.shapeDiamond}</option>
            <option value="none">{S.node.shapeNone}</option>
          </select>
        </Field>
        <Field label={S.node.size}>
          <SliderNumberField
            value={style.size}
            min={1}
            max={40}
            unit="px"
            recipe={(v) => (d) => setNodeStyle(d, id, { size: v })}
          />
        </Field>
        <Field label={S.node.fill}>
          <ColorField value={style.fill} onChange={(v) => ns({ fill: v })} />
        </Field>
        <Field label={S.node.stroke}>
          <ColorField value={style.stroke} onChange={(v) => ns({ stroke: v })} />
        </Field>
        <Field label={S.node.strokeWidth}>
          <SliderNumberField
            value={style.strokeWidth}
            min={0}
            max={10}
            step={0.5}
            unit="px"
            recipe={(v) => (d) => setNodeStyle(d, id, { strokeWidth: v })}
          />
        </Field>
      </Section>

      <Section
        title={S.node.labelSection}
        defaultOpen={false}
        searchQuery={search}
        favoritable
        keywords={NODE_SECTION_KEYWORDS.labelSection}
      >
        <SwitchField
          label={S.node.showLabel}
          checked={style.showLabel}
          onChange={(v) => ns({ showLabel: v })}
        />
        <Field label={S.node.labelColor}>
          <ColorField value={style.labelColor} onChange={(v) => ns({ labelColor: v })} />
        </Field>
        <Field label={S.node.fontSize}>
          <SliderNumberField
            value={style.fontSize}
            min={6}
            max={48}
            unit="px"
            recipe={(v) => (d) => setNodeStyle(d, id, { fontSize: v })}
          />
        </Field>
        <Field label={S.node.fontWeight}>
          <FontWeightSelect value={weight} onChange={(v) => ns({ fontWeight: v })} />
        </Field>
        <Field label={S.node.rotation}>
          <SliderNumberField
            value={style.labelRotation}
            min={-180}
            max={180}
            step={5}
            unit="°"
            recipe={(v) => (d) => setNodeStyle(d, id, { labelRotation: v })}
          />
        </Field>
        <SwitchField
          label={S.node.italic}
          checked={style.fontStyle === 'italic'}
          onChange={(v) => ns({ fontStyle: v ? 'italic' : 'normal' })}
        />
        <SwitchField
          label={S.node.bold}
          checked={weight >= 600}
          onChange={(v) => ns({ fontWeight: v ? 700 : 400 })}
        />
        <Field label={S.node.labelPosition}>
          <LabelPositionController
            value={style.labelPosition ?? 'auto'}
            onChange={(v) => ns({ labelPosition: v })}
          />
        </Field>
        <Field label={S.node.labelOffsetX}>
          <SliderNumberField
            value={style.labelOffsetX ?? 0}
            sliderMin={-100}
            sliderMax={100}
            step={1}
            unit="px"
            recipe={(v) => (d) => setNodeStyle(d, id, { labelOffsetX: v })}
          />
        </Field>
        <Field label={S.node.labelOffsetY}>
          <SliderNumberField
            value={style.labelOffsetY ?? 0}
            sliderMin={-100}
            sliderMax={100}
            step={1}
            unit="px"
            recipe={(v) => (d) => setNodeStyle(d, id, { labelOffsetY: v })}
          />
        </Field>
      </Section>


      <Section title={S.node.nodeActions} defaultOpen={true} searchQuery={search} keywords={['删除', '移除', '重置位置', '展开', '折叠', 'delete', 'remove', 'reset', 'expand', 'collapse']}>
        {/* 用户反馈: the row keeps the SAME shape whether or not the node was
            hand-placed — 清除手动位置 stays put and is simply disabled until a
            manual position exists, instead of popping in mid-row. */}
        <div className="field row-actions-spread">
          <div className="actions-group">
            <button
              className="btn"
              disabled={!node.pinned}
              title={node.pinned ? undefined : tr('该节点尚未手动调整位置', 'This node has no manual position yet')}
              onClick={() => apply((d) => unpinNode(d, id))}
            >
              {S.node.resetPosition}
            </button>
          </div>
          <div className="actions-group">
            {/* Copy/paste style (ID-11): the resolved node + incoming-branch
                styles, applied as overrides on the target. */}
            <button
              className="btn"
              title={tr('复制该节点的节点与枝样式', 'Copy this node’s node and branch styles')}
              onClick={() => {
                copyStyle({ node: style, branch });
                notify.success(tr('已复制样式', 'Style copied'));
              }}
            >
              {tr('复制样式', 'Copy style')}
            </button>
            {styleClipboard && (
              <button
                className="btn"
                title={tr('粘贴先前复制的样式（覆盖当前值）', 'Paste the previously copied styles (overrides current values)')}
                onClick={() =>
                  apply((d) => {
                    if (styleClipboard.node) setNodeStyle(d, id, styleClipboard.node);
                    if (styleClipboard.branch) setBranchStyle(d, id, styleClipboard.branch);
                  })
                }
              >
                {tr('粘贴样式', 'Paste style')}
              </button>
            )}
          </div>
          {node.parentId !== null && (
            <button className="btn danger" onClick={requestDelete}>
              {S.node.delete}
            </button>
          )}
        </div>
      </Section>
    </>
  );
}

function MultiPanel({
  selection,
  project,
  apply,
  search,
}: {
  selection: NodeId[];
  project: Project;
  apply: Apply;
  search: string;
}) {
  const clearSelection = useStore((s) => s.clearSelection);
  // ID-11 (batch half): copy the FIRST selected node's resolved style, then
  // paste it onto the whole selection in one undoable step.
  const styleClipboard = useStore((s) => s.styleClipboard);
  const copyStyle = useStore((s) => s.copyStyle);
  const first = project.nodes[selection[0]];
  const style = first ? resolveNodeStyle(first, project) : project.defaults.node;
  const branch = first ? resolveBranchStyle(first, project) : project.defaults.branch;

  const nsAll = (patch: Parameters<typeof setNodeStyle>[2]) =>
    apply((d) => {
      for (const id of selection) setNodeStyle(d, id, patch);
    });
  const bsAll = (patch: Parameters<typeof setBranchStyle>[2]) =>
    apply((d) => {
      for (const id of selection) setBranchStyle(d, id, patch);
    });

  return (
    <>
      <Section title={S.multi.section} searchQuery={search}>
        <div className="hint">{selectedCount(selection.length)}</div>
      </Section>

      <Section title={S.multi.applyToAll} searchQuery={search} favoritable>
        <Field label={S.multi.fill}>
          <ColorField value={style.fill} onChange={(v) => nsAll({ fill: v })} />
        </Field>
        <Field label={S.multi.stroke}>
          <ColorField value={style.stroke} onChange={(v) => nsAll({ stroke: v })} />
        </Field>
        <Field label={S.multi.nodeSize}>
          <SliderNumberField
            value={style.size}
            min={1}
            max={40}
            unit="px"
            recipe={(v) => (d) => {
              for (const nodeId of selection) setNodeStyle(d, nodeId, { size: v });
            }}
          />
        </Field>
        <Field label={S.multi.labelColor}>
          <ColorField value={style.labelColor} onChange={(v) => nsAll({ labelColor: v })} />
        </Field>
        <Field label={S.multi.fontSize}>
          <SliderNumberField
            value={style.fontSize}
            min={6}
            max={48}
            unit="px"
            recipe={(v) => (d) => {
              for (const nodeId of selection) setNodeStyle(d, nodeId, { fontSize: v });
            }}
          />
        </Field>
        <Field label={S.multi.branchColor}>
          <ColorField value={branch.color} onChange={(v) => bsAll({ color: v })} />
        </Field>
        {/* ID-10: the batch panel used to cover only colours and font size;
            shape / weight / label placement / branch width & dash are the
            same per-node properties and now batch too, so a multi-selection
            is no longer a second-class styling citizen. */}
        <Field label={S.node.shape}>
          <select value={style.shape} onChange={(e) => nsAll({ shape: e.target.value as NodeShape })}>
            <option value="circle">{S.node.shapeCircle}</option>
            <option value="square">{S.node.shapeSquare}</option>
            <option value="diamond">{S.node.shapeDiamond}</option>
            <option value="none">{S.node.shapeNone}</option>
          </select>
        </Field>
        <Field label={S.node.fontWeight}>
          <FontWeightSelect
            value={fontWeightValue(style.fontWeight)}
            onChange={(v) => nsAll({ fontWeight: v })}
          />
        </Field>
        <Field label={S.node.labelPosition}>
          <LabelPositionController
            value={style.labelPosition ?? 'auto'}
            onChange={(v) => nsAll({ labelPosition: v })}
          />
        </Field>
        <Field label={S.node.width}>
          <SliderNumberField
            value={branch.width}
            min={0.5}
            max={40}
            step={0.5}
            unit="px"
            recipe={(v) => (d) => {
              for (const nodeId of selection) setBranchStyle(d, nodeId, { width: v });
            }}
          />
        </Field>
        <Field label={S.node.dash}>
          <DashSelect value={branch.dash} onChange={(v) => bsAll({ dash: v })} />
        </Field>
        <Field label={S.node.branchShape}>
          <BranchShapeSelect
            value={branch.shape}
            onChange={(shape) =>
              apply((d) => {
                // Same width coupling as the single-node editor: switching to a
                // thick bar shape needs a wide default, switching back to a
                // thin line must not leave a 10 px hairline.
                for (const nodeId of selection) {
                  const current = resolveBranchStyle(d.nodes[nodeId], d);
                  const patch: Partial<BranchStyle> = { shape };
                  if (shape === 'line' || shape === 'curved') {
                    if (current.width > 4) patch.width = 1.5;
                  } else if (current.width < 4) {
                    patch.width = 8;
                  }
                  setBranchStyle(d, nodeId, patch);
                }
              })
            }
          />
        </Field>
        <div className="field row-actions">
          <button
            className="btn"
            title={tr('以首个选中节点的样式为来源复制', 'Copy the style of the first selected node')}
            onClick={() => {
              copyStyle({ node: style, branch });
              notify.success(tr('已复制样式', 'Style copied'));
            }}
          >
            {tr('复制样式', 'Copy style')}
          </button>
          {styleClipboard && (
            <button
              className="btn"
              title={tr('把复制的样式粘贴到全部选中节点', 'Paste the copied style onto every selected node')}
                onClick={() =>
                  apply((d) => {
                    for (const nodeId of selection) {
                      if (styleClipboard.node) setNodeStyle(d, nodeId, styleClipboard.node);
                      if (styleClipboard.branch) setBranchStyle(d, nodeId, styleClipboard.branch);
                    }
                  })
                }
            >
              {tr('粘贴样式到全部', 'Paste style to all')}
            </button>
          )}
        </div>
      </Section>

      {/* 用户反馈: the batch 性状状态 editor is gone from the multi-select
          panel too — character-state editing no longer lives in the inspector. */}

      <Section title={S.node.delete} searchQuery={search} keywords={['删除', '批量', '移除', 'delete', 'batch', 'remove']}>
        <div className="field row-actions-spread">
          <div className="actions-group">
            <button className="btn" onClick={() => nsAll({ showLabel: true })}>
              {S.multi.showLabel}
            </button>
            <button className="btn" onClick={() => nsAll({ showLabel: false })}>
              {S.multi.hideLabel}
            </button>
          </div>
          <button
            className="btn danger"
            onClick={() => {
              const ids = selection;
              // Same shared flow as the single-node and canvas paths; its own skip key.
              requestDeletion(project, ids, 'inspector-multi', () => {
                apply((d) => {
                  for (const sid of ids) deleteNode(d, sid, true);
                });
                clearSelection();
              });
            }}
          >
            {S.multi.deleteSelected}
          </button>
        </div>
      </Section>
    </>
  );
}

function EdgePanel({ edge, apply, search }: { edge: CustomEdge; apply: Apply; search: string }) {
  const selectEdge = useStore((s) => s.selectEdge);
  const id = edge.id;
  const es = (patch: Parameters<typeof setEdgeStyle>[2]) => apply((d) => setEdgeStyle(d, id, patch));
  return (
    <Section title={S.edge.section} searchQuery={search} favoritable>
      <Field label={S.edge.label}>
        <TextField value={edge.label ?? ''} onCommit={(v) => apply((d) => setEdgeLabel(d, id, v))} />
      </Field>
      <Field label={S.edge.color}>
        <ColorField value={edge.style.color} onChange={(v) => es({ color: v })} />
      </Field>
      <Field label={S.edge.width}>
        <SliderNumberField
          value={edge.style.width}
          min={0.5}
          max={10}
          step={0.5}
          unit="px"
          recipe={(v) => (d) => setEdgeStyle(d, id, { width: v })}
        />
      </Field>
      <Field label={S.edge.dash}>
        <DashSelect value={edge.style.dash} onChange={(v) => es({ dash: v })} />
      </Field>
      <SwitchField
        label={S.edge.arrow}
        checked={edge.style.arrow}
        onChange={(v) => es({ arrow: v })}
      />
      <Field label={S.edge.curvature}>
        <SliderNumberField
          value={edge.style.curvature}
          min={0}
          max={1}
          step={0.05}
          recipe={(v) => (d) => setEdgeStyle(d, id, { curvature: v })}
        />
      </Field>
      <div className="field row-actions-spread">
        <div />
        <button
          className="btn ghost-danger"
          onClick={() => {
            // M25 (UI_UX_REVIEW): edge deletion had NO confirmation on the
            // inspector path while node deletion did — one policy, guarded.
            requestConfirm({
              key: 'delete-custom-edge',
              title: S.edge.delete,
              message: tr('删除后可用撤销恢复（⌘Z）。', 'The deletion can be undone (⌘Z).'),
              confirmLabel: S.edge.delete,
              danger: true,
              onConfirm: () => {
                apply((d) => removeCustomEdge(d, id));
                selectEdge(null);
              },
            });
          }}
        >
          {S.edge.delete}
        </button>
      </div>
    </Section>
  );
}

// --- Global default editing is deliberately absent from the inspector -------
// Project-wide defaults (node / branch / edge styles, canvas background) are
// edited ONLY in the left "样式" module (LayoutPanel). Keeping two entry
// points for the same defaults confuses users about "which one wins", so the
// inspector is purely per-object editing. The override badge in NodePanel
// makes the global→object inheritance relationship explicit.

/**
 * FNV-1a over everything parsimony depends on: the tree's TOPOLOGY (root, each
 * node's identity, parent and ordered children), the character definitions, and
 * each node's state assignment for each character.
 *
 * Deliberately EXCLUDES positions, selection, view transform, layout and style —
 * i.e. exactly the fields a drag rewrites on every frame.
 *
 * The topology half is not optional: `parsimony` walks parent→children, so
 * reparenting, mirroring a node's children, or re-rooting changes the optimum
 * while leaving the node count and every state assignment untouched. A
 * fingerprint without topology would keep serving the previous answer for those
 * edits, and the panel would show suggestions the tree no longer supports.
 */
export function characterDataSignature(project: Project): string {
  let h = 2166136261;
  const mix = (v: number) => {
    h = ((h ^ (v | 0)) * 16777619) >>> 0;
  };
  const hashString = (s: string) => {
    let g = 5381;
    for (let i = 0; i < s.length; i += 1) g = ((g * 33) ^ s.charCodeAt(i)) | 0;
    return g;
  };
  const nodes = Object.values(project.nodes);
  mix(nodes.length);
  mix(project.characters.length);

  // Topology, once rather than per character: cost is O(total child references),
  // small next to the O(N·K²) pass it is protecting.
  mix(hashString(project.rootId));
  for (const n of nodes) {
    mix(hashString(n.id));
    mix(n.parentId == null ? -1 : hashString(n.parentId));
    mix(n.childrenIds.length);
    for (const child of n.childrenIds) mix(hashString(child));
  }

  for (const c of project.characters) {
    mix(c.states.length);
    mix(c.type === 'discrete' ? 1 : 2);
    // The Sankoff step matrix changes the optimum, so it must be in the
    // fingerprint too — `Character` has no `ordered` flag.
    if (c.costMatrix) {
      for (const row of c.costMatrix) for (const v of row) mix(v + 1);
    } else {
      mix(-1);
    }
    for (const n of nodes) {
      const s = n.charStates?.[c.id];
      if (s === undefined) { mix(0); continue; }
      if (typeof s === 'number') { mix(Math.round(s * 1000)); continue; }
      // A polymorphic set hashes as its '/'-joined display form, consistent
      // with every other set rendering.
      mix(hashString(Array.isArray(s) ? s.join('/') : s));
    }
  }
  return String(h);
}

export function PropertiesPanel() {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const [search, setSearch] = useState('');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [showNoResults, setShowNoResults] = useState(false);

  const hasSelection = selection.length > 0 || Boolean(selectedEdgeId);

  const content = useMemo(() => {
    // NOTE: the reconciliation inspector does NOT live here any more — the
    // reconciliation workspace renders its own four-state `ReconInspector`.
    // This panel is the STANDARD inspector only, which also removes the old
    // half-finished `reconEditActive` flag (it was computed and never used).
    if (selectedEdgeId) {
      const edge = project.customEdges.find((e) => e.id === selectedEdgeId);
      // key={edge.id} forces React to remount EdgePanel (and its buffered
      // TextField / NumberField children) when switching between custom
      // edges. Without the key, React reuses the same component instances
      // and the buffered local state from the previously-selected edge
      // leaks into the new one whenever property values happen to match,
      // making it appear as though the properties can't be edited.
      if (edge) return <EdgePanel key={edge.id} edge={edge} apply={apply} search={search} />;
    }

    if (selection.length === 1) {
      const node = project.nodes[selection[0]];
      if (node)
        return (
          <NodePanel
            key={node.id}
            node={node}
            project={project}
            apply={apply}
            search={search}
          />
        );
    }

    if (selection.length > 1) {
      return <MultiPanel selection={selection} project={project} apply={apply} search={search} />;
    }

    return (
      <div className="inspector-empty">
        <div className="inspector-empty-title">{S.inspector.empty}</div>
        <div className="inspector-empty-hint">{S.inspector.emptyHint}</div>
        {/* 用户反馈: the counts line and the ⌘K tip are gone, and the two lines
            above are centred. The sample-library action stays. */}
        <div className="inspector-empty-actions">
          <button
            className="btn"
            onClick={() => file.openAppDialog('sampleLibrary')}
          >
            {tr('打开示例库…', 'Open sample library…')}
          </button>
        </div>
      </div>
    );
  }, [project, apply, selection, selectedEdgeId, search]);

  // After rendering, detect whether any Section survived the keyword filter;
  // if not, show a "no matching property" hint with a pointer to the global
  // defaults in the left "样式" module.
  //
  // Filterable Sections are the primary hits. A few inspector blocks are plain
  // `.panel-section`s that the query does not filter (the evolutionary-event
  // editor is one): counting them unconditionally would permanently suppress
  // the hint — and with it the "⌘K searches all modules" pointer — for every
  // node in a project with characters. They count as a hit only when their own
  // text contains the query, which is what the user can actually see.
  useEffect(() => {
    const root = contentRef.current;
    const q = search.trim().toLowerCase();
    if (q === '' || !hasSelection || !root) {
      setShowNoResults(false);
      return;
    }
    const sectionHit = Boolean(root.querySelector('.panel-section .section-toggle'));
    const unfilteredHit = [...root.querySelectorAll('.panel-section')]
      .filter((el) => !el.querySelector('.section-toggle'))
      .some((el) => (el.textContent ?? '').toLowerCase().includes(q));
    setShowNoResults(!sectionHit && !unfilteredHit);
  }, [search, hasSelection, content]);

  const hasNoResults = search.trim() !== '' && hasSelection && showNoResults;

  return (
    <>
      {/* Inspector search: live-filters sections by title AND field keywords.
          It only exists once there is something to search. */}
      {hasSelection && (
        <div className="inspector-search">
          <MagnifyingGlassIcon />
          <input
            id="inspector-search"
            type="text"
            aria-label={S.inspector.searchPlaceholder}
            placeholder={S.inspector.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Panel content. BUG-15: favourited sections float to the top (flex
          order), so the star has a visible effect instead of only colouring. */}
      <div ref={contentRef} className="inspector-content">{content}</div>
      {hasNoResults && (
        <div className="panel-section">
          <h3>{S.inspector.noResults}</h3>
          <div className="hint">{S.inspector.noResultsHint}</div>
          <div className="hint hint-tip">
            {tr(
              '提示：按 ⌘K 可在全部模块与命令中搜索。',
              'Tip: press ⌘K to search all modules and commands.',
            )}
          </div>
        </div>
      )}
    </>
  );
}
