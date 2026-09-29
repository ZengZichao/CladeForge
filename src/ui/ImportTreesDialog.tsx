// Multi-tree import chooser: a Newick file can hold several trees, and importing
// only the first would silently drop the rest. This dialog lists each tree (tip
// count + depth) and lets the user import one or all of them, each into its own
// tab.

import { useMemo, useState } from 'react';
import { useDialogFocus } from './useDialogFocus';
import type { Project } from '../model/types';
import { S, tr } from './strings';
import type { ConsensusMethod } from '../model/consensus';

function treeSummary(project: Project): { tips: number; depth: number } {
  const tips = Object.values(project.nodes).filter((n) => n.childrenIds.length === 0).length;
  let maxDepth = 0;
  const stack: { id: string; depth: number }[] = [{ id: project.rootId, depth: 0 }];
  while (stack.length) {
    const cur = stack.pop()!;
    maxDepth = Math.max(maxDepth, cur.depth);
    const node = project.nodes[cur.id];
    if (node) {
      for (const c of node.childrenIds) stack.push({ id: c, depth: cur.depth + 1 });
    }
  }
  return { tips, depth: maxDepth };
}

export function ImportTreesDialog({
  projects,
  onClose,
  onImport,
  onConsensus,
}: {
  projects: Project[];
  onClose: () => void;
  onImport: (indices: number[]) => void;
  onConsensus: (method: ConsensusMethod, indices: number[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set([0]));
  const [consensusMethod, setConsensusMethod] = useState<ConsensusMethod>('majority');
  const ref = useDialogFocus(true, onClose);

  const summaries = useMemo(
    () => projects.map((p) => ({ name: p.name, ...treeSummary(p) })),
    [projects],
  );

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const confirm = () => {
    const indices = [...selected].sort((a, b) => a - b);
    if (indices.length > 0) onImport(indices);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog import-trees-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.importMulti.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.importMulti.title}</h2>
        <div className="hint">{S.importMulti.hint.replace('{n}', String(projects.length))}</div>
        <div className="import-tree-list">
          {summaries.map((s, i) => (
            <label className={`import-tree-row${selected.has(i) ? ' selected' : ''}`} key={i}>
              <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
              <span className="import-tree-name">{s.name || tr(`树 ${i + 1}`, `Tree ${i + 1}`)}</span>
              <span className="import-tree-meta">
                {S.importMulti.tips} {s.tips} · {S.importMulti.depth} {s.depth}
              </span>
            </label>
          ))}
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {S.importMulti.cancel}
          </button>
          <button
            className="btn"
            onClick={() => {
              onImport(projects.map((_, i) => i));
              onClose();
            }}
          >
            {S.importMulti.importAll}
          </button>
          <button className="btn primary" disabled={selected.size === 0} onClick={confirm}>
            {S.importMulti.importSelected}
          </button>
        </div>
        {/* Consensus tree construction (6.2) */}
        <div className="panel-section" style={{ marginTop: 12 }}>
          <div className="field">
            <label>{S.importMulti.consensusMethod}</label>
            <select
              value={consensusMethod}
              onChange={(e) => setConsensusMethod(e.target.value as ConsensusMethod)}
            >
              <option value="strict">{S.importMulti.strict}</option>
              <option value="majority">{S.importMulti.majorityRule}</option>
            </select>
          </div>
          <div className="field row-actions">
            <button
              className="btn"
              disabled={selected.size < 2}
              onClick={() => {
                const indices = [...selected].sort((a, b) => a - b);
                onConsensus(consensusMethod, indices);
                onClose();
              }}
            >
              {S.importMulti.consensus}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
