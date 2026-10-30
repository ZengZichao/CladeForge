// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Build or edit a gene-tree topology without importing a file.
//
// The dialog edits a private draft document; nothing enters the project (and
// no undo step is recorded) until Create/Save. The draft is ordinary JSON and
// reuses the same add/rename/delete tree ops as the main editor. On save the
// tip labels are matched to the species tree by name and a suggested scenario is
// generated, so the reconciliation view opens with mapping lines immediately.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../model/store';
import {
  addBuiltGeneTree,
  createBlankGeneDoc,
  createGeneDocFromSpecies,
  updateBuiltGeneTree,
  type GeneTreeAutoScenario,
} from '../model/geneTreeBuild';
import { findGeneTree } from '../model/geneTrees';
import { addChildren, addSibling, deleteNode } from '../model/treeOps';
import { mapTipsByLabel } from '../model/reconciliation';
import type { NodeId, Project, TreeNode } from '../model/types';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { notify } from './toast';

function cloneDoc(doc: Project): Project {
  return JSON.parse(JSON.stringify(doc)) as Project;
}

function tipCount(doc: Project): number {
  return Object.values(doc.nodes).filter((n) => n.childrenIds.length === 0).length;
}

function uniqueTipLabel(doc: Project): string {
  const used = new Set(Object.values(doc.nodes).map((n) => n.label));
  let i = 1;
  while (used.has(S.geneBuilder.newTip(i))) i += 1;
  return S.geneBuilder.newTip(i);
}

function flatten(doc: Project): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = [];
  const walk = (id: NodeId, depth: number) => {
    const n = doc.nodes[id];
    if (!n) return;
    out.push({ node: n, depth });
    for (const c of n.childrenIds) walk(c, depth + 1);
  };
  walk(doc.rootId, 0);
  return out;
}

