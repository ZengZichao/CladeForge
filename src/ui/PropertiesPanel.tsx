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
  setNodeCharMeta,
  setNodeState,
  setNodeStyle,
  toggleCollapse,
  unpinNode,
} from '../model/treeOps';
import {
  fontWeightValue,
  resolveBranchStyle,
  resolveNodeStyle,
  type BranchShape,
  type Character,
  type Confidence,
  type CustomEdge,
  type HypothesisMeta,
  type LabelPosition,
  type NodeId,
  type NodeShape,
  type Project,
  type TreeNode,
} from '../model/types';
import {
  BranchShapeSelect,
  CheckboxField,
  ColorField,
  DashSelect,
  Field,
  FontWeightSelect,
  NumberField,
  RangeField,
  TextField,
} from './fields';
import { Section } from './Section';
import { stateLabel } from '../model/characters';
import { parsimony, type ParsimonyResult } from '../model/parsimony';
import { EventEditor } from './EventEditor';
import { GeneAssumptionInspector } from './ReconInspector';
import { requestDeletion } from './deleteGuard';
import { S, tr, selectedCount } from './strings';


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
  section: ['名称', '枝长', '支持率', '年代', '时间', 'name', 'branch length', 'support', 'age'],
  timeConstraintSection: ['时间约束', '校准', '区间', '最小年代', '最大年代', 'calibration', 'constraint', 'min age', 'max age'],
  styleSection: ['填充色', '描边色', '大小', '形状', '描边', '颜色', '字号', 'fill', 'stroke', 'size', 'shape', 'colour', 'color'],
  labelSection: ['标签', '字号', '字体', '颜色', '旋转', '斜体', '加粗', '字重', '位置', '方位', '偏移', 'label', 'font', 'size', 'colour', 'color', 'rotate', 'italic', 'bold', 'position', 'offset'],
  branchSection: ['分支', '颜色', '线宽', '线型', '粗细', '形状', 'branch', 'colour', 'color', 'width', 'dash', 'shape'],
};

// One character's row in a node's "character state" section.
function NodeCharRow({
  character,
  node,
  apply,
  suggestion,
}: {
  character: Character;
  node: TreeNode;
  apply: Apply;
  suggestion?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = node.id;
  const val = node.charStates?.[character.id];
  const meta = node.charMeta?.[character.id];
  const assigned = val !== undefined && val !== '';
  const cm = (patch: Partial<HypothesisMeta>) =>
    apply((d) => setNodeCharMeta(d, id, character.id, patch));
  return (
    <>
      <div className="field">
        <label>{character.name}</label>
        <div className="char-value">
          {character.type === 'discrete' ? (
            <select
              value={typeof val === 'string' ? val : ''}
              onChange={(e) => apply((d) => setNodeState(d, id, character.id, e.target.value))}
            >
              <option value="">{S.nodeChar.unassigned}</option>
              {character.states.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>
          ) : (
            <NumberField
              value={typeof val === 'number' ? val : undefined}
              allowEmpty
              onCommit={(v) => apply((d) => setNodeState(d, id, character.id, v))}
            />
          )}
          <button
            className="btn icon"
            title={S.nodeChar.evidence}
            disabled={!assigned}
            onClick={() => setOpen((o) => !o)}
          >
            ▾
            {meta && (
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  display: 'inline-block',
                  marginLeft: 2,
                  flexShrink: 0,
                }}
              />
            )}
          </button>
        </div>
      </div>
      {suggestion && suggestion !== (typeof val === 'string' ? val : '') && (
        <div className="char-suggest">
          <span>
            {S.nodeChar.suggest}: {stateLabel(character, suggestion)}
          </span>
          <button
            className="btn"
            onClick={() => apply((d) => setNodeState(d, node.id, character.id, suggestion))}
          >
            {S.nodeChar.accept}
          </button>
        </div>
      )}
      {open && assigned && (
        <div className="char-meta">
          <Field label={S.confidence.label}>
            <select
              value={meta?.confidence ?? ''}
              onChange={(e) =>
                cm({ confidence: (e.target.value || undefined) as Confidence | undefined })
              }
            >
              <option value="">{S.confidence.none}</option>
              <option value="high">{S.confidence.high}</option>
              <option value="medium">{S.confidence.medium}</option>
              <option value="low">{S.confidence.low}</option>
            </select>
          </Field>
          <Field label={S.confidence.support}>
            <TextField value={meta?.support ?? ''} onCommit={(v) => cm({ support: v })} />
          </Field>
          <Field label={S.confidence.against}>
            <TextField value={meta?.against ?? ''} onCommit={(v) => cm({ against: v })} />
          </Field>
        </div>
      )}
    </>
  );
}

