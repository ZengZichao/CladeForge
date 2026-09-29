// Right-click context menu. Actions depend on what was clicked (node, custom
// edge, or empty canvas).

import { useEffect } from 'react';
import { useStore } from '../model/store';
import {
  addChildrenSpaced,
  addSiblingSpaced,
  deleteNode,
  insertParent,
  rerootAtNode,
  toggleCollapse,
  unpinNode,
  outgroupReroot,
  checkOutgroupReroot,
  applyMidpointReroot,
  hasBranchLengths,
  countAnnotatedInternals,
  ladderize,
  type MidpointResult,
} from '../model/treeOps';
import { notify } from './toast';
import { isImeComposing } from './imeGuard';
import { requestConfirm } from './confirmDialog';
import { requestDeletion } from './deleteGuard';
import { midpointText, outgroupFailureText } from './treeEditNotices';
import { S, tr } from './strings';

export interface ContextTarget {
  x: number;
  y: number;
  nodeId: string | null;
  edgeId: string | null;
}

interface Item {
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
  disabled?: boolean;
  /** Hover explanation — also how a disabled item's refusal reason is shown. */
  title?: string;
}

export function ContextMenu({
  target,
  onClose,
  onAddChildrenDialog,
}: {
  target: ContextTarget;
  onClose: () => void;
  onAddChildrenDialog: (parentId: string) => void;
}) {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const requestFit = useStore((s) => s.requestFit);
  const selectEdge = useStore((s) => s.selectEdge);
  const clearSelection = useStore((s) => s.clearSelection);

  useEffect(() => {
    const onDoc = () => onClose();
    // Escape while an IME candidate list is open cancels the composition,
    // it must not also dismiss the context menu behind it.
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  let items: Item[] = [];

  if (target.edgeId) {
    const edgeId = target.edgeId;
    items = [
      {
        label: S.context.deleteEdge,
        danger: true,
        onClick: run(() => {
          apply((d) => {
            d.customEdges = d.customEdges.filter((e) => e.id !== edgeId);
          });
          selectEdge(null);
        }),
      },
    ];
  } else if (target.nodeId) {
    const id = target.nodeId;
    const node = project.nodes[id];
    items = [
      { label: S.context.addBinary, onClick: run(() => apply((d) => addChildrenSpaced(d, id, 2))) },
      { label: S.context.addTernary, onClick: run(() => apply((d) => addChildrenSpaced(d, id, 3))) },
      { label: S.context.addMulti, onClick: run(() => onAddChildrenDialog(id)) },
      { label: S.context.addSibling, onClick: run(() => apply((d) => addSiblingSpaced(d, id))) },
      { sep: true },
      { label: S.context.insertParent, onClick: run(() => apply((d) => insertParent(d, id))) },
    ];
    if (node && node.childrenIds.length > 0) {
      items.push({
        label: node.collapsed ? S.context.expandSubtree : S.context.collapseSubtree,
        onClick: run(() => apply((d) => toggleCollapse(d, id))),
      });
    }
    // Ladderize (ascending / descending) — also in the context menu so users
    // who don't use ⌘K can discover the feature.
    if (node && node.childrenIds.length > 0) {
      items.push({
        label: S.cmd.ladderizeAsc,
        onClick: run(() => { apply((d) => ladderize(d, true)); requestFit(); }),
      });
      items.push({
        label: S.cmd.ladderizeDesc,
        onClick: run(() => { apply((d) => ladderize(d, false)); requestFit(); }),
      });
    }
    if (node?.pinned) {
      items.push({ label: S.context.resetPosition, onClick: run(() => apply((d) => unpinNode(d, id))) });
    }
    if (node && node.parentId !== null) {
      // Enhanced reroot confirmation (1.2)
      items.push({
        label: S.context.reroot,
        onClick: run(() => {
          const hasBL = hasBranchLengths(project);
          const annotatedCount = countAnnotatedInternals(project);
          let message = S.confirm.rerootMessage;
          if (hasBL) message += '\n' + S.confirm.rerootHasBranchLength;
          else message += '\n' + S.confirm.rerootNoBranchLength;
          if (annotatedCount > 0) message += '\n' + S.confirm.rerootAffectsChars(annotatedCount);
          requestConfirm({
            key: 'reroot',
            title: S.confirm.rerootTitle,
            message,
            confirmLabel: S.confirm.rerootConfirm,
            onConfirm: () => {
              apply((d) => rerootAtNode(d, id));
              requestFit();
            },
          });
        }),
      });
      // Midpoint reroot — also accessible from the context menu so users
      // who don't use ⌘K can discover it.
      items.push({
        label: S.cmd.rerootMidpoint,
        onClick: run(() => {
          if (!hasBranchLengths(project)) {
            notify.info(S.notify.needBranchLength);
            return;
          }
          // `applyMidpointReroot` splits the branch at the TRUE patristic
          // midpoint — `midpointTarget` + `rerootAtNode` would put the root on a
          // node instead — and it reports the measured diameter plus how many
          // branches have to be excluded for want of a usable length. Both facts
          // go to the user.
          const box: { result: MidpointResult | null } = { result: null };
          apply((d) => {
            box.result = applyMidpointReroot(d);
          });
          if (box.result) notify.info(midpointText(box.result));
          requestFit();
        }),
      });
      // Outgroup rooting: use all selected nodes as outgroup.
      // `checkOutgroupReroot` answers the question BEFORE the edit, so an
      // impossible selection is greyed out with its reason instead of running a
      // confirmation dialog whose outcome is a silent no-op.
      if (selection.length > 1) {
        const failure = checkOutgroupReroot(project, selection);
        items.push({
          label: S.context.outgroupReroot,
          disabled: failure !== null,
          title:
            failure === null
              ? S.context.outgroupRerootCount(selection.length)
              : outgroupFailureText(failure) ?? undefined,
          onClick: run(() => {
            if (failure) {
              notify.info(outgroupFailureText(failure) as string);
              return;
            }
            requestConfirm({
              key: 'reroot',
              title: S.confirm.rerootTitle,
              message: S.confirm.rerootMessage,
              confirmLabel: S.confirm.rerootConfirm,
              onConfirm: () => {
                const box: { reason: string | null } = { reason: null };
                apply((d) => {
                  const result = outgroupReroot(d, selection);
                  box.reason = result.ok ? null : outgroupFailureText(result.reason ?? 'unrootable');
                });
                // The document may already have changed for real, so only claim
                // success when the recipe said it rooted.
                if (box.reason) notify.info(box.reason);
                else requestFit();
              },
            });
          }),
        });
      }
    }
    if (node && node.parentId !== null) {
      items.push({ sep: true });
      // Adaptive, tip-based delete threshold + its own confirmation key, shared
      // with the keyboard / inspector paths; the Undo button on the
      // toast is bound to THIS delete, not to the stack top at click time.
      items.push({
        label: S.context.deleteNode,
        danger: true,
        onClick: run(() => {
          requestDeletion(project, [id], 'context-menu', () => {
            apply((d) => deleteNode(d, id, true));
            clearSelection();
          });
        }),
      });
    }
  } else {
    items = [{ label: S.context.fit, onClick: run(() => requestFit()) }];
  }

  const left = Math.min(target.x, window.innerWidth - 190);
  const top = Math.min(target.y, window.innerHeight - (items.length * 34 + 12));
  const contextLabel = target.edgeId
    ? S.toolbar.contextEdge
    : target.nodeId
      ? S.toolbar.contextNode
      : S.toolbar.contextCanvas;

  return (
    <div
      className="context-menu"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="context-menu-label">{contextLabel}</div>
      {items.map((it, i) =>
        it.sep ? (
          <div key={`sep-${i}`} className="menu-sep" />
        ) : (
          <button
            key={it.label}
            className="menu-item"
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            disabled={it.disabled}
            title={it.title}
            onClick={it.onClick}
          >
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
