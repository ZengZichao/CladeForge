// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Right-hand inspector of the reconciliation WORKSPACE.
//
// Four states instead of the old "generic panel + one branch" (§5.4):
//   A. nothing selected      → scenario overview (completeness, events,
//                              data quality, legend, quick actions)
//   B. one gene node         → DTL assumption editor (GeneAssumptionInspector)
//   C. one species node      → species inspector + the gene lineages mapped
//                              here
//   D. several gene nodes    → batch summary (+ clear-mappings action)
// The standard `PropertiesPanel` never mounts in the reconciliation workspace.

import { useMemo, useState } from 'react';
import { useStore } from '../model/store';
import { DEFAULT_RECON_COSTS, type NodeId } from '../model/types';
import {
  mapTipsByLabel,
  suggestLcaScenario,
  type ReconIssue,
} from '../model/reconciliation';
import { geneTreeRows } from './reconStats';
import { dtlScenarioToAssumptions, type DtlScenario } from '../model/dtl';
import { solveDtlAsync } from '../model/dtlAsync';
import { setAssumption } from '../model/geneTrees';
import { GeneAssumptionInspector } from './GeneAssumptionInspector';
import { Section } from './Section';
import { requestConfirm } from './confirmDialog';
import { notify } from './toast';
import { S, tr } from './strings';

const DTL_GLYPH: Record<string, string> = {
  speciation: 'σ',
  duplication: 'δ',
  transfer: 'τ',
};

