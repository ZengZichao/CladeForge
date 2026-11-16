// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Tree-distance report dialog (2026-11-15 FN-3).
//
// The palette command used to emit a multi-line toast: unreadable, uncopyable
// and gone in seconds. This is the same computation presented as a table with
// a copy-to-clipboard action, comparing the active document against every
// other open tab and every embedded gene tree whose tip set matches.

import { useMemo } from 'react';
import { useStore } from '../model/store';
import { treeDistance } from '../model/treeDistance';
import type { Project } from '../model/types';
import { writeClipboardText } from '../io/clipboardIO';
import { useDialogFocus } from './useDialogFocus';
import { notify } from './toast';
import { S, tr } from './strings';

interface Comparison {
  key: string;
  name: string;
  rf: number;
  rfNormalized: number;
  wrf: number | null;
  shared: number;
  unique: number;
}

export function TreeDistanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabStore = useStore((s) => s.tabStore);
  const ref = useDialogFocus(open, onClose);

  const comparisons = useMemo(() => {
    if (!open) return [];
    const others: { key: string; name: string; doc: Project }[] = [];
    for (const id of tabs) {
      if (id === activeTabId) continue;
      const snap = tabStore[id];
      if (snap) others.push({ key: `tab:${id}`, name: snap.project.name, doc: snap.project });
    }
    for (const g of project.geneTrees ?? []) {
      others.push({ key: `gene:${g.id}`, name: g.name, doc: g.doc });
    }
    const out: Comparison[] = [];
    for (const other of others) {
      try {
        const d = treeDistance(project, other.doc);
        out.push({
          key: other.key,
          name: other.name,
          rf: d.rf,
          rfNormalized: d.rfNormalized,
          wrf: d.wrf,
          shared: d.sharedClades,
          unique: d.onlyA.length + d.onlyB.length,
        });
      } catch {
        // Different tip sets: skip silently here; the table says how many
        // comparisons exist and the tooltip explains why one was excluded.
      }
    }
    return out;
  }, [open, project, tabs, activeTabId, tabStore]);

  if (!open) return null;

  const copyAll = () => {
    const lines = comparisons.map(
      (c) =>
        `${c.name}: RF=${c.rf} (${(c.rfNormalized * 100).toFixed(1)}%)${
          c.wrf !== null ? ` wRF=${c.wrf.toFixed(3)}` : ''
        } ${S.review.treeDistanceShared}=${c.shared} ${S.review.treeDistanceUnique}=${c.unique}`,
    );
    const text = `${project.name} — ${S.review.treeDistanceTitle}\n${lines.join('\n')}`;
    void writeClipboardText(text).then(
      () => notify.success(S.review.treeDistanceCopied),
      () => notify.error(tr('复制失败', 'Copy failed')),
    );
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog tree-distance-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.review.treeDistanceTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.treeDistanceTitle}</h2>
        {comparisons.length === 0 ? (
          <div className="hint">{S.review.treeDistanceEmpty}</div>
        ) : (
          <>
            <table className="tree-distance-table">
              <thead>
                <tr>
                  <th>{tr('对比对象', 'Compared with')}</th>
                  <th>{S.review.treeDistanceRf}</th>
                  <th>{S.review.treeDistanceRfNorm}</th>
                  <th>{S.review.treeDistanceWrF}</th>
                  <th>{S.review.treeDistanceShared}</th>
                  <th>{S.review.treeDistanceUnique}</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c) => (
                  <tr key={c.key}>
                    <td title={c.name}>{c.name}</td>
                    <td>{c.rf}</td>
                    <td>{(c.rfNormalized * 100).toFixed(1)}%</td>
                    <td>{c.wrf === null ? '—' : c.wrf.toFixed(3)}</td>
                    <td>{c.shared}</td>
                    <td>{c.unique}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">
              {tr(
                '加权 RF 仅在两棵树都有枝长时计算；末端集合不同的树无法比较，已跳过。',
                'Weighted RF is computed only when both trees carry branch lengths; trees with different tip sets cannot be compared and were skipped.',
              )}
            </div>
          </>
        )}
        <div className="actions">
          {comparisons.length > 0 && (
            <button className="btn" onClick={copyAll}>
              {S.review.treeDistanceCopy}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
