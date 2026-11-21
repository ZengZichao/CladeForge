// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Recent-operation log dialog (2026-11-15 OP-22).
//
// Toasts are deliberately short-lived; anything a user might need to quote
// later — an import that skipped rows, an export that degraded a raster,
// a repair made on open — belongs in a list they can scroll and copy from.

import { useEffect, useState } from 'react';
import {
  clearOperationLog,
  subscribeOperationLog,
  type OperationEntry,
} from './operationLog';
import { useDialogFocus } from './useDialogFocus';
import { notify } from './toast';
import { writeClipboardText } from '../io/clipboardIO';
import { S, tr } from './strings';
import { usePresence } from './motion';

function formatTime(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function OperationLogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<OperationEntry[]>([]);
  const ref = useDialogFocus(open, onClose);

  useEffect(() => subscribeOperationLog(setEntries), []);
  const presence = usePresence(open);
  if (!presence.mounted) return null;

  const copyAll = () => {
    const text = entries
      .map((e) => `[${formatTime(e.at)}] ${e.kind.toUpperCase()} ${e.message}`)
      .join('\n');
    void writeClipboardText(text).then(
      () => notify.success(S.review.operationLogCopied),
      () => notify.error(tr('复制失败', 'Copy failed')),
    );
  };

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog operation-log-dialog" data-state={presence.state}
        role="dialog"
        aria-modal="true"
        aria-label={S.review.operationLogTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.operationLogTitle}</h2>
        {entries.length === 0 ? (
          <div className="hint">{S.review.operationLogEmpty}</div>
        ) : (
          <ul className="operation-log-list">
            {entries
              .slice()
              .reverse()
              .map((e) => (
                <li key={e.id} className={`operation-log-row operation-log-${e.kind}`}>
                  <span className="operation-log-time">{formatTime(e.at)}</span>
                  <span className="operation-log-kind">{e.kind}</span>
                  <span className="operation-log-message">{e.message}</span>
                </li>
              ))}
          </ul>
        )}
        <div className="actions">
          {entries.length > 0 && (
            <>
              <button className="btn" onClick={copyAll}>
                {S.review.operationLogCopy}
              </button>
              <button
                className="btn"
                onClick={() => {
                  clearOperationLog();
                }}
              >
                {S.review.operationLogClear}
              </button>
            </>
          )}
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