// --- Label position controller (directional pad + XY offsets) ---------------

// The nine label-placement buttons. The tooltip is translated AT RENDER TIME
// (`tr(p.zh, p.en)` below): a module-level `title: tr(...)` would freeze
// whichever language was active at import, so after a language switch every
// tooltip would keep saying 左上/Top-left in the wrong language.
const LABEL_POSITIONS: { value: LabelPosition; icon: string; zh: string; en: string }[] = [
  { value: 'top-left', icon: '↖', zh: '左上', en: 'Top-left' },
  { value: 'top', icon: '↑', zh: '上', en: 'Top' },
  { value: 'top-right', icon: '↗', zh: '右上', en: 'Top-right' },
  { value: 'left', icon: '←', zh: '左', en: 'Left' },
  { value: 'auto', icon: '⊙', zh: '自动', en: 'Auto' },
  { value: 'right', icon: '→', zh: '右', en: 'Right' },
  { value: 'bottom-left', icon: '↙', zh: '左下', en: 'Bottom-left' },
  { value: 'bottom', icon: '↓', zh: '下', en: 'Bottom' },
  { value: 'bottom-right', icon: '↘', zh: '右下', en: 'Bottom-right' },
];

function LabelPositionController({
  value,
  onChange,
}: {
  value: LabelPosition;
  onChange: (v: LabelPosition) => void;
}) {
  return (
    <div className="label-position-pad">
      {LABEL_POSITIONS.map((p) => (
        <button
          key={p.value}
          className={`label-position-btn${value === p.value ? ' active' : ''}`}
          title={tr(p.zh, p.en)}
          onClick={() => onChange(p.value)}
        >
          {p.icon}
        </button>
      ))}
    </div>
  );
}

