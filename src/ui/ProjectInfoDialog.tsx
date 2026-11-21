// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Document information & provenance dialog (2026-11-15 P-3 / OP-09 / FN-5).
//
// The project NAME used to be fixed at creation/import time and the structured
// `ProjectProvenance` record could only travel inside an exported NeXML file —
// there was no way to say where the topology, branch lengths, ages or traits
// came from, who made the document, or when it last changed on disk. This
// dialog is that missing entry point: rename + provenance editing + the
// timestamps a reproducibility checklist asks for.
//
// Name edits go through `renameProject` (one undoable document step); each
// provenance commit goes through `setProvenance` so a mistake is recoverable
// like any other edit.

import { useStore } from '../model/store';
import type { ProjectProvenance } from '../model/types';
import { Field, TextField } from './fields';
import { useDialogFocus } from './useDialogFocus';
import { S, tr } from './strings';
import { usePresence } from './motion';

/** Local wall-clock rendering of an ISO timestamp (never raw UTC "Z" text). */
function formatTime(iso: string | undefined): string {
  if (!iso) return S.review.provNoTime;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return S.review.provNoTime;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ProjectInfoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const renameProject = useStore((s) => s.renameProject);
  const setProvenance = useStore((s) => s.setProvenance);
  const sessionModifiedAt = useStore((s) => s.modifiedAt);
  const ref = useDialogFocus(open, onClose);
  const presence = usePresence(open);
  if (!presence.mounted) return null;

  const prov = project.provenance ?? {};
  const setProv = (patch: Partial<ProjectProvenance>) => setProvenance(patch);
  // The document's own timestamps are written at save time; the session value
  // covers edits made since the last save. Prefer whichever is more recent.
  const modifiedDisplay =
    sessionModifiedAt && (!project.modifiedAt || sessionModifiedAt > project.modifiedAt)
      ? sessionModifiedAt
      : project.modifiedAt;

  return (
    <div className="dialog-backdrop" data-state={presence.state} onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog project-info-dialog" data-state={presence.state}
        role="dialog"
        aria-modal="true"
        aria-label={S.review.projectInfoTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.projectInfoTitle}</h2>

        <Field label={S.review.projectInfoName} title={S.review.projectInfoRenameHint}>
          <TextField
            value={project.name}
            onCommit={(v) => {
              if (v.trim() && v.trim() !== project.name) renameProject(v);
            }}
          />
        </Field>

        <div className="panel-section">
          <h3>{S.review.projectInfoProvenance}</h3>
          <Field label={S.review.provAuthor}>
            <TextField
              value={prov.author ?? ''}
              placeholder={tr('项目作者 / 团队', 'Project author / team')}
              onCommit={(v) => setProv({ author: v })}
            />
          </Field>
          <Field label={tr('描述', 'Description')}>
            <TextField
              value={prov.description ?? ''}
              placeholder={tr('这个项目要说明什么', 'What this project asserts')}
              onCommit={(v) => setProv({ description: v })}
            />
          </Field>
          <Field label={S.review.provTopology}>
            <TextField
              value={prov.topologySource ?? ''}
              placeholder={tr('例如：RAxML-NG 分析 LGC-2026-03，树文件 tree.nwk', 'e.g. RAxML-NG run LGC-2026-03, tree file tree.nwk')}
              onCommit={(v) => setProv({ topologySource: v })}
            />
          </Field>
          <Field label={S.review.provLength}>
            <TextField
              value={prov.lengthSource ?? ''}
              placeholder={tr('例如：由 BEAST 枝长换算，或手动赋值', 'e.g. converted from BEAST branch lengths, or assigned manually')}
              onCommit={(v) => setProv({ lengthSource: v })}
            />
          </Field>
          <Field label={S.review.provDate}>
            <TextField
              value={prov.dateSource ?? ''}
              placeholder={tr('例如：化石校准点 + PBDB 记录，300 Ma', 'e.g. fossil calibrations + PBDB records, 300 Ma')}
              onCommit={(v) => setProv({ dateSource: v })}
            />
          </Field>
          <Field label={S.review.provTrait}>
            <TextField
              value={prov.traitSource ?? ''}
              placeholder={tr('例如：实验室测定 / 文献表 S2', 'e.g. lab measurements / supplementary table S2')}
              onCommit={(v) => setProv({ traitSource: v })}
            />
          </Field>
          <Field label={S.review.provMethods}>
            <TextField
              value={prov.methodsNote ?? ''}
              placeholder={tr('方法、参数与可重复性说明', 'Method, parameters and reproducibility notes')}
              onCommit={(v) => setProv({ methodsNote: v })}
            />
          </Field>
        </div>

        <div className="panel-section">
          <h3>{tr('时间与位置', 'Times & location')}</h3>
          <div className="project-info-grid">
            <span>{S.review.provAuthor}</span>
            <b>{prov.author ?? '—'}</b>
            <span>{S.review.provCreated}</span>
            <b>{formatTime(prov.createdUtc)}</b>
            <span>{S.review.provModified}</span>
            <b>{formatTime(modifiedDisplay)}</b>
            <span>{S.review.provSavedAt}</span>
            <b>{formatTime(project.savedAt)}</b>
            <span>{S.review.projectInfoPath}</span>
            <b className="project-info-path" title={project.sourcePath ?? ''}>
              {project.sourcePath ?? S.review.projectInfoNoPath}
            </b>
          </div>
        </div>

        <div className="actions">
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