export function GeneTreeBuilderDialog({
  open,
  editId,
  onClose,
}: {
  open: boolean;
  /** Existing gene tree to edit; null creates a new one. */
  editId: string | null;
  onClose: () => void;
}) {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);
  const setReconMode = useStore((s) => s.setReconMode);
  const ref = useDialogFocus(open, onClose);

  const defaultName = () =>
    `${tr('基因树', 'Gene tree')} ${(project.geneTrees?.length ?? 0) + 1}`;
  const [name, setName] = useState(defaultName);
  const [draft, setDraft] = useState<Project>(() => createBlankGeneDoc(defaultName()));
  const [selectedId, setSelectedId] = useState<NodeId>('');

  useEffect(() => {
    if (!open) return;
    const entry = editId ? findGeneTree(project, editId) : undefined;
    const doc = entry ? cloneDoc(entry.doc) : createBlankGeneDoc(defaultName());
    setDraft(doc);
    setName(entry?.name ?? defaultName());
    setSelectedId(doc.rootId);
    // Intentionally re-seed only when the dialog is opened for a (different)
    // tree; edits inside the dialog must not be reset by store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId]);

  const rows = useMemo(() => flatten(draft), [draft]);
  const selected = draft.nodes[selectedId] ?? draft.nodes[draft.rootId];
  const tips = tipCount(draft);
  const mapping = useMemo(() => mapTipsByLabel(project, draft), [project, draft]);
  const mappedTips = Object.values(mapping.mappings).filter(Boolean).length;

  if (!open || !selected) return null;

  const updateDraft = (fn: (doc: Project) => void) => {
    const next = cloneDoc(draft);
    fn(next);
    setDraft(next);
  };

  const setSelectedLabel = (label: string) => {
    updateDraft((doc) => {
      const n = doc.nodes[selectedId];
      if (n) n.label = label;
    });
  };

  const addChild = () => {
    const next = cloneDoc(draft);
    const [child] = addChildren(next, selectedId, 1);
    if (!child) return;
    next.nodes[child].label = uniqueTipLabel(next);
    setDraft(next);
    setSelectedId(child);
  };

  const addSiblingNode = () => {
    if (!selected.parentId) return;
    const next = cloneDoc(draft);
    const sibling = addSibling(next, selectedId);
    if (!sibling) return;
    next.nodes[sibling].label = uniqueTipLabel(next);
    setDraft(next);
    setSelectedId(sibling);
  };

  const removeSubtree = () => {
    if (!selected.parentId) return;
    const parent = selected.parentId;
    const next = cloneDoc(draft);
    if (!deleteNode(next, selectedId, true)) return;
    setDraft(next);
    setSelectedId(parent);
  };

  const resetBlank = () => {
    const doc = createBlankGeneDoc(name.trim() || defaultName());
    setDraft(doc);
    setSelectedId(doc.rootId);
  };

  const resetSpecies = () => {
    const doc = createGeneDocFromSpecies(project, name.trim() || defaultName());
    setDraft(doc);
    setSelectedId(doc.rootId);
  };

  const save = () => {
    if (tips < 2) {
      notify.info(S.geneBuilder.tipsRequired);
      return;
    }
    const finalName = name.trim() || defaultName();
    let id: string | null = editId;
    let scenario: GeneTreeAutoScenario | null = null;
    if (editId) {
      apply((d) => {
        scenario = updateBuiltGeneTree(d, editId, draft, finalName);
      });
      if (!scenario) {
        notify.error(tr('基因树不存在，可能已被删除。', 'That gene tree no longer exists.'));
        return;
      }
    } else {
      let createdId: string | null = null;
      let created: GeneTreeAutoScenario | null = null;
      apply((d) => {
        const r = addBuiltGeneTree(d, draft, finalName);
        createdId = r.id;
        created = r.scenario;
      });
      id = createdId;
      scenario = created;
      if (!id) {
        notify.error(tr('基因树创建失败。', 'Could not create the gene tree.'));
        return;
      }
    }
    setActiveGeneTree(id);
    setReconMode(true);
    const sc = scenario as GeneTreeAutoScenario | null;
    notify.success(
      tr(
        `基因树「${finalName}」已就绪：${sc?.mappedTips ?? 0}/${sc?.totalTips ?? tips} 个末端已自动映射`,
        `Gene tree "${finalName}" is ready: ${sc?.mappedTips ?? 0}/${sc?.totalTips ?? tips} tip(s) auto-mapped`,
      ),
    );
    onClose();
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog gene-builder-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={editId ? S.geneBuilder.editTitle : S.geneBuilder.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{editId ? S.geneBuilder.editTitle : S.geneBuilder.title}</h2>

        <div className="gene-builder-top">
          <label className="gene-builder-name">
            <span>{S.geneBuilder.name}</span>
            <input
              value={name}
              placeholder={S.geneBuilder.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="gene-builder-templates">
            <span>{S.geneBuilder.start}</span>
            <button className="btn" onClick={resetBlank}>
              {S.geneBuilder.blank}
            </button>
            <button className="btn" onClick={resetSpecies}>
              {S.geneBuilder.copySpecies}
            </button>
          </div>
        </div>

        <div className="gene-builder-body">
          <div className="gene-builder-outline">
            <div className="gene-builder-outline-title">{S.geneBuilder.outline}</div>
            <div className="gene-tree-rows">
              {rows.map(({ node, depth }) => (
                <button
                  key={node.id}
                  className={`gene-tree-row${node.id === selectedId ? ' active' : ''}`}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span className="gene-tree-bullet">
                    {node.childrenIds.length > 0 ? '▾' : '•'}
                  </span>
                  <span className="gene-tree-label" title={node.label}>
                    {node.label || tr('未命名', 'Unnamed')}
                  </span>
                  <span className="gene-tree-kind">
                    {node.childrenIds.length > 0 ? tr('内部', 'internal') : tr('末端', 'tip')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="gene-builder-editor">
            <div className="gene-builder-editor-title">{S.geneBuilder.selected}</div>
            <label className="gene-builder-name">
              <span>{S.geneBuilder.nodeLabel}</span>
              <input value={selected.label} onChange={(e) => setSelectedLabel(e.target.value)} />
            </label>
            <div className="field row-actions">
              <button className="btn" onClick={addChild}>
                {S.geneBuilder.addChild}
              </button>
              <button className="btn" disabled={!selected.parentId} onClick={addSiblingNode}>
                {S.geneBuilder.addSibling}
              </button>
              <button
                className="btn danger"
                disabled={!selected.parentId}
                onClick={removeSubtree}
              >
                {S.geneBuilder.deleteSubtree}
              </button>
            </div>
            <div className="hint">{S.geneBuilder.mapping(mappedTips, tips)}</div>
            {tips < 2 && <div className="hint">{S.geneBuilder.tipsRequired}</div>}
            {editId && <div className="hint">{S.geneBuilder.editWarning}</div>}
          </div>
        </div>

        <div className="field row-actions-spread">
          <div className="actions-group">
            <button className="btn" onClick={onClose}>
              {S.geneBuilder.cancel}
            </button>
          </div>
          <button className="btn primary" disabled={tips < 2} onClick={save}>
            {editId ? S.geneBuilder.save : S.geneBuilder.create}
          </button>
        </div>
      </div>
    </div>
  );
}
