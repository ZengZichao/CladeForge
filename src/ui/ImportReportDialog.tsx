// Reviewable list of every note the last import produced (A-03 / M4 / C#15):
// the toast channel truncates at three items and evaporates in seconds; this
// dialog stays until dismissed and can be copied for a bug report or a lab
// notebook.

import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { useImportReport } from './importReport';

export function ImportReportDialog(): JSX.Element | null {
  const report = useImportReport((s) => s.report);
  const open = useImportReport((s) => s.open);
  const setOpen = useImportReport((s) => s.setOpen);
  const clear = useImportReport((s) => s.clear);
  const ref = useDialogFocus(open, () => setOpen(false));

  if (!open || !report) return null;

  const copyAll = async () => {
    const text = [`CladeForge import report — ${report.title}`, ...report.issues.map((m, i) => `${i + 1}. ${m}`)].join('\n');
    try {
      await navigator.clipboard?.writeText(text);
      notifyCopied();
    } catch {
      // Clipboard unavailable: the dialog itself stays readable.
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => setOpen(false)}>
      <div
        ref={ref}
        className="dialog import-report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.review.importReportTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.importReportTitle}</h2>
        <div className="hint">
          {S.review.importReportSubtitle(report.title, report.issues.length)}
        </div>
        <ol className="issue-list" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {report.issues.map((msg, i) => (
            <li className="issue issue-info" key={i}>{msg}</li>
          ))}
        </ol>
        <div className="row-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => void copyAll()}>
            {S.review.importReportCopy}
          </button>
          <button className="btn ghost" onClick={clear}>
            {S.review.importReportDismiss}
          </button>
          <button className="btn" onClick={() => setOpen(false)}>
            {tr('关闭', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function notifyCopied(): void {
  // Local to avoid a circular import with toast.ts at module scope.
  import('./toast').then(({ notify }) => notify.success(S.review.importReportCopied));
}
