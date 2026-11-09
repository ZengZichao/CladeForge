// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// DTL assumption editor for ONE selected gene node: its species-tree mapping,
// event class (σ / δ / τ), asserted losses, and confidence/evidence. Tip nodes
// only take a mapping. Per-node validation issues are shown inline with
// click-through hints.
//
// Enhanced for the reconciliation workspace (§5.4 B): the header names the
// owning gene tree + the read-only badge, prev/next buttons walk the
// unresolved nodes, and a button centres the mapping target in the species
// pane — the canvas expresses what the form edits.

import { useMemo } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, Crosshair2Icon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import { setAssumption } from '../model/geneTrees';
import { validateScenario, type ReconIssue } from '../model/reconciliation';
import { DEFAULT_RECON_COSTS, type Confidence, type NodeId, type Project } from '../model/types';
import { CheckboxField as _CheckboxField, Field, NumberField, TextField } from './fields';
void _CheckboxField;
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
  const focusGeneNode = useStore((s) => s.focusGeneNode);

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

  // Unresolved internal nodes: the prev/next walk for quick scenario completion.
  const unresolvedIds = useMemo(() => {
    if (!entry) return [] as NodeId[];
    return Object.values(entry.doc.nodes)
      .filter((n) => n.childrenIds.length > 0)
      .filter((n) => {
        const a = entry.assumptions[n.id];
        return !a || !a.event;
      })
      .map((n) => n.id);
  }, [entry]);

  const speciesOptions = useSpeciesOptions(project);
  if (!entry || !geneNode) return null;
  const isTip = geneNode.childrenIds.length === 0;
  const unresolvedIdx = unresolvedIds.indexOf(geneNodeId);

  type EventClass = 'speciation' | 'duplication' | 'transfer';

  const update = (
    recipe: { speciesNode?: NodeId; event?: EventClass | undefined; losses?: number },
    remove = false,
  ) => {
    apply((d) => {
      if (remove) {
        setAssumption(d, geneTreeId, geneNodeId, null);
        return;
      }
      // Species change without a valid target leaves the row untouched.
      if (recipe.speciesNode !== undefined && !d.nodes[recipe.speciesNode]) return;
      setAssumption(d, geneTreeId, geneNodeId, recipe, recipe.speciesNode);
    });
  };

  const metaUpdate = (patchMeta: { confidence?: Confidence; support?: string; against?: string }) => {
    apply((d) => {
      const g = d.geneTrees?.find((x) => x.id === geneTreeId);
      if (!g) return;
      const a = g.assumptions[geneNodeId];
      if (!a) return;
      a.meta = { ...a.meta, ...patchMeta };
    });
  };

  const targetLabel = assumption?.speciesNode
    ? project.nodes[assumption.speciesNode]?.label || assumption.speciesNode.slice(0, 6)
    : S.reconInspector.unmappedTarget;

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.reconInspector.title}</span>
        <span className="panel-header-subtitle">
          {geneNode.label || geneNodeId.slice(0, 6)}
          {isTip ? ` · ${S.reconInspector.tipLabel}` : ` · ${S.reconInspector.tipInternal}`}
        </span>
      </div>

      <div className="hint recon-insp-meta" style={{ margin: '0 12px 8px' }}>
        {S.reconInspector.geneTreeOf}: {entry.name} · <span className="recon-readonly-tag">{S.recon.readonlyBadge}</span>
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
                {'\u00A0'.repeat(o.depth * 2)}
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        {assumption?.speciesNode && (
          <div className="field row-actions">
            <button
              className="btn"
              title={S.recon.centerInSpecies}
              onClick={() => focusGeneNode(geneNodeId)}
            >
              <Crosshair2Icon /> {S.recon.centerInSpecies}
            </button>
          </div>
        )}
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
            <Field label={S.reconInspector.losses}>
              <NumberField
                value={assumption?.losses}
                allowEmpty
                min={0}
                step={1}
                onCommit={(v) => update({ losses: v })}
              />
            </Field>
          </>
        )}
      </Section>

      {/* Walk the unresolved internal nodes without hunting through the tree. */}
      {unresolvedIds.length > 0 && (
        <div className="field row-actions-spread recon-unresolved-nav">
          <button
            className="btn icon"
            title={S.recon.prevUnresolved}
            aria-label={S.recon.prevUnresolved}
            disabled={unresolvedIdx <= 0}
            onClick={() => unresolvedIdx > 0 && focusGeneNode(unresolvedIds[unresolvedIdx - 1])}
          >
            <ArrowLeftIcon />
          </button>
          <span className="hint">
            {tr('未映射', 'Unmapped')} {unresolvedIdx >= 0 ? unresolvedIdx + 1 : '–'}/{unresolvedIds.length}
          </span>
          <button
            className="btn icon"
            title={S.recon.nextUnresolved}
            aria-label={S.recon.nextUnresolved}
            disabled={unresolvedIdx < 0 || unresolvedIdx >= unresolvedIds.length - 1}
            onClick={() =>
              unresolvedIdx >= 0 &&
              unresolvedIdx < unresolvedIds.length - 1 &&
              focusGeneNode(unresolvedIds[unresolvedIdx + 1])
            }
          >
            <ArrowRightIcon />
          </button>
        </div>
      )}

      {assumption && (
        <Section title={S.confidence.label} defaultOpen={false} pinable>
          <Field label={S.confidence.label}>
            <select
              value={assumption.meta?.confidence ?? ''}
              onChange={(e) => metaUpdate({ confidence: (e.target.value || undefined) as Confidence })}
            >
              <option value="">{S.confidence.none}</option>
              <option value="high">{S.confidence.high}</option>
              <option value="medium">{S.confidence.medium}</option>
              <option value="low">{S.confidence.low}</option>
            </select>
          </Field>
          <Field label={S.confidence.support}>
            <TextField value={assumption.meta?.support ?? ''} onCommit={(v) => metaUpdate({ support: v })} />
          </Field>
          <Field label={S.confidence.against}>
            <TextField value={assumption.meta?.against ?? ''} onCommit={(v) => metaUpdate({ against: v })} />
          </Field>
          <Field label={tr('证据记录', 'Evidence')}>
            <span className="hint">{tr('映射移除前持续保留', 'Kept until the mapping is removed')}</span>
          </Field>
        </Section>
      )}

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
