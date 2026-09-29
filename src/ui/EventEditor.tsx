// Per-node evolutionary-event editor shown in the inspector.
//
// Lists the events attached to the selected node (on the node itself and on its
// incoming branch), lets the user add typed events, edit their metadata
// (type / position / title / note / confidence / evidence) and wire up causal
// links to other events. All edits are undoable treeOps recipes.

import { useState } from 'react';
import {
  addEvent,
  removeEvent,
  toggleEventTrigger,
  updateEvent,
} from '../model/treeOps';
import {
  EVENT_TYPES,
  eventCode,
  eventDisplayLabel,
  eventTypeGroup,
  eventTypeLabel,
  eventsForNode,
  findEventType,
  newEvent,
} from '../model/events';
import type { Confidence, EvolutionaryEvent, Project, TreeNode } from '../model/types';
import { Field, TextField } from './fields';
import { S } from './strings';

type Apply = (recipe: (d: Project) => void) => void;

function TypeOptions() {
  // Group ids are stable; labels are locale-aware, so groups are derived at
  // render time instead of module scope.
  const groups = Array.from(new Set(EVENT_TYPES.map((t) => t.group)));
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={eventTypeGroup(EVENT_TYPES.find((t) => t.group === g)!)}>
          {EVENT_TYPES.filter((t) => t.group === g).map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} · {eventTypeLabel(t)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

function OneEvent({
  event,
  project,
  apply,
  isRoot,
}: {
  event: EvolutionaryEvent;
  project: Project;
  apply: Apply;
  isRoot: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = event.id;
  const up = (patch: Partial<EvolutionaryEvent>) => apply((d) => updateEvent(d, id, patch));
  const others = project.events.filter((e) => e.id !== id);

  return (
    <div className="event-item">
      <div className="event-row">
        <span className="event-badge" title={findEventType(event.typeId) ? eventTypeLabel(findEventType(event.typeId)!) : undefined}>
          {eventCode(event)}
        </span>
        <span className="event-title" title={eventDisplayLabel(event)}>
          {eventDisplayLabel(event)}
        </span>
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {S.character.edit}
        </button>
      </div>

      {open && (
        <div className="event-editor">
          <Field label={S.event.type}>
            <select value={event.typeId} onChange={(e) => up({ typeId: e.target.value })}>
              <TypeOptions />
            </select>
          </Field>
          <Field label={S.event.target}>
            <select
              value={event.target}
              onChange={(e) => up({ target: e.target.value as 'node' | 'branch' })}
            >
              <option value="node">{S.event.targetNode}</option>
              <option value="branch" disabled={isRoot}>
                {S.event.targetBranch}
              </option>
            </select>
          </Field>
          <Field label={S.event.label}>
            <TextField
              value={event.label ?? ''}
              placeholder={S.event.labelPlaceholder}
              onCommit={(v) => up({ label: v })}
            />
          </Field>
          <Field label={S.event.note}>
            <TextField value={event.note ?? ''} onCommit={(v) => up({ note: v })} />
          </Field>
          <Field label={S.confidence.label}>
            <select
              value={event.confidence ?? ''}
              onChange={(e) => up({ confidence: (e.target.value || undefined) as Confidence | undefined })}
            >
              <option value="">{S.confidence.none}</option>
              <option value="high">{S.confidence.high}</option>
              <option value="medium">{S.confidence.medium}</option>
              <option value="low">{S.confidence.low}</option>
            </select>
          </Field>
          <Field label={S.confidence.support}>
            <TextField value={event.support ?? ''} onCommit={(v) => up({ support: v })} />
          </Field>
          <Field label={S.confidence.against}>
            <TextField value={event.against ?? ''} onCommit={(v) => up({ against: v })} />
          </Field>

          <div className="event-triggers">
            <label className="event-triggers-label">{S.event.triggers}</label>
            {others.length === 0 ? (
              <div className="hint">{S.event.triggersNone}</div>
            ) : (
              others.map((o) => (
                <label key={o.id} className="event-trigger-row">
                  <input
                    type="checkbox"
                    checked={event.triggers.includes(o.id)}
                    onChange={() => apply((d) => toggleEventTrigger(d, id, o.id))}
                  />
                  <span>
                    {eventCode(o)} · {eventDisplayLabel(o)}
                    {project.nodes[o.nodeId]?.label ? ` (${project.nodes[o.nodeId].label})` : ''}
                  </span>
                </label>
              ))
            )}
          </div>

          <div className="field row-actions">
            <button className="btn danger" onClick={() => apply((d) => removeEvent(d, id))}>
              {S.event.delete}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EventEditor({
  node,
  project,
  apply,
}: {
  node: TreeNode;
  project: Project;
  apply: Apply;
}) {
  const events = eventsForNode(project, node.id);
  const isRoot = node.parentId === null;

  const addTyped = (typeId: string) => {
    const def = findEventType(typeId);
    const target: 'node' | 'branch' = def?.target === 'branch' && !isRoot ? 'branch' : 'node';
    apply((d) => addEvent(d, newEvent(typeId, target, node.id)));
  };

  return (
    <div className="panel-section">
      <h3>{S.event.section}</h3>
      {events.length === 0 && <div className="hint">{S.event.empty}</div>}
      {events.map((e) => (
        <OneEvent key={e.id} event={e} project={project} apply={apply} isRoot={isRoot} />
      ))}
      <Field label={S.event.add}>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) addTyped(e.target.value);
          }}
        >
          <option value="">…</option>
          <TypeOptions />
        </select>
      </Field>
    </div>
  );
}
