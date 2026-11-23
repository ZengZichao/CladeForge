// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Left panel of the reconciliation workspace — ONE plain stacked panel.
// 用户反馈 (2026-11-16): after the rail was retired the panel carries exactly
// TWO sections, 视图 on top and 节点映射 below: the gene-tree management
// (树库 / 当前基因树), the 演化事件 list, the costs block and the assumption
// search box are gone — the toolbar owns tree picking, and the inspector owns
// everything else. In the tree-edit modes this panel does not mount at all
// (the standard workspace's panels do).

import { useMemo, useState } from 'react';
import { ArrowRightIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import type { ReconEventType } from '../model/types';
import { type ReconIssue } from '../model/reconciliation';
import { geneTreeRows } from './reconStats';
import { Field } from './fields';
import { SwitchField } from './fields';
import { Section } from './Section';
import { S, tr } from './strings';
import { isImeComposing } from './imeGuard';


type ListFilter = 'all' | 'unresolved' | 'errors' | 'internal';

export function ReconPanel() {
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);
  const setReconHoverGene = useStore((s) => s.setReconHoverGene);
  const options = useStore((s) => s.reconViewOptions);
  const setReconViewOptions = useStore((s) => s.setReconViewOptions);

  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const stats = useMemo(() => geneTreeRows(project), [project]);
  const activeEntry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);
  const activeStat = stats.find((r) => r.id === activeGeneTreeId);

  // --- mapping list rows ------------------------------------------------------
  const listRows = useMemo(() => {
    if (!activeEntry) return [];
    const issuesByNode = new Map<string, ReconIssue[]>();
    for (const it of activeStat?.issues ?? []) {
      if (!it.nodeId) continue;
      const arr = issuesByNode.get(it.nodeId) ?? [];
      arr.push(it);
      issuesByNode.set(it.nodeId, arr);
    }
    const rows: {
      gid: string;
      label: string;
      target: string;
      event: ReconEventType | null;
      losses: number;
      unresolved: boolean;
      hasError: boolean;
      internal: boolean;
      /** S07: where the effective mapping came from — shown in the row. */
      mappingSource: 'explicit' | 'auto' | 'none';
    }[] = [];
    for (const n of Object.values(activeEntry.doc.nodes)) {
      const a = activeEntry.assumptions[n.id];
      const internal = n.childrenIds.length > 0;
      const label = n.label || n.id.slice(0, 6);
      // S07 (Sonus): ONE effective-mapping view model — explicit assumption
      // wins, then the label mapping the summary counts.
      const fromAssumption = a?.speciesNode ?? null;
      const fromLabel = internal ? null : (activeStat?.tipMappings[n.id] ?? null);
      const effective = fromAssumption ?? fromLabel;
      const target = effective
        ? project.nodes[effective]?.label || effective.slice(0, 6)
        : '';
      const mappingSource: 'explicit' | 'auto' | 'none' = fromAssumption
        ? 'explicit'
        : fromLabel
          ? 'auto'
          : 'none';
      const rowIssues = issuesByNode.get(n.id) ?? [];
      const hasError = rowIssues.some((i) => i.severity === 'error');
      const unresolved = internal && (!a || !a.event);
      if (listFilter === 'unresolved' && !unresolved) continue;
      if (listFilter === 'errors' && !hasError) continue;
      if (listFilter === 'internal' && !internal) continue;
      rows.push({
        gid: n.id,
        label,
        target,
        event: a?.event ?? null,
        losses: a?.losses ?? 0,
        unresolved,
        hasError,
        internal,
        mappingSource,
      });
    }
    return rows;
  }, [activeEntry, activeStat, project, listFilter]);

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.recon}</span>
      </div>

      {/* ---- 视图 (用户反馈: on top — it configures the canvas the list then
          locates nodes on) ---- */}
      <Section title={S.recon.railView} pinable>
        <Field label={S.recon.scopeLabel}>
          <select
            value={options.mappingScope}
            onChange={(e) => setReconViewOptions({ mappingScope: e.target.value as typeof options.mappingScope })}
          >
            <option value="tips">{S.recon.scopeTips}</option>
            <option value="internal">{S.recon.scopeInternal}</option>
            <option value="all">{S.recon.scopeAll}</option>
          </select>
        </Field>
        <Field label={S.recon.eventFilterLabel}>
          <select
            value={options.eventFilter}
            onChange={(e) => setReconViewOptions({ eventFilter: e.target.value as typeof options.eventFilter })}
          >
            <option value="all">{S.recon.filterAll}</option>
            <option value="speciation">{S.reconInspector.evSpeciation}</option>
            <option value="duplication">{S.reconInspector.evDuplication}</option>
            <option value="transfer">{S.reconInspector.evTransfer}</option>
            <option value="unresolved">{S.recon.filterUnresolved}</option>
          </select>
        </Field>
        <SwitchField
          label={S.recon.showMappings}
          checked={options.showMappings}
          onChange={(v) => setReconViewOptions({ showMappings: v })}
        />
        <SwitchField
          label={S.recon.showLabels}
          checked={options.showLabels}
          onChange={(v) => setReconViewOptions({ showLabels: v })}
        />
        <SwitchField
          label={S.recon.showInternalLabels}
          checked={options.showInternalLabels}
          onChange={(v) => setReconViewOptions({ showInternalLabels: v })}
        />
        <SwitchField
          label={S.recon.showEventGlyphs}
          checked={options.showEventGlyphs}
          onChange={(v) => setReconViewOptions({ showEventGlyphs: v })}
        />
        <SwitchField
          label={S.recon.showLosses}
          checked={options.showLosses}
          onChange={(v) => setReconViewOptions({ showLosses: v })}
        />
        {options.layoutMode === 'embedded' ? (
          <>
            <Field label={S.recon.tubeWidth}>
              <input
                type="range"
                min={10}
                max={32}
                step={1}
                value={options.embeddedTubeWidth}
                onChange={(e) => setReconViewOptions({ embeddedTubeWidth: Number(e.target.value) })}
                aria-label={S.recon.tubeWidth}
              />
            </Field>
            <Field label={S.recon.laneGap}>
              <input
                type="range"
                min={1.5}
                max={6}
                step={0.5}
                value={options.embeddedLaneGap}
                onChange={(e) => setReconViewOptions({ embeddedLaneGap: Number(e.target.value) })}
                aria-label={S.recon.laneGap}
              />
            </Field>
            {/* PhyloRecViewer presentation knobs (用户反馈). */}
            <Field label={S.recon.optTubeOpacity}>
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={Math.round(options.embeddedTubeOpacity * 100)}
                onChange={(e) => setReconViewOptions({ embeddedTubeOpacity: Number(e.target.value) / 100 })}
                aria-label={S.recon.optTubeOpacity}
              />
            </Field>
            <SwitchField
              label={S.recon.optTubeGradient}
              checked={options.embeddedTubeGradient}
              onChange={(v) => setReconViewOptions({ embeddedTubeGradient: v })}
            />
            <SwitchField
              label={S.recon.optFamilyColors}
              checked={options.embeddedFamilyColors}
              onChange={(v) => setReconViewOptions({ embeddedFamilyColors: v })}
            />
            <SwitchField
              label={S.recon.optGeneHalo}
              checked={options.embeddedGeneHalo}
              onChange={(v) => setReconViewOptions({ embeddedGeneHalo: v })}
            />
            <SwitchField
              label={S.recon.showTransfers}
              checked={options.embeddedShowTransfers}
              onChange={(v) => setReconViewOptions({ embeddedShowTransfers: v })}
            />
            <SwitchField
              label={S.recon.showLossStubs}
              checked={options.embeddedShowLossStubs}
              onChange={(v) => setReconViewOptions({ embeddedShowLossStubs: v })}
            />
          </>
        ) : (
          <>
            <SwitchField
              label={S.recon.optTubeStyle}
              checked={options.speciesTubeStyle}
              onChange={(v) => setReconViewOptions({ speciesTubeStyle: v })}
            />
            {options.speciesTubeStyle && (
              <>
                <Field label={S.recon.tubeWidth}>
                  <input
                    type="range"
                    min={4}
                    max={32}
                    step={1}
                    value={options.speciesTubeWidth}
                    onChange={(e) => setReconViewOptions({ speciesTubeWidth: Number(e.target.value) })}
                    aria-label={S.recon.tubeWidth}
                  />
                </Field>
                <Field label={S.recon.optTubeOpacity}>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={5}
                    value={Math.round(options.speciesTubeOpacity * 100)}
                    onChange={(e) => setReconViewOptions({ speciesTubeOpacity: Number(e.target.value) / 100 })}
                    aria-label={S.recon.optTubeOpacity}
                  />
                </Field>
                <SwitchField
                  label={S.recon.optTubeGradient}
                  checked={options.speciesTubeGradient}
                  onChange={(v) => setReconViewOptions({ speciesTubeGradient: v })}
                />
              </>
            )}
            <SwitchField
              label={S.recon.optGeneCurve}
              checked={options.geneCurveStyle}
              onChange={(v) => setReconViewOptions({ geneCurveStyle: v })}
            />
            {options.geneCurveStyle && (
              <>
                <Field label={S.recon.optGeneThickness}>
                  <input
                    type="range"
                    min={0.5}
                    max={8}
                    step={0.5}
                    value={options.geneLineThickness}
                    onChange={(e) => setReconViewOptions({ geneLineThickness: Number(e.target.value) })}
                    aria-label={S.recon.optGeneThickness}
                  />
                </Field>
                <SwitchField
                  label={S.recon.optGeneHalo}
                  checked={options.geneLineHalo}
                  onChange={(v) => setReconViewOptions({ geneLineHalo: v })}
                />
              </>
            )}
            <SwitchField
              label={S.recon.syncZoom}
              checked={options.syncZoom}
              onChange={(v) => setReconViewOptions({ syncZoom: v })}
            />
          </>
        )}
        <div className="field row-actions">
          <button
            className="btn"
            onClick={() => window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'))}
          >
            {options.layoutMode === 'embedded' ? S.recon.fitEmbedded : S.recon.fitBoth}
          </button>
          <button
            className="btn"
            onClick={() => {
              // Reset every view option — but KEEP the current layout mode:
              // a reset must not kick the user out of the nested view.
              setReconViewOptions({
                mappingScope: 'tips',
                eventFilter: 'all',
                showLabels: true,
                showInternalLabels: true,
                showEventGlyphs: true,
                showLosses: true,
                showMappings: true,
                syncZoom: true,
                embeddedTubeWidth: 18,
                embeddedLaneGap: 3,
                embeddedShowTransfers: true,
                embeddedShowLossStubs: true,
                speciesTubeStyle: true,
                speciesTubeWidth: 14,
                speciesTubeOpacity: 1,
                speciesTubeGradient: true,
                geneCurveStyle: true,
                geneLineThickness: 2.5,
                geneLineHalo: true,
                embeddedTubeGradient: true,
                embeddedTubeOpacity: 1,
                embeddedFamilyColors: true,
                embeddedGeneHalo: true,
              });
              window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'));
            }}
          >
            {S.recon.resetBoth}
          </button>
        </div>
      </Section>

      {/* ---- 节点映射 — the text equivalent of the mapping lines. ---- */}
      {activeEntry && activeStat && (
        <Section title={S.recon.nodeMapping} pinable>
          <div className="recon-filter-chips" role="tablist" aria-label={S.recon.nodeMapping}>
            {([
              ['all', S.recon.filterAll],
              ['unresolved', S.recon.filterUnresolved],
              ['errors', S.recon.filterErrors],
              ['internal', S.recon.filterInternal],
            ] as [ListFilter, string][]).map(([id, label]) => (
              <button
                key={id}
                className={`chip-btn${listFilter === id ? ' active' : ''}`}
                onClick={() => setListFilter(id)}
                aria-selected={listFilter === id}
                role="tab"
              >
                {label}
              </button>
            ))}
          </div>
          {listRows.length === 0 ? (
            <div className="hint">{S.recon.noAssumptions}</div>
          ) : (
            <ul className="recon-assumption-list">
              {/* 用户反馈 (2026-11-23): the two node columns line up vertically —
                  gene nodes in the left column, their species targets in the
                  right — so a name in the list can be found on the tree. */}
              <li className="recon-assumption-row recon-assumption-head" aria-hidden="true">
                <span className="recon-row-label">{S.recon.paneGene}</span>
                <span className="recon-row-arrow" />
                <span className="recon-row-target-wrap">
                  <span className="recon-row-target">{S.recon.paneSpecies}</span>
                </span>
              </li>
              {listRows.map((row) => (
                <li
                  key={row.gid}
                  className={`recon-assumption-row${row.unresolved ? ' unresolved' : ''}${row.hasError ? ' has-error' : ''}`}
                  onClick={() => {
                    selectGeneNode(row.gid);
                    focusGeneNode(row.gid);
                  }}
                  onPointerEnter={() => setReconHoverGene(row.gid)}
                  onPointerLeave={() => setReconHoverGene(null)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (isImeComposing(e)) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectGeneNode(row.gid);
                      focusGeneNode(row.gid);
                    }
                  }}
                  title={S.recon.hoverLineHint}
                >
                  <span className="recon-row-label" title={row.label}>{row.label}</span>
                  <span className="recon-row-arrow"><ArrowRightIcon /></span>
                  <span className="recon-row-target-wrap">
                    <span
                      className={`recon-row-target${row.mappingSource === 'auto' ? ' auto' : ''}`}
                      title={
                        row.mappingSource === 'explicit'
                          ? tr('显式假设', 'Explicit assumption')
                          : row.mappingSource === 'auto'
                            ? tr('按名称自动匹配', 'Matched automatically by label')
                            : tr('无匹配', 'No match')
                      }
                    >
                      {row.target || S.recon.tipUnmapped}
                    </span>
                    {/* S07: say WHERE the mapping came from — an auto-matched
                        tip is not "未映射", and an explicit one should not look
                        identical to an automatic one. */}
                    {row.mappingSource === 'auto' && (
                      <span className="recon-row-flag" title={tr('按名称自动匹配', 'Matched automatically by label')}>
                        {tr('自动', 'auto')}
                      </span>
                    )}
                    {row.unresolved && <span className="recon-row-flag">{S.recon.filterUnresolved}</span>}
                    {row.hasError && <span className="recon-row-flag bad">{S.recon.severityError}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );
}
