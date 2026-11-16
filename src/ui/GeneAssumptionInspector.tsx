// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// DTL assumption editor for ONE selected gene node: its species-tree mapping,
// event class (σ / δ / τ) and — for transfers — the donor. Tip nodes only take
// a mapping. Per-node validation issues are shown inline with the node.
//
// 用户反馈 (2026-11-16): the editor was slimmed down to what a hypothesis
// actually needs — no confidence/evidence block, no "centre the target"
// button, no asserted-losses field (losses stay a computed readout), no
// within-branch-position caption, no unresolved-node walker, and no
// owning-tree header. Mapping target, event class, branch position, transfer
// donor, validation.

import { useMemo } from 'react';
import { useStore } from '../model/store';
import { setAssumption } from '../model/geneTrees';
import { validateScenario, type ReconIssue } from '../model/reconciliation';
import { DEFAULT_RECON_COSTS, type NodeId, type Project } from '../model/types';
import { Field } from './fields';
import { Section } from './Section';
import { S, tr } from './strings';

type Apply = (recipe: (d: Project) => void) => void;

/** Depth-indented option list over the species tree for the mapping select. */
function useSpeciesOptions(project: Project): { id: NodeId; label: string; depth: number }[] {
  return useMemo(() => {
    const out: { id: NodeId; label: string; depth: number }[] = [];
    const walk = (id: NodeId, depth: number) => {
      const n = project.nodes[id];
      if (!n) return;
      out.push({ id, label: n.label || n.id.slice(0, 6), depth });
      for (const c of n.childrenIds) walk(c, depth + 1);
    };
    if (project.rootId) walk(project.rootId, 0);
    return out;
  }, [project]);
}

export function GeneAssumptionInspector({
  geneTreeId,
  geneNodeId,
}: {
  geneTreeId: string;
  geneNodeId: NodeId;
}) {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);

  const entry = project.geneTrees?.find((g) => g.id === geneTreeId);
  const geneNode = entry?.doc.nodes[geneNodeId];
  const assumption = entry?.assumptions[geneNodeId];
  const costs = project.reconCosts ?? DEFAULT_RECON_COSTS;

  // Per-node validation issues for inline display.
  const myIssues = useMemo(() => {
    if (!entry) return [] as ReconIssue[];
    return validateScenario(project, entry.doc, entry.assumptions, costs).filter(
      (i) => i.nodeId === geneNodeId,
    );
  }, [project, entry, geneNodeId, costs]);

  const speciesOptions = useSpeciesOptions(project);
  if (!entry || !geneNode) return null;
  const isTip = geneNode.childrenIds.length === 0;

  type EventClass = 'speciation' | 'duplication' | 'transfer';

  const update = (
    recipe: {
      speciesNode?: NodeId;
      event?: EventClass | undefined;
      losses?: number;
      branchFraction?: number | undefined;
      transferDonor?: NodeId | undefined;
    },
    remove = false,
  ) => {
    apply((d) => {
      if (remove) {
        setAssumption(d, geneTreeId, geneNodeId, null);
        return;
      }
      // Species change without a valid target leaves the row untouched.
      if (recipe.speciesNode !== undefined && !d.nodes[recipe.speciesNode]) return;
      if (recipe.transferDonor !== undefined && recipe.transferDonor !== null && !d.nodes[recipe.transferDonor]) return;
      setAssumption(d, geneTreeId, geneNodeId, recipe, recipe.speciesNode);
    });
  };

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.reconInspector.title}</span>
        <span className="panel-header-subtitle">
          {geneNode.label || geneNodeId.slice(0, 6)}
          {isTip ? `（${S.reconInspector.tipLabel}）` : `（${S.reconInspector.tipInternal}）`}
        </span>
      </div>

      {isTip && <div className="hint" style={{ margin: '0 12px' }}>{S.reconInspector.tipHint}</div>}

      <Section title={S.reconInspector.mapTo} pinable>
        <Field label={S.reconInspector.mapTo}>
          <select
            value={assumption?.speciesNode ?? ''}
            onChange={(e) =>
              e.target.value ? update({ speciesNode: e.target.value }) : update({}, true)
            }
          >
            <option value="">{S.reconInspector.unmappedTarget}</option>
            {speciesOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {' '.repeat(o.depth * 2)}
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {!isTip && (
          <>
            <Field label={S.reconInspector.event}>
              <select
                value={assumption?.event ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  update({ event: v === '' ? undefined : (v as EventClass) });
                }}
              >
                <option value="">{S.reconInspector.evClear}</option>
                <option value="speciation">{S.reconInspector.evSpeciation}</option>
                <option value="duplication">{S.reconInspector.evDuplication}</option>
                <option value="transfer">{S.reconInspector.evTransfer}</option>
              </select>
            </Field>
            {/* Embedded-view path field (plan §7.5): where along the host
                branch the lineage sits. */}
            {assumption?.speciesNode && (
              <Field label={S.reconInspector.branchFraction}>
                <div className="field row-actions" style={{ gap: 6 }}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    disabled={!assumption}
                    value={
                      assumption?.branchFraction !== undefined
                        ? Math.round(assumption.branchFraction * 100)
                        : 100
                    }
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      update({ branchFraction: v });
                    }}
                    aria-label={S.reconInspector.branchFraction}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <button
                    className="btn icon tiny"
                    title={S.reconInspector.branchFractionAuto}
                    aria-label={S.reconInspector.branchFractionAuto}
                    disabled={assumption?.branchFraction === undefined}
                    onClick={() => update({ branchFraction: undefined })}
                  >
                    {assumption?.branchFraction !== undefined
                      ? `${Math.round(assumption.branchFraction * 100)}%`
                      : tr('自动', 'Auto')}
                  </button>
                </div>
              </Field>
            )}
            {assumption?.event === 'transfer' && (
              <>
                <Field label={S.reconInspector.transferDonor}>
                  <select
                    value={assumption?.transferDonor ?? ''}
                    onChange={(e) =>
                      e.target.value
                        ? update({ transferDonor: e.target.value })
                        : update({ transferDonor: undefined })
                    }
                  >
                    <option value="">{S.reconInspector.transferDonorAuto}</option>
                    {speciesOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {' '.repeat(o.depth * 2)}
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="hint">{S.reconInspector.transferDonorHint}</div>
              </>
            )}
          </>
        )}
      </Section>

      {myIssues.length > 0 && (
        <Section title={S.recon.validation} pinable>
          <ul className="issue-list">
            {myIssues.map((it, i) => (
              <li key={i} className={`issue issue-${it.severity}`}>
                <span className="issue-tag">[{it.severity === 'error' ? S.recon.severityError : S.recon.severityWarning}]</span>{' '}
                {it.message}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

export type { Apply };
