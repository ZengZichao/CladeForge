// Left-column character / state manager (evolutionary semantic layer).
//
// Lets the user define traits ("characters") and their coloured states, choose
// which character currently colours the tree, toggle transition markers, and
// open the character matrix. Editing a character expands inline. All edits go
// through treeOps recipes so they are undoable.

import { useEffect, useRef, useState } from 'react';
import { Cross1Icon, PlusIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  addCharacter,
  addCharacterState,
  removeCharacter,
  removeCharacterState,
  renameCharacter,
  setCharacterCostMatrix,
  setCharacterType,
  updateCharacterState,
} from '../model/treeOps';
import { newCharacter, newCharacterState, stateColorLimitWarning } from '../model/characters';
import { uniformCostMatrix } from '../model/parsimony';
import type { Character, Project } from '../model/types';
import { Field, TextField, CheckboxField, ColorField, DismissibleHint } from './fields';
import { Section } from './Section';
import { S, tr } from './strings';
import { notify } from './toast';

type Apply = (recipe: (d: Project) => void) => void;

// Expandable Sankoff step-matrix editor: a k×k grid of from→to change costs.
// Uncontrolled number inputs commit on blur; the grid remounts on reset so it
// reflects the restored uniform matrix.
function StepMatrixEditor({ character, apply }: { character: Character; apply: Apply }) {
  const [open, setOpen] = useState(false);
  const [symmetric, setSymmetric] = useState(false);
  const k = character.states.length;
  if (k < 2) return null;
  const matrix = character.costMatrix ?? uniformCostMatrix(k);
  const setCell = (i: number, j: number, v: number | undefined) => {
    const next = (character.costMatrix ?? uniformCostMatrix(k)).map((row) => row.slice());
    const clamped = v === undefined || v < 0 ? 0 : v;
    next[i][j] = clamped;
    // Symmetric mode: mirror the edit to the opposite cell (i≠j only).
    if (symmetric && i !== j) next[j][i] = clamped;
    apply((d) => setCharacterCostMatrix(d, character.id, next));
  };
  return (
    <div className="step-matrix-wrap">
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        {S.character.stepMatrix}
        {character.costMatrix ? ' •' : ''}
      </button>
      {open && (
        <div className="step-matrix" key={character.costMatrix ? 'custom' : 'uniform'}>
          <div className="hint">{S.character.stepMatrixHint}</div>
          <CheckboxField
            label={S.characterExtra.symmetric}
            checked={symmetric}
            onChange={setSymmetric}
          />
          {symmetric && <div className="hint">{S.characterExtra.symmetricHint}</div>}
          <table className="step-grid">
            <thead>
              <tr>
                <th />
                {character.states.map((s) => (
                  <th key={s.id} title={s.label}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {character.states.map((rs, i) => (
                <tr key={rs.id}>
                  <th title={rs.label}>{rs.label}</th>
                  {character.states.map((cs, j) => (
                    <td key={cs.id}>
                      {i === j ? (
                        <span className="diag">0</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={matrix[i]?.[j] ?? 1}
                          onBlur={(e) =>
                            setCell(i, j, e.target.value === '' ? undefined : parseFloat(e.target.value))
                          }
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="field row-actions">
            <button
              className="btn"
              onClick={() => apply((d) => setCharacterCostMatrix(d, character.id, undefined))}
            >
              {S.character.resetWeights}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterEditor({
  character,
  apply,
  onClose,
}: {
  character: Character;
  apply: Apply;
  onClose: () => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Auto scroll-into-view when the editor opens so the user can
  // always see the expanded content, even in a long panel.
  useEffect(() => {
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const id = character.id;
  const project = useStore((s) => s.project);

  // Tips of this character that already carry a value (used for the honest note below).
  const assignedTips = Object.values(project.nodes).filter(
    (n) => n.childrenIds.length === 0 && n.charStates?.[id] !== undefined,
  ).length;

  // Switching type only re-tags the character and discards nothing, so there is
  // no confirmation dialog: a warning promising to drop the discrete state
  // assignments would threaten a data loss that cannot happen.
  //
  // Discarding is genuinely unnecessary: the declared states stay on the
  // character, the tip values stay on the nodes, and the matrix / inspector are
  // already built to keep a value that is not a state of the character visible as
  // a stale value (`S.characterExtra.staleValue`). Switching back restores the
  // colouring, and Undo reverses the tag. The type selector says this out loud
  // where the choice is made instead of asking the user to trust a warning.
  const switchType = (newType: Character['type']) => {
    if (newType === character.type) return;
    apply((d) => setCharacterType(d, id, newType));
  };

  return (
    <div className="char-editor" ref={editorRef}>
      <Field label={S.character.name}>
        <TextField
          value={character.name}
          ariaLabel={S.character.name}
          onCommit={(v) => apply((d) => renameCharacter(d, id, v))}
        />
      </Field>
      <Field label={S.character.type}>
        <select
          value={character.type}
          onChange={(e) => switchType(e.target.value as Character['type'])}
        >
          <option value="discrete">{S.character.typeDiscrete}</option>
          <option value="continuous">{S.character.typeContinuous}</option>
        </select>
      </Field>
      {assignedTips > 0 && (
        <div className="hint">
          {tr(
            `切换类型不会删除已有的 ${assignedTips} 个末端赋值：它们保留在文档中，切回原类型即恢复显示（连续性状只读取数值，其余按未赋值处理）。`,
            `Switching the type does not delete the ${assignedTips} tip assignment(s) already made: they stay in the document and the colouring returns if you switch back (a continuous character reads numbers only; the rest count as unassigned).`,
          )}
        </div>
      )}

      {character.type === 'discrete' ? (
        <div className="char-states">
          {character.states.map((st) => (
            <div className="char-state-row" key={st.id}>
              {/* A raw `<input type="color" onChange={apply}>` commits per pixel
                  of the native picker's drag, so one swatch adjustment burned dozens
                  of the 100 undo slots. `ColorField` coalesces the drag into one. */}
              <ColorField
                value={st.color}
                ariaLabel={tr('状态颜色', 'State colour')}
                onChange={(v) => apply((d) => updateCharacterState(d, id, st.id, { color: v }))}
              />
              <TextField
                value={st.label}
                ariaLabel={tr('状态名称', 'State name')}
                onCommit={(v) => apply((d) => updateCharacterState(d, id, st.id, { label: v }))}
              />
              <button
                className="btn icon danger"
                title={S.node.delete}
                onClick={() => apply((d) => removeCharacterState(d, id, st.id))}
              >
                <Cross1Icon />
              </button>
            </div>
          ))}
          <button
            className="btn"
            onClick={() => {
              // The colour index is read from the DRAFT, not from `character`.
              // Two clicks processed before React re-renders both see the same
              // `character.states.length`, and the second state would then be
              // handed the first state's colour — literally indistinguishable
              // swatches, which is exactly what reading from the draft prevents.
              // (Reproduced by driving this button 38× inside one task: 38
              // states, one colour. Real clicks cannot do it, but nothing should
              // rely on how fast the event loop turns.)
              apply((d) => {
                const live = d.characters.find((c) => c.id === id);
                addCharacterState(d, id, newCharacterState(tr('状态', 'State'), live?.states.length ?? 0));
              });
              // Past the measured limit the derived palette stops being
              // distinguishable, so say so instead of adding another look-alike
              // swatch.
              const nextCount = character.states.length + 1;
              const warn = stateColorLimitWarning(nextCount);
              if (warn && nextCount % 4 === 1) notify.info(warn);
            }}
          >
            {S.character.addState}
          </button>
        </div>
      ) : (
        <>
          {/* Same picker-flood coalescing as the state swatches above — see ColorField. */}
          <Field label={S.character.lowColor}>
            <ColorField
              value={character.lowColor ?? '#dbeafe'}
              onChange={(v) =>
                apply((d) => {
                  const c = d.characters.find((x) => x.id === id);
                  if (c) c.lowColor = v;
                })
              }
            />
          </Field>
          <Field label={S.character.highColor}>
            <ColorField
              value={character.highColor ?? '#1e3a8a'}
              onChange={(v) =>
                apply((d) => {
                  const c = d.characters.find((x) => x.id === id);
                  if (c) c.highColor = v;
                })
              }
            />
          </Field>
        </>
      )}

      {character.type === 'discrete' && <StepMatrixEditor character={character} apply={apply} />}

      <div className="field row-actions-spread">
        <div className="actions-group">
          <button className="btn" onClick={onClose}>
            {S.character.done}
          </button>
        </div>
        <button
          className="btn danger"
          onClick={() => {
            apply((d) => removeCharacter(d, id));
            onClose();
          }}
        >
          {S.character.deleteCharacter}
        </button>
      </div>
    </div>
  );
}

export function CharacterPanel({
  onOpenMatrix,
}: {
  onOpenMatrix: () => void;
}) {
  const apply = useStore((s) => s.apply);
  const characters = useStore((s) => s.project.characters);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const setActiveCharacter = useStore((s) => s.setActiveCharacter);
  const showTransitions = useStore((s) => s.showTransitions);
  const setShowTransitions = useStore((s) => s.setShowTransitions);
  const [editingId, setEditingId] = useState<string | null>(null);

  const active = characters.find((c) => c.id === activeCharacterId);
  const transitionsDisabled = !active || active.type !== 'discrete';

  return (
    <Section title={S.character.section} pinable>

      <Field label={S.character.colorBy}>
        <select
          value={activeCharacterId ?? ''}
          onChange={(e) => setActiveCharacter(e.target.value || null)}
        >
          <option value="">{S.character.colorByNone}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <CheckboxField
        label={S.character.showTransitions}
        checked={showTransitions && !transitionsDisabled}
        disabled={transitionsDisabled}
        onChange={(v) => setShowTransitions(v)}
      />

      {/* (The event overlay toggle moved to the 假说 layers module.) */}

      <div className="char-list">
        {characters.length === 0 && <div className="hint">{S.character.empty}</div>}
        {characters.map((c) => (
          <div key={c.id}>
            <div className="char-row">
              <span className="char-name" title={c.name}>
                {c.name}
              </span>
              <button
                className="btn"
                onClick={() => setEditingId(editingId === c.id ? null : c.id)}
              >
                {S.character.edit}
              </button>
            </div>
            {editingId === c.id && (
              <CharacterEditor character={c} apply={apply} onClose={() => setEditingId(null)} />
            )}
          </div>
        ))}
      </div>

      <div className="field row-actions-spread">
        <div className="actions-group">
          <button
            className="btn primary"
            onClick={() => {
              const c = newCharacter(tr('新性状','New character'));
              apply((d) => addCharacter(d, c));
              setActiveCharacter(c.id);
              setEditingId(c.id);
            }}
          >
            <PlusIcon /> {S.character.add}
          </button>
          <button
            className="btn"
            disabled={characters.length === 0}
            onClick={onOpenMatrix}
          >
            {S.analysisMenu.matrix}
          </button>
        </div>
      </div>
    </Section>
  );
}
