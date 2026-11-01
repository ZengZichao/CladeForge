// Left-column hypothesis-layer panel (the evolutionary semantic layer).
//
// Maintain several competing hypotheses over the same tree: switch the active
// layer, rename it, record its CLAIM and TEST, duplicate the current one to
// branch a new idea, add a blank layer — and COMPARE two layers side by side
// (the product's core claim finally has a surface: a per-node diff of the
// states and events that differ, clickable straight onto the canvas).
//
// Every layer is shown as a CARD with its own record counts, so the user can
// see "I have 4 hypotheses and this one carries 12 events" without switching
// into each one to count.

import { PlusIcon, CopyIcon, TrashIcon } from '@radix-ui/react-icons';
import { useMemo, useState } from 'react';
import { useStore } from '../model/store';
import {
  addBlankLayer,
  duplicateActiveLayer,
  layerDiff,
  layerRecordCounts,
  removeLayer,
  renameLayer,
  switchLayer,
  type LayerDiff,
} from '../model/layers';
import { Field, TextField, CheckboxField } from './fields';
import { Section } from './Section';
import { S, tr } from './strings';
import { requestConfirm } from './confirmDialog';
import { useDialogFocus } from './useDialogFocus';
import type { HypothesisStatus } from '../model/types';

const STATUS_LABEL: Record<HypothesisStatus, string> = {
  draft: S.review.layerStatusDraft,
  tested: S.review.layerStatusTested,
  supported: S.review.layerStatusSupported,
  refuted: S.review.layerStatusRefuted,
};

