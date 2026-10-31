// Left-column hypothesis-layer switcher (the evolutionary semantic layer).
//
// Maintain several competing hypotheses over the same tree: switch the active
// layer, rename it, duplicate the current one to branch a new idea, or add a
// blank layer. Switching / adding are single undoable recipes.

import { PlusIcon, CopyIcon, TrashIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  addBlankLayer,
  duplicateActiveLayer,
  removeLayer,
  renameLayer,
  switchLayer,
} from '../model/layers';
import { Field, TextField, CheckboxField } from './fields';
import { Section } from './Section';
import { S } from './strings';
import { requestConfirm } from './confirmDialog';

export function LayerPanel() {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const layers = project.layers;
  const activeLayerId = project.activeLayerId;
  const showEvents = useStore((s) => s.showEvents);
  const setShowEvents = useStore((s) => s.setShowEvents);

  const active = layers.find((l) => l.id === activeLayerId);
  const nextName = () => `${S.layer.section} ${layers.length + 1}`;
  // A layer is more than a name: show what it currently asserts, so "New"
  // does not read as an empty label with no consequence.
  const nodes = Object.values(project.nodes);
  const noteCount = nodes.filter((n) => n.hypothesisNote?.trim()).length;
  const stateCount = nodes.reduce(
    (sum, n) => (n.childrenIds.length > 0 ? sum + Object.keys(n.charStates ?? {}).length : sum),
    0,
  );

  return (
    <Section title={S.layer.section} pinable>

      <Field label={S.layer.current}>
        <select
          value={activeLayerId}
          onChange={(e) => apply((d) => switchLayer(d, e.target.value))}
        >
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>

      {active && (
        <Field label={S.layer.name}>
          <TextField
            value={active.name}
            onCommit={(v) => apply((d) => renameLayer(d, active.id, v))}
          />
        </Field>
      )}

      <div className="layer-summary">
        {S.layer.summary(noteCount, stateCount, project.events.length)}
      </div>

      {/* Event overlay toggle lives HERE: events are hypothesis content. */}
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

      <div className="hint">{S.layer.noteGuide}</div>
    </Section>
  );
}