function NodePanel({
  node,
  project,
  apply,
  search,
  parsimonyResults,
}: {
  node: TreeNode;
  project: Project;
  apply: Apply;
  search: string;
  /** Per-character parsimony results, computed ONCE per project (shared by every node). */
  parsimonyResults: Map<string, ParsimonyResult>;
}) {
  const clearSelection = useStore((s) => s.clearSelection);
  const style = resolveNodeStyle(node, project);
  const branch = resolveBranchStyle(node, project);
  const id = node.id;
  const isLeaf = node.childrenIds.length === 0;

  // Unified data model: the calibration point for this node
  // (if any) is the SAME data source shown in the left "时间" panel's
  // calibration manager. Editing min/max age here updates the calibration
  // point directly, and editing the node's scalar age stays within the
  // [minAge, maxAge] constraint.
  const calibration = getCalibrationForNode(project, id);

  // Override-relationship badge: once the user touches any
  // per-node style, this node "overrides" the global default.
  const overridden = Boolean(node.style) || Boolean(node.branchStyle);

  const suggestions = useMemo(() => {
    const map = new Map<string, string>();
    if (node.childrenIds.length === 0) return map;
    for (const [cid, result] of parsimonyResults) {
      // The tie-broken state, not `states[0]`. `states` is ordered by state
      // declaration, so its first element can be a different state from the one
      // the reported cost and the canvas change-flags were computed on — the
      // panel would then suggest "B" next to a branch the drawing marks as
      // "unchanged from the parent's A". `fillParsimony` reports on the same
      // tie-broken state, so the suggestion and the drawing agree.
      const s = result.chosen.get(id) ?? result.states.get(id)?.[0];
      if (s) map.set(cid, s);
    }
    return map;
  }, [parsimonyResults, id, node.childrenIds.length]);
  const ns = (patch: Parameters<typeof setNodeStyle>[2]) => apply((d) => setNodeStyle(d, id, patch));
  const bs = (patch: Parameters<typeof setBranchStyle>[2]) =>
    apply((d) => setBranchStyle(d, id, patch));
  const weight = fontWeightValue(style.fontWeight);
  const setNodeBranchShape = (shape: BranchShape) => {
    const patch: Parameters<typeof setBranchStyle>[2] = { shape };
    if (shape === 'line') {
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
        count={4}
        keywords={NODE_SECTION_KEYWORDS.section}
      >
        <Field label={S.node.name}>
          <TextField value={node.label} onCommit={(v) => apply((d) => renameNode(d, id, v))} />
        </Field>
        <Field label={S.node.branchLength}>
          <NumberField
            value={node.branchLength}
            allowEmpty
            min={0}
            step={0.1}
            onCommit={(v) => apply((d) => setBranchLength(d, id, v))}
          />
        </Field>
        <Field label={S.node.support}>
          <NumberField
            value={node.support}
            allowEmpty
            min={0}
            unit={tr("0–1 或 0–100", "0–1 or 0–100")}
            onCommit={(v) =>
              apply((d) => {
                const n = d.nodes[id];
                if (n) n.support = v;
              })
            }
          />
        </Field>
        <Field label={S.node.age}>
          <NumberField
            value={node.age}
            allowEmpty
            step={0.1}
            min={calibration?.minAge}
            max={calibration?.maxAge}
            unit={project.layout.timeUnit ?? 'Ma'}
            onCommit={(v) => apply((d) => setNodeAge(d, id, v))}
          />
        </Field>
      </Section>

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
                onCommit={(v) =>
                  v !== undefined &&
                  apply((d) => {
                    const c = d.calibrationPoints.find((cp) => cp.nodeId === id);
                    if (c) c.minAge = v;
                  })
                }
              />
            </Field>
            <Field label={S.node.calibrationMax}>
              <NumberField
                value={calibration.maxAge}
                step={0.1}
                min={0}
                onCommit={(v) =>
                  v !== undefined &&
                  apply((d) => {
                    const c = d.calibrationPoints.find((cp) => cp.nodeId === id);
                    if (c) c.maxAge = v;
                  })
                }
              />
            </Field>
            <div className="hint">
              {tr('此节点已绑定校准区间', 'This node has a calibration range')}
              {calibration.minAge}–{calibration.maxAge} {project.layout.timeUnit ?? 'Ma'}
            </div>
            <div className="field row-actions">
              <button
                className="btn danger"
                onClick={() =>
                  apply((d) => {
                    d.calibrationPoints = d.calibrationPoints.filter(
                      (cp) => cp.nodeId !== id,
                    );
                  })
                }
              >
                {tr('移除校准', 'Remove calibration')}
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

      <div className={`override-badge${overridden ? ' active' : ''}`} title={S.inspector.restoreDefaultTitle}>
        <span>{overridden ? S.inspector.overridden : S.inspector.inherited}</span>
        {overridden && (
          <button
            className="override-restore"
            onClick={() => apply((d) => {
              delete d.nodes[id].style;
              delete d.nodes[id].branchStyle;
            })}
          >
            {S.inspector.restoreDefault}
          </button>
        )}
      </div>

      <Section
        title={S.node.styleSection}
        defaultOpen={false}
        searchQuery={search}
        favoritable
        count={5}
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
          <NumberField value={style.size} min={1} max={40} onCommit={(v) => ns({ size: v })} />
        </Field>
        <Field label={S.node.fill}>
          <ColorField value={style.fill} onChange={(v) => ns({ fill: v })} />
        </Field>
        <Field label={S.node.stroke}>
          <ColorField value={style.stroke} onChange={(v) => ns({ stroke: v })} />
        </Field>
        <Field label={S.node.strokeWidth}>
          <NumberField
            value={style.strokeWidth}
            min={0}
            max={10}
            step={0.5}
            onCommit={(v) => ns({ strokeWidth: v })}
          />
        </Field>
      </Section>

      <Section
        title={S.node.labelSection}
        defaultOpen={false}
        searchQuery={search}
        favoritable
        count={7}
        keywords={NODE_SECTION_KEYWORDS.labelSection}
      >
        <CheckboxField
          label={S.node.showLabel}
          checked={style.showLabel}
          onChange={(v) => ns({ showLabel: v })}
        />
        <Field label={S.node.labelColor}>
          <ColorField value={style.labelColor} onChange={(v) => ns({ labelColor: v })} />
        </Field>
        <Field label={S.node.fontSize}>
          <NumberField
            value={style.fontSize}
            min={6}
            max={48}
            onCommit={(v) => ns({ fontSize: v })}
          />
        </Field>
        <Field label={S.node.fontWeight}>
          <FontWeightSelect value={weight} onChange={(v) => ns({ fontWeight: v })} />
        </Field>
        <Field label={S.node.rotation}>
          <NumberField
            value={style.labelRotation}
            min={-180}
            max={180}
            step={5}
            onCommit={(v) => v !== undefined && ns({ labelRotation: v })}
          />
        </Field>
        <CheckboxField
          label={S.node.italic}
          checked={style.fontStyle === 'italic'}
          onChange={(v) => ns({ fontStyle: v ? 'italic' : 'normal' })}
        />
        <CheckboxField
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
          <NumberField
            value={style.labelOffsetX ?? 0}
            step={1}
            onCommit={(v) => ns({ labelOffsetX: v })}
          />
        </Field>
        <Field label={S.node.labelOffsetY}>
          <NumberField
            value={style.labelOffsetY ?? 0}
            step={1}
            onCommit={(v) => ns({ labelOffsetY: v })}
          />
        </Field>
      </Section>

      <Section
        title={S.node.branchSection}
        defaultOpen={false}
        searchQuery={search}
        favoritable
        count={4}
        keywords={NODE_SECTION_KEYWORDS.branchSection}
      >
        <Field label={S.node.branchShape}>
          <BranchShapeSelect value={branch.shape} onChange={setNodeBranchShape} />
        </Field>
        <Field label={S.node.color}>
          <ColorField value={branch.color} onChange={(v) => bs({ color: v })} />
        </Field>
        <Field label={S.node.width}>
          <NumberField
            value={branch.width}
            min={0.5}
            max={40}
            step={0.5}
            onCommit={(v) => bs({ width: v })}
          />
        </Field>
        <Field label={S.node.dash}>
          <DashSelect value={branch.dash} onChange={(v) => bs({ dash: v })} />
        </Field>
      </Section>

      {project.characters.length > 0 && (
        <Section
          title={S.nodeChar.section}
          searchQuery={search}
          favoritable
          keywords={['性状', '状态', '祖先状态', '证据', 'character', 'state', 'ancestral', 'evidence']}
        >
          <div className="hint">{isLeaf ? S.nodeChar.tipHint : S.nodeChar.internalHint}</div>
          {project.characters.map((c) => (
            <NodeCharRow
              key={c.id}
              character={c}
              node={node}
              apply={apply}
              suggestion={suggestions.get(c.id)}
            />
          ))}
        </Section>
      )}

      {project.characters.length > 0 && (
        <EventEditor node={node} project={project} apply={apply} />
      )}

      <Section title={S.node.delete} defaultOpen={true} searchQuery={search} keywords={['删除', '移除', '重置位置', '展开', '折叠', 'delete', 'remove', 'reset', 'expand', 'collapse']}>
        <div className="field row-actions-spread">
          <div className="actions-group">
            {node.childrenIds.length > 0 && (
              <button className="btn" onClick={() => apply((d) => toggleCollapse(d, id))}>
                {node.collapsed ? S.node.expand : S.node.collapse}
              </button>
            )}
            {node.pinned && (
              <button className="btn" onClick={() => apply((d) => unpinNode(d, id))}>
                {S.node.resetPosition}
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
          <NumberField value={style.size} min={1} max={40} onCommit={(v) => nsAll({ size: v })} />
        </Field>
        <Field label={S.multi.labelColor}>
          <ColorField value={style.labelColor} onChange={(v) => nsAll({ labelColor: v })} />
        </Field>
        <Field label={S.multi.fontSize}>
          <NumberField
            value={style.fontSize}
            min={6}
            max={48}
            onCommit={(v) => nsAll({ fontSize: v })}
          />
        </Field>
        <Field label={S.multi.branchColor}>
          <ColorField value={branch.color} onChange={(v) => bsAll({ color: v })} />
        </Field>
      </Section>

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
        <NumberField
          value={edge.style.width}
          min={0.5}
          max={10}
          step={0.5}
          onCommit={(v) => es({ width: v })}
        />
      </Field>
      <Field label={S.edge.dash}>
        <DashSelect value={edge.style.dash} onChange={(v) => es({ dash: v })} />
      </Field>
      <CheckboxField
        label={S.edge.arrow}
        checked={edge.style.arrow}
        onChange={(v) => es({ arrow: v })}
      />
      <Field label={S.edge.curvature}>
        <RangeField
          value={edge.style.curvature}
          min={0}
          max={1}
          step={0.05}
          onCommit={(v) => es({ curvature: v })}
        />
      </Field>
      <div className="field row-actions-spread">
        <div />
        <button
          className="btn danger"
          onClick={() => {
            apply((d) => removeCustomEdge(d, id));
            selectEdge(null);
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
      mix(hashString(s));
    }
  }
  return String(h);
}

export function PropertiesPanel() {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  // Reconciliation mode swaps the inspector to DTL assumption editing.
  const reconMode = useStore((s) => s.reconMode);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const geneSelection = useStore((s) => s.geneSelection);

  const [search, setSearch] = useState('');
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [showNoResults, setShowNoResults] = useState(false);

  const hasSelection = selection.length > 0 || Boolean(selectedEdgeId);
  const reconEditActive = reconMode && Boolean(activeGeneTreeId) && geneSelection.length > 0;

  // PERF: run parsimony ONCE per (character data, character) and share the result
  // across every node's suggestion row — the previous per-node recompute was
  // O(n²) on large trees.
  //
  // Keyed on a fingerprint of the DATA parsimony actually reads, not on
  // `[project]`. `live()` hands back a brand-new Project on every pointer-move
  // during a drag, so a `[project]` key re-ran the full O(N·K²) down/up-pass for
  // every discrete character on every frame — to recompute an answer that cannot
  // have changed, because dragging moves coordinates and touches no state
  // assignment.
  const charData = useMemo(() => characterDataSignature(project), [project]);
  const parsimonyResults = useMemo(() => {
    void charData; // the memo's real dependency: recomputed only when it changes
    const map = new Map<string, ParsimonyResult>();
    for (const c of project.characters) {
      if (c.type !== 'discrete' || c.states.length === 0) continue;
      map.set(c.id, parsimony(project, c));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charData]);

  const content = useMemo(() => {
    // Reconciliation inspector takes priority while a gene node is selected.
    if (reconMode && activeGeneTreeId) {
      if (geneSelection.length === 1) {
        return (
          <GeneAssumptionInspector
            geneTreeId={activeGeneTreeId}
            geneNodeId={geneSelection[0]}
          />
        );
      }
      return (
        <div className="panel-section">
          <h3>{S.reconInspector.title}</h3>
          <div className="hint">{S.reconInspector.emptyHint}</div>
        </div>
      );
    }
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
            parsimonyResults={parsimonyResults}
          />
        );
    }

    if (selection.length > 1) {
      return <MultiPanel selection={selection} project={project} apply={apply} search={search} />;
    }

    return (
      <div className="panel-section">
        <h3>{S.inspector.empty}</h3>
        <div className="hint">{S.inspector.emptyHint}</div>
      </div>
    );
  }, [project, apply, selection, selectedEdgeId, search, parsimonyResults, reconMode, activeGeneTreeId, geneSelection]);

  // After rendering, detect whether any Section survived the keyword filter;
  // if not, show a "no matching property" hint with a pointer to the global
  // defaults in the left "样式" module.
  useEffect(() => {
    if (search.trim() === '' || !hasSelection) {
      setShowNoResults(false);
      return;
    }
    setShowNoResults(!contentRef.current?.querySelector('.panel-section'));
  }, [search, hasSelection, content]);

  const hasNoResults = search.trim() !== '' && hasSelection && showNoResults;

  return (
    <>
      {/* Inspector search: live-filters sections by title AND field keywords.
          Hidden in reconciliation mode — the DTL inspector is a fixed form. */}
      {!reconMode && (
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

      {/* Panel content */}
      <div ref={contentRef}>{content}</div>
      {hasNoResults && (
        <div className="panel-section">
          <h3>{S.inspector.noResults}</h3>
          <div className="hint">{S.inspector.noResultsHint}</div>
        </div>
      )}
    </>
  );
}