/** The A/B compare view (a small dialog over the canvas). */
function LayerCompareDialog({
  project,
  initialA,
  initialB,
  onClose,
}: {
  project: ReturnType<typeof useStore.getState>['project'];
  initialA: string;
  initialB: string;
  onClose: () => void;
}) {
  const [aId, setAId] = useState(initialA);
  const [bId, setBId] = useState(initialB);
  const select = useStore((s) => s.select);
  const focusNode = useStore((s) => s.focusNode);
  const ref = useDialogFocus(true, onClose);
  const diff: LayerDiff | null = useMemo(
    () => (aId && bId && aId !== bId ? layerDiff(project, aId, bId) : null),
    [project, aId, bId],
  );
  const nameOf = (id: string) => project.layers.find((l) => l.id === id)?.name ?? id;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.review.layerCompareTitle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.review.layerCompareTitle}</h2>
        <div className="field">
          <label>{S.review.layerComparePickA}</label>
          <select value={aId} onChange={(e) => setAId(e.target.value)}>
            {project.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{S.review.layerComparePickB}</label>
          <select value={bId} onChange={(e) => setBId(e.target.value)}>
            {project.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        {diff ? (
          <>
            <div className="hint">
              {diff.stateDiffs.length === 0 &&
              diff.eventsOnlyA.length === 0 &&
              diff.eventsOnlyB.length === 0
                ? S.review.layerCompareNoDiff
                : `${S.review.layerCompareStates(diff.stateDiffs.length)} · ${S.review.layerCompareEventsOnlyA(diff.eventsOnlyA.length)} · ${S.review.layerCompareEventsOnlyB(diff.eventsOnlyB.length)}`}
            </div>
            {diff.stateDiffs.length > 0 && (
              <ul className="issue-list">
                {diff.stateDiffs.slice(0, 200).map((d, i) => (
                  <li
                    key={`d-${i}`}
                    className="issue issue-info issue-click"
                    onClick={() => {
                      select(d.nodeId);
                      focusNode(d.nodeId);
                    }}
                  >
                    <strong>{project.nodes[d.nodeId]?.label || d.nodeId.slice(0, 6)}</strong> ·{' '}
                    {d.characterName}: {nameOf(aId)}={d.a ?? '—'} ↔ {nameOf(bId)}={d.b ?? '—'}
                  </li>
                ))}
              </ul>
            )}
            {(diff.eventsOnlyA.length > 0 || diff.eventsOnlyB.length > 0) && (
              <div className="hint">
                {diff.eventsOnlyA
                  .map((e) => `${e.label || e.typeId} @${project.nodes[e.nodeId]?.label ?? e.nodeId.slice(0, 6)}`)
                  .concat(
                    diff.eventsOnlyB.map(
                      (e) =>
                        `${e.label || e.typeId} @${project.nodes[e.nodeId]?.label ?? e.nodeId.slice(0, 6)}`,
                    ),
                  )
                  .slice(0, 20)
                  .join('；')}
              </div>
            )}
          </>
        ) : (
          <div className="hint">{tr('请选择两个不同的层', 'Pick two different layers')}</div>
        )}
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LayerPanel() {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const layers = project.layers;
  const activeLayerId = project.activeLayerId;
  const showEvents = useStore((s) => s.showEvents);
  const setShowEvents = useStore((s) => s.setShowEvents);
  const [compareOpen, setCompareOpen] = useState<{ a: string; b: string } | null>(null);

  const active = layers.find((l) => l.id === activeLayerId);
  const nextName = () => `${S.layer.section} ${layers.length + 1}`;

  return (
    <Section title={S.layer.section} pinable>
      {compareOpen && (
        <LayerCompareDialog
          project={project}
          initialA={compareOpen.a}
          initialB={compareOpen.b}
          onClose={() => setCompareOpen(null)}
        />
      )}

      {/* Layer CARDS: one row per hypothesis with its own counts — the
          "how many hypotheses do I have and what does each assert" question
          answered without switching into every layer. */}
      <div className="layer-cards">
        {layers.map((l) => {
          const counts = layerRecordCounts(project, l.id);
          const isActive = l.id === activeLayerId;
          return (
            <div
              key={l.id}
              className={`layer-card${isActive ? ' active' : ''}`}
              style={{
                border: '1px solid var(--border, rgba(128,128,128,0.3))',
                borderRadius: 6,
                padding: 8,
                marginBottom: 6,
                cursor: 'pointer',
              }}
              onClick={() => !isActive && apply((d) => switchLayer(d, l.id))}
              role="button"
              tabIndex={0}
              aria-pressed={isActive}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isActive) {
                  e.preventDefault();
                  apply((d) => switchLayer(d, l.id));
                }
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 12 }}>{l.name}</strong>
                {l.status && (
                  <span style={{ fontSize: 11, opacity: 0.8 }}>{STATUS_LABEL[l.status]}</span>
                )}
              </div>
              {l.statement && (
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{l.statement}</div>
              )}
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                {S.review.layerCounts(counts.states, counts.meta, counts.notes, counts.events)}
              </div>
            </div>
          );
        })}
      </div>

      {active && (
        <>
          <Field label={S.layer.name}>
            <TextField
              value={active.name}
              onCommit={(v) => apply((d) => renameLayer(d, active.id, v))}
            />
          </Field>
          {/* The hypothesis BODY: a competitive hypothesis is a claim with a
              test, not just a name — without somewhere to put it, the conclusion
              of a comparison lands in a screenshot or a Word file. */}
          <Field label={S.review.layerStatement}>
            <TextField
              value={active.statement ?? ''}
              onCommit={(v) =>
                apply((d) => {
                  const l = d.layers.find((x) => x.id === active.id);
                  if (l) {
                    l.statement = v || undefined;
                    l.updatedAt = new Date().toISOString();
                  }
                })
              }
            />
          </Field>
          <Field label={S.review.layerPrediction}>
            <TextField
              value={active.prediction ?? ''}
              onCommit={(v) =>
                apply((d) => {
                  const l = d.layers.find((x) => x.id === active.id);
                  if (l) {
                    l.prediction = v || undefined;
                    l.updatedAt = new Date().toISOString();
                  }
                })
              }
            />
          </Field>
          <Field label={S.review.layerStatus}>
            <select
              value={active.status ?? 'draft'}
              onChange={(e) =>
                apply((d) => {
                  const l = d.layers.find((x) => x.id === active.id);
                  if (l) {
                    l.status = e.target.value as HypothesisStatus;
                    l.updatedAt = new Date().toISOString();
                  }
                })
              }
            >
              {(Object.keys(STATUS_LABEL) as HypothesisStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      <CheckboxField
        label={S.event.showEvents}
        checked={showEvents}
        onChange={(v) => setShowEvents(v)}
      />

      <div className="field row-actions-spread">
        <div className="actions-group">
          <button
            className="btn primary"
            onClick={() =>
              apply((d) => {
                const id = addBlankLayer(d, nextName());
                switchLayer(d, id);
              })
            }
          >
            <PlusIcon /> {S.layer.addBlank}
          </button>
          <button
            className="btn"
            onClick={() =>
              apply((d) => {
                const id = duplicateActiveLayer(d, `${active?.name ?? S.layer.section} ${S.layer.copySuffix}`);
                switchLayer(d, id);
              })
            }
          >
            <CopyIcon /> {S.layer.duplicate}
          </button>
        </div>
        <button
          className="btn danger"
          disabled={layers.length <= 1}
          onClick={() => {
            const currentName = active?.name ?? S.layer.section;
            const other = layers.find((l) => l.id !== activeLayerId);
            const nextName = other?.name ?? S.layer.section;
            requestConfirm({
              key: 'delete-active-layer',
              title: S.confirm.deleteActiveLayerTitle,
              message: S.confirm.deleteActiveLayerMessage(currentName, nextName),
              confirmLabel: S.confirm.deleteActiveLayerConfirm,
              danger: true,
              onConfirm: () => apply((d) => removeLayer(d, activeLayerId)),
            });
          }}
        >
          <TrashIcon /> {S.layer.remove}
        </button>
      </div>

      {layers.length >= 2 && (
        <div className="field row-actions">
          <button
            className="btn"
            onClick={() => {
              const other = layers.find((l) => l.id !== activeLayerId);
              setCompareOpen({ a: activeLayerId, b: other?.id ?? activeLayerId });
            }}
          >
            {S.review.cmdLayerDiff}
          </button>
        </div>
      )}

      <div className="hint">{S.layer.noteGuide}</div>
    </Section>
  );
}
