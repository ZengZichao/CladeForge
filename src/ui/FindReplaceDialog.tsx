// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Global find & replace dialog (2026-11-15 OP-02).
//
// The review found no way to batch-edit text: renaming a clade across twenty
// nodes, fixing a mistyped state label, or moving an event note was a
// node-by-node chore. This dialog previews every hit BEFORE anything is
// committed (collectReplacements), applies through the store (one undoable
// step for the active document, direct snapshot rewrite for parked tabs), and
// refuses empty searches rather than "replacing" every empty string.

import { useMemo, useState } from 'react';
import { useStore } from '../model/store';
import {
  collectReplacements,
  replaceFieldLabel,
  type ReplaceField,
  type Replacement,
} from '../model/replace';
import { Field, CheckboxField } from './fields';
import { useDialogFocus } from './useDialogFocus';
import { notify } from './toast';
import { S, tr } from './strings';

interface FieldOption {
  label: string;
  fields: ReplaceField[];
}

/** Built at RENDER time: a module-level array would capture whichever locale
 *  was active at import and never update after a language switch. */
function fieldOptions(): FieldOption[] {
  return [
    { label: S.review.fieldNodeName, fields: ['nodeName'] },
    { label: S.review.fieldHypothesisNote, fields: ['hypothesisNote'] },
    { label: S.review.fieldEventLabel, fields: ['eventLabel'] },
    { label: S.review.fieldEventNote, fields: ['eventNote'] },
    { label: S.review.fieldCharacterName, fields: ['characterName'] },
    { label: S.review.fieldStateLabel, fields: ['stateLabel'] },
    { label: S.review.fieldLayerText, fields: ['layerName', 'layerStatement', 'layerPrediction'] },
    { label: S.review.fieldGeneTreeName, fields: ['geneTreeName'] },
  ];
}

export function FindReplaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabStore = useStore((s) => s.tabStore);
  const applyReplaceJobs = useStore((s) => s.applyReplaceJobs);

  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [selected, setSelected] = useState<ReplaceField[]>([
    'nodeName',
    'hypothesisNote',
    'eventLabel',
    'eventNote',
    'layerName',
    'layerStatement',
    'layerPrediction',
  ]);
  const ref = useDialogFocus(open, onClose);

  const options = useMemo(
    () => ({
      find,
      replace,
      fields: selected,
      caseSensitive,
    }),
    [find, replace, selected, caseSensitive],
  );

  // Preview: recomputed from the LIVE documents on every keystroke; nothing is
  // mutated until "替换全部".
  const jobs = useMemo(() => {
    if (!open) return {};
    const out: Record<string, Replacement[]> = {};
    const collect = (tabId: string, doc: typeof project) => {
      const reps = collectReplacements(doc, options);
      if (reps.length > 0) out[tabId] = reps;
    };
    collect(activeTabId, project);
    if (scope === 'all') {
      for (const id of tabs) {
        if (id === activeTabId) continue;
        const snap = tabStore[id];
        if (snap) collect(id, snap.project);
      }
    }
    return out;
  }, [open, project, tabs, activeTabId, tabStore, options, scope]);

  const total = Object.values(jobs).reduce((n, reps) => n + reps.length, 0);

  if (!open) return null;

  const toggle = (fields: ReplaceField[], checked: boolean) => {
    setSelected((prev) => {
      const drop = new Set(fields);
      const next = checked
        ? [...new Set([...prev, ...fields])]
        : prev.filter((f) => !drop.has(f));
      return next;
    });
  };

  const apply = () => {
    const applied = applyReplaceJobs(jobs);
    if (applied > 0) notify.success(S.review.findReplaceDone(applied));
    else notify.info(S.review.findReplaceNone);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog find-replace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.review.findReplaceTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.findReplaceTitle}</h2>

        <div className="find-replace-grid">
          {/* P-05 / BUG-03: these two boxes drive a LIVE preview, so they must
              update the query on every keystroke. `TextField` buffers until
              blur/Enter — which left the dialog showing "No matches" for text
              the user had already typed, and made the whole search look broken
              until Enter re-committed. Search options are not document data,
              so there is nothing to protect from per-keystroke commits. */}
          <Field label={S.review.findReplaceFind}>
            <input
              type="text"
              value={find}
              placeholder={tr('输入要查找的文本', 'Type text to find')}
              aria-label={S.review.findReplaceFind}
              onChange={(e) => setFind(e.target.value)}
            />
          </Field>
          <Field label={S.review.findReplaceReplace}>
            <input
              type="text"
              value={replace}
              placeholder={tr('替换为（可留空）', 'Replace with (may be empty)')}
              aria-label={S.review.findReplaceReplace}
              onChange={(e) => setReplace(e.target.value)}
            />
          </Field>
        </div>

        <fieldset className="find-replace-fields">
          <legend>{S.review.findReplaceFields}</legend>
          <div className="find-replace-field-list">
            {fieldOptions().map((opt) => (
              <CheckboxField
                key={opt.label}
                label={opt.label}
                checked={opt.fields.every((f) => selected.includes(f))}
                onChange={(v) => toggle(opt.fields, v)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="find-replace-scope">
          <legend>{S.review.findReplaceScope}</legend>
          {/* S22 (Sonus): the scope is MUTUALLY EXCLUSIVE — checkboxes lied about
              the semantics. Native radios give the correct group semantics and
              the screen-reader announcement ("2 of 2" for each option). */}
          <label className="field check">
            <input
              type="radio"
              name="find-replace-scope"
              checked={scope === 'active'}
              onChange={() => setScope('active')}
            />
            {S.review.scopeActive}
          </label>
          <label className="field check">
            <input
              type="radio"
              name="find-replace-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            {S.review.scopeAll}
          </label>
        </fieldset>

        <CheckboxField
          label={S.review.findReplaceCase}
          checked={caseSensitive}
          onChange={setCaseSensitive}
        />

        <div className="find-replace-preview">
          {total === 0 ? (
            <div className="hint">{S.review.findReplaceNone}</div>
          ) : (
            <>
              <div className="hint">{S.review.findReplacePreview(total)}</div>
              <ul className="find-replace-list">
                {Object.entries(jobs).flatMap(([tabId, reps]) =>
                  reps.slice(0, 50).map((rep, i) => {
                    const doc =
                      tabId === activeTabId ? project : tabStore[tabId]?.project ?? project;
                    const tabName =
                      tabId === activeTabId
                        ? project.name
                        : tabStore[tabId]?.project.name ?? tr('其他文档', 'Other document');
                    return (
                      <li key={`${tabId}-${rep.field}-${rep.id}-${i}`} className="find-replace-row">
                        <span className="find-replace-target">
                          {tabName} · {replaceFieldLabel(rep.field, doc, rep)}
                        </span>
                        <span className="find-replace-change">
                          {rep.oldValue} → {rep.newValue}
                        </span>
                      </li>
                    );
                  }),
                )}
              </ul>
            </>
          )}
        </div>

        <div className="actions">
          <button className="btn primary" disabled={total === 0} onClick={apply}>
            {S.review.findReplaceApply}
          </button>
          <button className="btn" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
