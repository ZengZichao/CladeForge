// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
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
  updateEvent,
} from '../model/treeOps';
import {
  EVENT_MARKER_SHAPES,
  EVENT_MARKER_SIZE_MAX,
  EVENT_MARKER_SIZE_MIN,
  clampEventMarkerSize,
  eventBadgeExtent,
  eventBadgeFontSize,
  eventBadgeText,
  eventMarkerColor,
  eventMarkerShape,
  eventMarkerSize,
  eventDisplayLabel,
  eventTypeLabel,
  eventsForNode,
  findEventType,
  newEvent,
} from '../model/events';
import type { EvolutionaryEvent, Project, TreeNode } from '../model/types';
import { eventMarkerPath } from '../canvas/markerGeometry';
import { ColorField, Field, TextField } from './fields';
import { SliderNumberField } from './SliderNumberField';
import { Section } from './Section';
import { S, tr } from './strings';
import { requestConfirm } from './confirmDialog';

type Apply = (recipe: (d: Project) => void) => void;

/**
 * Searchable event-type picker (2026-11-15 FN-2).
 *
 * The catalogue has 27 built-in types across nine groups; a plain `<select>`
 * made finding one a scroll-through-the-list chore. This keeps the same
 * catalogue and groups but adds a live filter, and collapses into a compact
 * closed button when idle. It renders INLINE (not a floating popup): the
 * inspector is a scroll container, and an absolutely positioned panel would be
 * clipped by it — the exact bug the toolbar dropdowns had to escape with a
 * portal.
 */
/**
 * A15: pinyin search aliases for the 27 built-in event types, keyed by type
 * id. Search-only data (never displayed); full syllables + close variants so
 * a query like "kuosan" or "mianjue" finds the type the way the command
 * palette's pinyin aliases do.
 */

/** M28: a real dialog for defining a custom event type — named fields with
 *  labels, IME-safe commit, Escape close, no window.prompt. */
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
  const badgeText = eventBadgeText(event, project);
  const badgeExtent = eventBadgeExtent(event);

  return (
    <div className="event-item">
      <div className="event-row">
        {/* Live marker preview: the same shape / colour / text the canvas draws. */}
        <span
          className="event-badge-preview"
          title={findEventType(event.typeId, project) ? eventTypeLabel(findEventType(event.typeId, project)!) : undefined}
          aria-hidden
        >
          <svg
            viewBox={`${-badgeExtent - 2} ${-badgeExtent - 2} ${badgeExtent * 2 + 4} ${badgeExtent * 2 + 4}`}
            width="26"
            height="26"
          >
            <path
              d={eventMarkerPath(eventMarkerShape(event), 0, 0, eventMarkerSize(event))}
              fill="var(--surface)"
              stroke={eventMarkerColor(event, project)}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {badgeText && (
              <text
                x={0}
                y={0}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={eventBadgeFontSize(event)}
                fontWeight={700}
              >
                {badgeText}
              </text>
            )}
          </svg>
        </span>
        <span className="event-title" title={eventDisplayLabel(event, project)}>
          {eventDisplayLabel(event, project)}
        </span>
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {S.character.edit}
        </button>
      </div>

      {open && (
        <div className="event-editor">
          {/* 用户反馈：no predefined event types — the user specifies shape,
              fill, size, stroke colour, stroke width, title and the position
              along the branch. Confidence / evidence / against / triggers are
              gone from the UI. */}
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
          <Field label={tr('事件标题', 'Event title')}>
            <TextField
              value={event.label ?? ''}
              placeholder={S.event.labelPlaceholder}
              onCommit={(v) => up({ label: v })}
            />
          </Field>
          <div className="event-marker-style">
            <div className="event-marker-style-title">{S.event.markerSection}</div>
            <Field label={S.event.markerShape}>
              <select
                value={eventMarkerShape(event)}
                onChange={(e) => up({ markerShape: e.target.value as EvolutionaryEvent['markerShape'] })}
              >
                {EVENT_MARKER_SHAPES.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {tr(sh.label, sh.labelEn)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={S.event.markerSize}>
              <SliderNumberField
                value={event.markerSize ?? 8}
                min={EVENT_MARKER_SIZE_MIN}
                max={EVENT_MARKER_SIZE_MAX}
                step={1}
                unit="px"
                recipe={(v) => (d) => updateEvent(d, id, { markerSize: clampEventMarkerSize(v) })}
              />
            </Field>
            <Field label={tr('填充颜色', 'Fill colour')}>
              <ColorField
                value={event.markerFill ?? 'var(--surface)'}
                ariaLabel={tr('填充颜色', 'Fill colour')}
                onChange={(v) => up({ markerFill: v })}
              />
            </Field>
            <Field label={S.event.markerColor}>
              <ColorField
                value={eventMarkerColor(event, project)}
                ariaLabel={S.event.markerColor}
                onChange={(v) => up({ markerColor: v })}
              />
            </Field>
            <Field label={tr('描边粗细', 'Stroke width')}>
              <SliderNumberField
                value={event.markerStrokeWidth ?? 2}
                min={0.5}
                max={8}
                step={0.5}
                unit="px"
                recipe={(v) => (d) => updateEvent(d, id, { markerStrokeWidth: v })}
              />
            </Field>
            {event.target === 'branch' && (
              <Field label={tr('在分支上的相对位置', 'Position along the branch')}>
                <SliderNumberField
                  value={event.position ?? 0.5}
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  recipe={(v) => (d) => updateEvent(d, id, { position: v })}
                />
              </Field>
            )}
          </div>
          <div className="field row-actions">
            <button
              className="btn danger"
              onClick={() => {
                // M7: an event carries occurrences and possibly layer copies;
                // deleting it deserves the same confirm + ⌘Z story as a node.
                requestConfirm({
                  key: 'delete-event',
                  title: S.event.delete,
                  message: tr(
                    '将删除该事件及其全部发生记录。该操作可通过 ⌘Z 撤销。',
                    'This deletes the event with all of its occurrences. Undoable via ⌘Z.',
                  ),
                  confirmLabel: S.event.delete,
                  danger: true,
                  onConfirm: () => apply((d) => removeEvent(d, id)),
                });
              }}
            >
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

  return (
    <Section
      title={S.event.section}
      count={events.length}
      defaultOpen={false}
      favoritable
      keywords={['事件', '演化事件', '因果链', 'event', 'evolutionary event', 'causal']}
    >
      {events.length === 0 && <div className="hint">{S.event.empty}</div>}
      {events.map((e) => (
        <OneEvent key={e.id} event={e} project={project} apply={apply} isRoot={isRoot} />
      ))}
      <Field label={S.event.add}>
        <button
          className="btn"
          onClick={() => {
            const target: 'node' | 'branch' = isRoot ? 'node' : 'branch';
            apply((d) => addEvent(d, newEvent('custom', target, node.id)));
          }}
        >
          ＋ {tr('添加事件', 'Add event')}
        </button>
      </Field>
    </Section>
  );
}