/** A. nothing selected — the scenario overview (default). */
function ReconOverview({ onBuildGeneTree }: { onBuildGeneTree: () => void }) {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const apply = useStore((s) => s.apply);
  const setReconSection = useStore((s) => s.setReconSection);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);
  const [dp, setDp] = useState<{ geneId: string; scenario: DtlScenario } | null>(null);
  /** True while the DTL worker is solving (the button is disabled meanwhile). */
  const [solving, setSolving] = useState(false);

  const entry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);
  const costs = project.reconCosts ?? DEFAULT_RECON_COSTS;
  const rows = useMemo(() => geneTreeRows(project), [project]);
  const row = rows.find((r) => r.id === activeGeneTreeId);

  if (!entry || !row) {
    return (
      <>
        <div className="panel-header">
          <span className="panel-header-title">{S.recon.overviewTitle}</span>
          <span className="panel-header-subtitle">{S.recon.section}</span>
        </div>
        <div className="hint" style={{ margin: '12px' }}>{S.recon.emptyReconHint}</div>
        <div className="field row-actions" style={{ margin: '0 12px' }}>
          <button className="btn primary" onClick={onBuildGeneTree}>{S.recon.emptyBuild}</button>
        </div>
        <LegendBlock />
      </>
    );
  }

  const topIssues = row.issues.slice(0, 3);

  // The DP is a pure module, so it runs on the DTL worker and keeps the window
  // responsive; a result solved against a document that has since changed is
  // discarded rather than applied to a tree the user no longer sees.
  const runOverviewDp = async () => {
    if (solving) return;
    const doc = project;
    const geneDoc = entry.doc;
    const entryId = entry.id;
    setSolving(true);
    try {
      const r = await solveDtlAsync(doc, geneDoc, costs);
      if (useStore.getState().project !== doc) {
        notify.info(
          tr(
            '求解期间文档已更改，本次结果已丢弃，请重新运行',
            'The document changed during the solve; the result was discarded — run it again',
          ),
        );
        return;
      }
      if (r.error || !r.scenario) {
        notify.info(r.error ?? tr('求解失败', 'Solver failed'));
        setDp(null);
        return;
      }
      setDp({ geneId: entryId, scenario: r.scenario });
    } finally {
      setSolving(false);
    }
  };

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.recon.overviewTitle}</span>
        <span className="panel-header-subtitle">{S.recon.section}</span>
      </div>
      <Section title={entry.name} pinable>
        <div className="hint">
          <span className="recon-readonly-tag">{S.recon.readonlyBadge}</span>
        </div>
        <div className="recon-ov-grid">
          <span>{S.recon.overviewSpeciesNodes}</span>
          <b>{Object.keys(project.nodes).length}</b>
          <span>{S.recon.overviewGeneTips}</span>
          <b>{row.tips}</b>
          <span>{S.recon.sbTipsMapped(row.mappedTips, row.tips)}</span>
          <b>{`${row.mappedTips}/${row.tips}`}</b>
          <span>{S.recon.sbInternal(row.summary.mappedInternal, row.summary.totalInternal)}</span>
          <b>{`${row.summary.mappedInternal}/${row.summary.totalInternal}`}</b>
          <span>{S.recon.sbUnresolved(row.summary.totalInternal - row.summary.mappedInternal)}</span>
          <b>{String(row.summary.totalInternal - row.summary.mappedInternal)}</b>
        </div>
        <div className="recon-stat-grid">
          <span className="recon-chip chip-sigma">σ {row.summary.speciation}</span>
          <span className="recon-chip chip-dup">δ {row.summary.duplication}</span>
          <span className="recon-chip chip-transfer">τ {row.summary.transfer}</span>
          <span className="recon-chip chip-loss">λ {row.summary.losses}</span>
          <span className="recon-chip">{tr('总代价', 'total cost')} {row.summary.cost}</span>
        </div>
        {dp && dp.geneId === entry.id && (
          <div className="recon-stat-grid">
            <span className="recon-chip">{S.recon.dpOptimal} {dp.scenario.cost}</span>
            <button
              className="btn"
              onClick={() => {
                apply((d) => {
                  const g = d.geneTrees?.find((x) => x.id === entry.id);
                  if (!g) return;
                  g.assumptions = dtlScenarioToAssumptions(d, g.doc, dp.scenario);
                });
                notify.success(S.recon.dpApply);
              }}
            >
              {S.recon.dpApply}
            </button>
          </div>
        )}
      </Section>

      <Section title={S.recon.dataQuality} pinable>
        <div
          className="hint issue-summary-link"
          role="button"
          tabIndex={0}
          onClick={() => setReconSection('validation')}
          onKeyDown={(e) => e.key === 'Enter' && setReconSection('validation')}
        >
          {S.recon.sbIssues(row.errors, row.warnings)}
        </div>
        {topIssues.length > 0 && (
          <ul className="issue-list">
            {topIssues.map((it: ReconIssue, i: number) => (
              <li
                key={i}
                className={`issue issue-${it.severity}${it.nodeId ? ' issue-click' : ''}`}
                onClick={() => {
                  if (it.nodeId) {
                    selectGeneNode(it.nodeId);
                    focusGeneNode(it.nodeId);
                  }
                }}
              >
                <span className="issue-tag">[{it.severity === 'error' ? S.recon.severityError : S.recon.severityWarning}]</span> {it.message}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={S.recon.quickActions} pinable>
        <div className="field row-actions">
          <button
            className="btn primary"
            onClick={() => {
              apply((d) => {
                const g = d.geneTrees?.find((x) => x.id === entry.id);
                if (!g) return;
                const tipMap = mapTipsByLabel(d, g.doc).mappings;
                g.assumptions = suggestLcaScenario(d, g.doc, tipMap, g.assumptions);
              });
              notify.success(tr('已生成 MRCA 建议场景', 'MRCA suggestion applied'));
            }}
          >
            {S.recon.suggestLca}
          </button>
          <button
            className="btn"
            onClick={() => void runOverviewDp()}
            disabled={solving}
          >
            {solving ? tr('求解中…', 'Solving…') : S.recon.dpRun}
          </button>
        </div>
      </Section>

      <LegendBlock />
    </>
  );
}

/** The mapping-line colour language, spelled out where the user reads. */
export function LegendBlock() {
  return (
    <div className="recon-insp-legend">
      <div className="recon-insp-legend-title">{S.recon.legendTitle}</div>
      <span className="legend-item"><span className="legend-swatch sw-sigma" />{S.recon.legendSigma}</span>
      <span className="legend-item"><span className="legend-swatch sw-dup" />{S.recon.legendDup}</span>
      <span className="legend-item"><span className="legend-swatch sw-transfer" />{S.recon.legendTransfer}</span>
      <span className="legend-item"><span className="legend-swatch sw-unresolved" />{S.recon.legendUnresolved}</span>
      <span className="legend-item"><span className="legend-swatch sw-tip" />{S.recon.legendTipLine}</span>
      <span className="legend-item"><span className="legend-swatch sw-internal" />{S.recon.legendInternalLine}</span>
      <span className="legend-item"><span className="legend-swatch sw-loss" />{S.recon.legendLoss}</span>
    </div>
  );
}

/** C. one species node selected. */
function SpeciesNodeInspector({ nodeId }: { nodeId: NodeId }) {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const geneSelection = useStore((s) => s.geneSelection);
  const apply = useStore((s) => s.apply);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);

  const node = project.nodes[nodeId];
  const entry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);
  const lineages = useMemo(() => {
    if (!entry) return [];
    return Object.entries(entry.assumptions)
      .filter(([, a]) => a.speciesNode === nodeId)
      .map(([gid, a]) => ({ gid, a, node: entry.doc.nodes[gid] }))
      .filter((x) => x.node);
  }, [entry, nodeId]);

  if (!node) return null;
  const parent = node.parentId ? project.nodes[node.parentId] : null;
  const geneSelected = geneSelection.length === 1;

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.recon.speciesInspectorTitle}</span>
        <span className="panel-header-subtitle">{node.label || nodeId.slice(0, 6)}</span>
      </div>
      <div className="hint" style={{ margin: '0 12px 8px' }}>{S.recon.isSpeciesNode}</div>
      <Section title={tr('节点信息', 'Node')} pinable>
        <div className="recon-ov-grid">
          <span>{tr('名称', 'Name')}</span>
          <b>{node.label || '—'}</b>
          <span>{tr('类型', 'Kind')}</span>
          <b>{node.childrenIds.length > 0 ? tr('内部节点', 'internal') : tr('末端', 'tip')}</b>
          <span>{tr('年龄', 'Age')}</span>
          <b>{node.age !== undefined ? String(node.age) : '—'}</b>
          <span>{tr('枝长', 'Branch length')}</span>
          <b>{node.branchLength !== undefined ? String(node.branchLength) : '—'}</b>
          <span>{tr('支持度', 'Support')}</span>
          <b>{node.support !== undefined ? String(node.support) : '—'}</b>
          <span>{tr('父节点', 'Parent')}</span>
          <b>{parent?.label || '—'}</b>
        </div>
      </Section>
      <Section title={S.recon.lineagesHere} pinable>
        {lineages.length === 0 ? (
          <div className="hint">{S.recon.noLineagesHere}</div>
        ) : (
          <ul className="issue-list">
            {lineages.map(({ gid, a, node: gNode }) => (
              <li
                key={gid}
                className="issue issue-click"
                onClick={() => {
                  selectGeneNode(gid);
                  focusGeneNode(gid);
                }}
              >
                <span className="issue-tag">[{DTL_GLYPH[a.event ?? ''] ?? '·'}]</span>{' '}
                {gNode.label || gid.slice(0, 6)}
                {a.losses ? ` · λ${a.losses}` : ''}
              </li>
            ))}
          </ul>
        )}
        <div className="field row-actions">
          <button
            className="btn"
            disabled={!geneSelected}
            title={geneSelected ? S.recon.mapSelectedHere : S.recon.mapSelectedHereNeedGene}
            onClick={() => {
              if (!geneSelected || !entry) return;
              const gid = geneSelection[0];
              apply((d) => {
                setAssumption(d, entry.id, gid, {}, nodeId);
              });
              selectGeneNode(gid);
            }}
          >
            {S.recon.mapSelectedHere}
          </button>
        </div>
        {!geneSelected && <div className="hint">{S.recon.mapSelectedHereNeedGene}</div>}
      </Section>
    </>
  );
}

