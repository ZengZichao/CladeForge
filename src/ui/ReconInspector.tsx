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

import { useMemo } from 'react';
import { useStore } from '../model/store';
import { type NodeId } from '../model/types';
import { type ReconIssue } from '../model/reconciliation';
import { geneTreeRows } from './reconStats';
import { setAssumption } from '../model/geneTrees';
import { GeneAssumptionInspector } from './GeneAssumptionInspector';
import { Section } from './Section';
import { requestConfirm } from './confirmDialog';
import { notify } from './toast';
import { S, tr } from './strings';

const DTL_GLYPH: Record<string, string> = {
  speciation: 'S',
  duplication: 'D',
  transfer: 'T',
};

/** A. nothing selected — the scenario overview (default). */
function ReconOverview() {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);
  const entry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);
  const rows = useMemo(() => geneTreeRows(project), [project]);
  const row = rows.find((r) => r.id === activeGeneTreeId);

  if (!entry || !row) {
    return (
      <>
        <div className="panel-header">
          <span className="panel-header-title">{S.recon.overviewTitle}</span>
        </div>
        <div className="inspector-empty">
          <div className="inspector-empty-title">{S.recon.emptyReconTitle}</div>
        </div>
      </>
    );
  }

  const topIssues = row.issues.slice(0, 3);

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.recon.overviewTitle}</span>
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
        </div>
        <div className="recon-stat-grid">
          <span className="recon-chip chip-sigma">S {row.summary.speciation}</span>
          <span className="recon-chip chip-dup">D {row.summary.duplication}</span>
          <span className="recon-chip chip-transfer">T {row.summary.transfer}</span>
          <span className="recon-chip chip-loss">L {row.summary.losses}</span>
          <span className="recon-chip">{tr('总代价', 'total cost')} {row.summary.cost}</span>
        </div>
      </Section>

      <Section title={S.recon.dataQuality} pinable>
        <div className="hint">{S.recon.sbIssues(row.errors, row.warnings)}</div>
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

      <LegendBlock />
    </>
  );
}

/** The mapping-line colour language, spelled out where the user reads. */
export function LegendBlock() {
  return (
    <div className="recon-insp-legend">
      <div className="recon-insp-legend-title">{S.recon.legendTitle}</div>
      <span className="recon-legend-item"><span className="recon-legend-swatch sw-sigma" />{S.recon.legendSigma}</span>
      <span className="recon-legend-item"><span className="recon-legend-swatch sw-dup" />{S.recon.legendDup}</span>
      <span className="recon-legend-item"><span className="recon-legend-swatch sw-transfer" />{S.recon.legendTransfer}</span>
      <span className="recon-legend-item"><span className="recon-legend-swatch sw-unresolved" />{S.recon.legendUnresolved}</span>
      <span className="recon-legend-item"><span className="recon-legend-swatch sw-tip" />{S.recon.legendTipLine}</span>
      <span className="recon-legend-item"><span className="recon-legend-swatch sw-internal" />{S.recon.legendInternalLine}</span>
      <span className="recon-legend-item"><span className="recon-legend-swatch sw-loss" />{S.recon.legendLoss}</span>
    </div>
  );
}

/** C. one species node selected. */
function SpeciesNodeInspector({ nodeId }: { nodeId: NodeId }) {
  const project = useStore((s) => s.project);
  const apply = useStore((s) => s.apply);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const geneSelection = useStore((s) => s.geneSelection);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);
  const setReconClickTarget = useStore((s) => s.setReconClickTarget);

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
                <span className="issue-tag">[{DTL_GLYPH[a.event ?? ''] ?? '–'}]</span>{' '}
                {gNode.label || gid.slice(0, 6)}
                {a.losses ? ` L${a.losses}` : ''}
              </li>
            ))}
          </ul>
        )}
        <div className="field row-actions">
          {/* 用户反馈: never a disabled button with a cryptic refusal — with
              no gene node selected, ONE click switches the canvas to
              gene-clicking and says exactly what to do next. */}
          <button
            className="btn"
            title={S.recon.mapSelectedHere}
            onClick={() => {
              if (!geneSelected || !entry) {
                setReconClickTarget('gene');
                notify.info(S.recon.mapHereSwitchHint);
                return;
              }
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
      </Section>
    </>
  );
}

/** D. several gene nodes selected — batch summary. */
function MultiGeneSummary() {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const apply = useStore((s) => s.apply);
  const geneSelection = useStore((s) => s.geneSelection);
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
              <span className="issue-tag">[{DTL_GLYPH[a?.event ?? ''] ?? '–'}]</span>{' '}
              {node!.label || gid.slice(0, 6)} →{' '}
              {a ? project.nodes[a.speciesNode]?.label || '?' : S.recon.tipUnmapped}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={S.recon.multiEvents} pinable>
        <div className="recon-stat-grid">
          <span className="recon-chip">{S.recon.sbUnresolved(unresolved)}</span>
          {eventMix.speciation && <span className="recon-chip chip-sigma">S {eventMix.speciation}</span>}
          {eventMix.duplication && <span className="recon-chip chip-dup">D {eventMix.duplication}</span>}
          {eventMix.transfer && <span className="recon-chip chip-transfer">T {eventMix.transfer}</span>}
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
export function ReconInspector() {
  const geneSelection = useStore((s) => s.geneSelection);
  const selection = useStore((s) => s.selection);

  if (geneSelection.length === 1) {
    return (
      <GeneInspectorWrapper geneNodeId={geneSelection[0]} />
    );
  }
  if (geneSelection.length > 1) return <MultiGeneSummary />;
  if (selection.length === 1) return <SpeciesNodeInspector nodeId={selection[0]} />;
  return <ReconOverview />;
}

function GeneInspectorWrapper({ geneNodeId }: { geneNodeId: NodeId }) {
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  if (!activeGeneTreeId) return <ReconInspectorFallback />;
  return <GeneAssumptionInspector geneTreeId={activeGeneTreeId} geneNodeId={geneNodeId} />;
}

function ReconInspectorFallback() {
  return (
    <div className="inspector-empty">
      <div className="inspector-empty-title">{S.reconInspector.title}</div>
      <div className="inspector-empty-hint">{S.reconInspector.emptyHint}</div>
    </div>
  );
}

