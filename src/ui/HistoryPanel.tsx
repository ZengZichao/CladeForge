// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Undo-history panel (2026-11-15 OP-06).
//
// Until now the only window into the reference-sharing history was the step
// count in the undo tooltip — there was no way to see WHAT a step did or jump
// straight back to it. This panel lists the undo stack (newest first) and the
// redoable future, and jumps atomically through `undoSteps`/`redoSteps`
// (repeated single undos would push intermediate snapshots onto the redo
// stack and re-render once per step).

import { useStore } from '../model/store';
import type { HistoryEntry } from '../model/history';
import { useDialogFocus } from './useDialogFocus';
import { S } from './strings';

function stepTime(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function Row({
  entry,
  onJump,
  jumpLabel,
}: {
  entry: HistoryEntry;
  onJump: () => void;
  jumpLabel: string;
}) {
  return (
    <li className="history-row">
      <span className="history-label">{entry.label ?? S.review.historyStepGeneric}</span>
      <span className="history-time">{stepTime(entry.at)}</span>
      <button className="btn tiny" onClick={onJump}>
        {jumpLabel}
      </button>
    </li>
  );
}

export function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const undoSteps = useStore((s) => s.undoSteps);
  const redoSteps = useStore((s) => s.redoSteps);
  const ref = useDialogFocus(open, onClose);
  if (!open) return null;

  // Newest first: the step the user is most likely to want is the last edit.
  const undoRows = past
    .map((entry, i) => ({ entry, steps: past.length - i }))
    .reverse();

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog history-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.review.historyTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.historyTitle}</h2>
        {past.length === 0 && future.length === 0 ? (
          <div className="hint">{S.review.historyEmpty}</div>
        ) : (
          <ul className="history-list">
            {future.map((entry, j) => (
              <Row
                key={`f-${j}`}
                entry={entry}
                jumpLabel={S.review.historyRedoToHere}
                onJump={() => redoSteps(j + 1)}
              />
            ))}
            <li className="history-current" aria-current="true">
              <span className="history-label">{S.review.historyCurrent}</span>
              <span className="history-time" />
              <span />
            </li>
            {undoRows.map(({ entry, steps }, k) => (
              <Row
                key={`p-${past.length - k}`}
                entry={entry}
                jumpLabel={S.review.historyUndoToHere}
                onJump={() => undoSteps(steps)}
              />
            ))}
          </ul>
        )}
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