/** D. several gene nodes selected — batch summary. */
function MultiGeneSummary() {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const geneSelection = useStore((s) => s.geneSelection);
  const apply = useStore((s) => s.apply);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);

  const entry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);
  const items = useMemo(() => {
    if (!entry) return [];
    return geneSelection
      .map((gid) => ({ gid, node: entry.doc.nodes[gid], a: entry.assumptions[gid] }))
      .filter((x) => x.node);
  }, [entry, geneSelection]);

  if (!entry || items.length === 0) return null;
  const unresolved = items.filter((x) => !x.a?.event).length;
  const eventMix = items.reduce<Record<string, number>>((acc, x) => {
    const k = x.a?.event ?? 'none';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.recon.multiTitle(items.length)}</span>
        <span className="panel-header-subtitle">{S.recon.section}</span>
      </div>
      <Section title={S.recon.multiTargets} pinable>
        <ul className="issue-list">
          {items.map(({ gid, node, a }) => (
            <li
              key={gid}
              className="issue issue-click"
              onClick={() => {
                selectGeneNode(gid);
                focusGeneNode(gid);
              }}
            >
              <span className="issue-tag">[{DTL_GLYPH[a?.event ?? ''] ?? '·'}]</span>{' '}
              {node!.label || gid.slice(0, 6)} →{' '}
              {a ? project.nodes[a.speciesNode]?.label || '?' : S.recon.tipUnmapped}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={S.recon.multiEvents} pinable>
        <div className="recon-stat-grid">
          <span className="recon-chip">{S.recon.sbUnresolved(unresolved)}</span>
          {eventMix.speciation && <span className="recon-chip chip-sigma">σ {eventMix.speciation}</span>}
          {eventMix.duplication && <span className="recon-chip chip-dup">δ {eventMix.duplication}</span>}
          {eventMix.transfer && <span className="recon-chip chip-transfer">τ {eventMix.transfer}</span>}
        </div>
      </Section>
      <div className="field row-actions" style={{ margin: '8px 12px' }}>
        <button
          className="btn danger"
          onClick={() => {
            requestConfirm({
              key: 'recon-clear-selection',
              title: S.recon.clearMappings,
              message: S.recon.clearMappingsConfirm(items.length),
              confirmLabel: S.recon.clearMappings,
              danger: true,
              onConfirm: () =>
                apply((d) => {
                  const g = d.geneTrees?.find((x) => x.id === entry.id);
                  if (!g) return;
                  for (const gid of geneSelection) {
                    setAssumption(d, entry.id, gid, null);
                  }
                }),
            });
          }}
        >
          {S.recon.clearMappings}
        </button>
      </div>
    </>
  );
}

/** The four-state dispatcher. */
export function ReconInspector({ onBuildGeneTree }: { onBuildGeneTree: () => void }) {
  const geneSelection = useStore((s) => s.geneSelection);
  const selection = useStore((s) => s.selection);

  if (geneSelection.length === 1) {
    return (
      <GeneInspectorWrapper geneNodeId={geneSelection[0]} />
    );
  }
  if (geneSelection.length > 1) return <MultiGeneSummary />;
  if (selection.length === 1) return <SpeciesNodeInspector nodeId={selection[0]} />;
  return <ReconOverview onBuildGeneTree={onBuildGeneTree} />;
}

function GeneInspectorWrapper({ geneNodeId }: { geneNodeId: NodeId }) {
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  if (!activeGeneTreeId) return <ReconInspectorFallback />;
  return <GeneAssumptionInspector geneTreeId={activeGeneTreeId} geneNodeId={geneNodeId} />;
}

function ReconInspectorFallback() {
  return (
    <div className="panel-section">
      <h3>{S.reconInspector.title}</h3>
      <div className="hint">{S.reconInspector.emptyHint}</div>
    </div>
  );
}

