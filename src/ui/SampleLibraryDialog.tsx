// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Sample library dialog (2026-11-15 ID-22 / FN-8).
//
// The sample cards existed only on an EMPTY canvas, so a document that already
// had content could never browse the catalogue (except through the single
// reconciliation sample command). This is the always-available entry: every
// sample can be opened as its own tab or used to replace the current document —
// the latter is guarded because it discards the working copy (undo cannot
// cross the document boundary).

import { useStore } from '../model/store';
import { SAMPLE_PROJECTS, type SampleDescriptor } from '../model/sampleTree';
import { openSample } from './sampleOpener';
import { requestConfirm } from './confirmDialog';
import { useDialogFocus } from './useDialogFocus';
import { notify } from './toast';
import { S, tr } from './strings';
import { usePresence } from './motion';

function SampleRow({
  sample,
  onOpenNew,
  onReplace,
}: {
  sample: SampleDescriptor;
  onOpenNew: () => void;
  onReplace: () => void;
}) {
  return (
    <li className="sample-library-row">
      <div className="sample-library-info">
        <span className="sample-library-name">{tr(sample.label, sample.labelEn)}</span>
        <span className="sample-library-desc">{tr(sample.desc, sample.descEn)}</span>
      </div>
      <div className="sample-library-actions">
        <button className="btn tiny" onClick={onOpenNew}>
          {S.review.sampleOpenNew}
        </button>
        <button className="btn tiny" onClick={onReplace}>
          {S.review.sampleReplaceCurrent}
        </button>
      </div>
    </li>
  );
}

export function SampleLibraryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loadProject = useStore((s) => s.loadProject);
  const ref = useDialogFocus(open, onClose);
  const presence = usePresence(open);
  if (!presence.mounted) return null;

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog sample-library-dialog" data-state={presence.state}
        role="dialog"
        aria-modal="true"
        aria-label={S.review.sampleLibraryTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.sampleLibraryTitle}</h2>
        <div className="hint">{S.review.sampleLibraryHint}</div>
        <ul className="sample-library-list">
          {/* 用户反馈: the library must list exactly the CURRENT samples — the
              same three the workspaces themselves offer (时间树示例 +
              非时间树示例 on the standard canvas, 物种树-基因树协调 in the
              reconciliation workspace) — not every descriptor that ever shipped. */}
          {SAMPLE_PROJECTS.filter(
            (s) => s.id === 'feature-tour' || s.id === 'large-tree' || s.entryView === 'recon',
          ).map((sample) => (
            <SampleRow
              key={sample.id}
              sample={sample}
              onOpenNew={() => {
                openSample(sample);
                onClose();
              }}
              onReplace={() => {
                requestConfirm({
                  key: 'sample-replace-current',
                  title: S.review.sampleReplaceCurrent,
                  message: tr(
                    `将用示例「${tr(sample.label, sample.labelEn)}」替换当前文档的内容。此操作不能通过撤销恢复（如需保留，请先在画布上按 ⌘S 写入项目文件）。`,
                    `This replaces the current document's content with the sample "${tr(sample.label, sample.labelEn)}". It cannot be undone (save the current work first with ⌘S if you need it).`,
                  ),
                  confirmLabel: S.review.sampleReplaceCurrent,
                  danger: true,
                  onConfirm: () => {
                    loadProject(sample.build());
                    notify.success(
                      tr(`已载入示例「${tr(sample.label, sample.labelEn)}」`, `Loaded sample "${tr(sample.label, sample.labelEn)}"`),
                    );
                    onClose();
                  },
                });
              }}
            />
          ))}
        </ul>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
