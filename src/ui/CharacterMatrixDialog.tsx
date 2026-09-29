// Character matrix editor: a spreadsheet of tips (rows) × characters (columns).
//
// Editing a cell writes the tip's observed state and the canvas recolours
// immediately (two-way link). Internal-node "ancestral state hypotheses" are
// set by selecting a node on the canvas and using the right-hand panel, so the
// matrix stays a clean taxon × character table.

import { useMemo } from 'react';
import { useStore } from '../model/store';
import { setNodeState } from '../model/treeOps';
import type { Project, TreeNode } from '../model/types';
import { NumberField } from './fields';
import { useDialogFocus } from './useDialogFocus';
import { matrixCellOptions, matrixCellSwatch, matrixCellWrite } from './matrixCell';
import { S } from './strings';

type Apply = (recipe: (d: Project) => void) => void;

function Cell({
  node,
  characterId,
  type,
  states,
  apply,
}: {
  node: TreeNode;
  characterId: string;
  type: 'discrete' | 'continuous';
  states: { id: string; label: string; color: string }[];
  apply: Apply;
}) {
  const value = node.charStates?.[characterId];
  if (type === 'continuous') {
    return (
      <NumberField
        value={typeof value === 'number' ? value : undefined}
        allowEmpty
        onCommit={(v) => apply((d) => setNodeState(d, node.id, characterId, v))}
      />
    );
  }
  const swatch = matrixCellSwatch(states, value);
  // The cell writes a DECLARED state or nothing at all: `?` / `-` are not offered
  // as values and "unassigned" clears the cell, because the model treats a
  // recorded missing code as data (it is excluded from CI/RI, from transition
  // counts and from the narrative as "missing"), which is not the same document
  // state as an empty cell. A code already in the document is still shown, on a
  // disabled row, so opening the matrix cannot quietly rewrite it.
  const options = matrixCellOptions(states, value, {
    unassigned: S.matrix.unassigned,
    missingData: S.characterExtra.missingData,
    notApplicable: S.characterExtra.notApplicable,
    staleValue: S.characterExtra.staleValue,
  });
  return (
    <div className="matrix-cell">
      <span className="matrix-swatch" style={{ background: swatch ?? 'transparent' }} />
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) =>
          apply((d) => setNodeState(d, node.id, characterId, matrixCellWrite(states, e.target.value)))
        }
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CharacterMatrixDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);

  const tips = useMemo(
    () =>
      Object.values(project.nodes)
        .filter((n) => n.childrenIds.length === 0)
        .sort((a, b) => (a.label || '').localeCompare(b.label || '')),
    [project.nodes],
  );

  // Focus trap + Esc close + initial focus.
  const ref = useDialogFocus(open, onClose);

  if (!open) return null;
  const characters = project.characters;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={ref}
        className="dialog matrix-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.matrix.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.matrix.title}</h2>
        {characters.length === 0 ? (
          <div className="hint">{S.matrix.empty}</div>
        ) : (
          <>
            <div className="hint" style={{ marginBottom: 10 }}>
              {S.matrix.hint}
            </div>
            <div className="matrix-scroll">
              <table className="matrix-table">
                <thead>
                  <tr>
                    <th className="matrix-corner">{S.matrix.taxon}</th>
                    {characters.map((c) => (
                      <th key={c.id}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tips.map((tip) => (
                    <tr key={tip.id}>
                      <td className="matrix-taxon" title={tip.label}>
                        {tip.label || '—'}
                      </td>
                      {characters.map((c) => (
                        <td key={c.id}>
                          <Cell
                            node={tip}
                            characterId={c.id}
                            type={c.type}
                            states={c.states}
                            apply={apply}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            {S.matrix.close}
          </button>
        </div>
      </div>
    </div>
  );
}
