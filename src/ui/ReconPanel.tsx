// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Left panel of the reconciliation workspace, presented ONE SECTION AT A TIME
// (the rail picks: 树库 / 场景 / 校验 / 视图). In the STANDARD workspace's
// 协调 module the same content renders stacked (`section` undefined) — the
// pre-workspace behaviour, kept intact there.
//
// New capabilities per the 2026-10-31 reconciliation review:
//  - the SCENARIO section carries a searchable, filterable ASSUMPTION LIST
//    (§5.3): click a row to select + centre the gene node, hover to highlight
//    its mapping line — the text equivalent of the lines (§5.6.8);
//  - the VIEW section exposes the transient canvas options (scope, event
//    filter, label/glyph/loss/mapping toggles, sync zoom, fit/reset);
//  - the TREES section offers "载入协调示例" so the demo is reachable from a
//    non-empty document too (§7.4).

import { useMemo, useState } from 'react';
import { ArrowRightIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  clearAssumptions as clearAssumptionsOp,
  makeGeneTreeEntry,
  renameGeneTree,
  setReconCosts,
} from '../model/geneTrees';
import { DEFAULT_RECON_COSTS, type ReconCosts, type ReconSection, type ReconEventType } from '../model/types';
import { type ReconIssue } from '../model/reconciliation';
import { geneTreeRows } from './reconStats';
import { rerootGeneTree } from '../model/geneTrees';
import { RECON_COST_PRESETS } from '../model/types';
import * as file from '../io/fileActions';
import { SAMPLE_PROJECTS } from '../model/sampleTree';
import { openSample } from './sampleOpener';
import { Field, NumberField, TextField } from './fields';
import { CheckboxField } from './fields';
import { Section } from './Section';
import { S, tr } from './strings';
import { notify } from './toast';
import { isImeComposing } from './imeGuard';
import { requestConfirm } from './confirmDialog';


type ListFilter = 'all' | 'unresolved' | 'errors' | 'internal';

export function ReconPanel({
  section,
  onBuildGeneTree,
  onCopySpeciesTree,
  onEditGeneTree,
}: {
  /** Which rail section to show; undefined = legacy stacked layout. */
  section?: ReconSection;
  onBuildGeneTree: () => void;
  onCopySpeciesTree: () => void;
  onEditGeneTree: (id: string) => void;
}) {
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);
  const setReconHoverGene = useStore((s) => s.setReconHoverGene);
  const options = useStore((s) => s.reconViewOptions);
  const setReconViewOptions = useStore((s) => s.setReconViewOptions);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabStore = useStore((s) => s.tabStore);
  // 用户反馈: the DP optimum and the MRCA suggestion are removed from the UI;
  // the model layer keeps them for the gene-tree builder and the tests.

  const [tabChoice, setTabChoice] = useState<string>('');
  const [listQuery, setListQuery] = useState('');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const stats = useMemo(() => geneTreeRows(project), [project]);
  const activeEntry = project.geneTrees?.find((g) => g.id === activeGeneTreeId);
  const activeStat = stats.find((r) => r.id === activeGeneTreeId);

  // Other open tabs offer their documents as gene trees (multi-tab reuse).
  const tabOptions = useMemo(
    () =>
      tabs
        .filter((id) => id !== activeTabId)
        .map((id) => ({ id, name: tabStore[id]?.project.name || tr('未命名', 'Untitled') })),
    [tabs, tabStore, activeTabId],
  );

  // Fallback = the shipped default (1,1,1), not the pre-0.2 (1,2,1) bias: any
  // path that builds a Project without serialization must solve with the same
  // costs the UI advertises (A-09).
  const costs = project.reconCosts ?? DEFAULT_RECON_COSTS;

  /**
   * `setReconCosts` validates the vector and may REFUSE a value (NaN,
   * negative, loss 0, dup === transfer === 0), resetting the affected entries to
   * their defaults. Every call site surfaces its return message, so the user
   * never watches a number snap back with no explanation and then re-runs the DP
   * against costs they never chose.
   */
  const commitCosts = (patch: Partial<ReconCosts>) => {
    const outcome: { message: string | null } = { message: null };
    apply((d) => {
      outcome.message = setReconCosts(d, patch);
    });
    if (outcome.message) {
      notify.error(
        tr(
          `DTL 代价已回退为合法默认值：${outcome.message}`,
          `The DTL costs were reset to legal defaults: ${outcome.message}`,
        ),
      );
    }
  };

  const clearAll = () => {
    if (!activeEntry) return;
    requestConfirm({
      key: 'recon-clear-assumptions',
      title: tr('清空协调假设', 'Clear reconciliation assumptions'),
      message: tr(
        `将移除「${activeEntry.name}」的全部映射与事件假设（可用撤销恢复）。`,
        `This removes every mapping/event assumption of “${activeEntry.name}” (undoable).`,
      ),
      confirmLabel: S.recon.clearAssumptions,
      onConfirm: () => apply((d) => clearAssumptionsOp(d, activeEntry.id)),
    });
  };

  const importFromTab = (id: string) => {
    if (!id) return;
    const snapProject = tabStore[id]?.project;
    if (!snapProject) return;
    const entry = makeGeneTreeEntry(snapProject, snapProject.name);
    apply((d) => {
      if (!d.geneTrees) d.geneTrees = [];
      d.geneTrees.push(entry);
    });
    setActiveGeneTree(entry.id);
    setTabChoice('');
    notify.success(tr('已从标签页导入基因树', 'Gene tree imported from tab'));
  };

  // --- assumption list rows ---------------------------------------------------
  const listRows = useMemo(() => {
    if (!activeEntry) return [];
    const issuesByNode = new Map<string, ReconIssue[]>();
    for (const it of activeStat?.issues ?? []) {
      if (!it.nodeId) continue;
      const arr = issuesByNode.get(it.nodeId) ?? [];
      arr.push(it);
      issuesByNode.set(it.nodeId, arr);
    }
    const q = listQuery.trim().toLowerCase();
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
      // S07 (Sonus): ONE effective-mapping view model — the list previously
      // read only explicit assumptions while the header read label mappings
      // too, so an auto-mapped tip showed "6/6 mapped" in the summary and
      // "未映射" in the list at the same time. Order: explicit assumption
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
      if (q) {
        const hay = `${label} ${target} ${a?.event ?? ''}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
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
  }, [activeEntry, activeStat, project, listQuery, listFilter]);

  // 演化事件 rows: the subset of the filtered list carrying an event or losses.
  const eventRows = useMemo(
    () => listRows.filter((r) => r.event !== null || r.losses > 0),
    [listRows],
  );

  const showTrees = !section || section === 'trees';
  const showScenario = !section || section === 'scenario';
  // 用户反馈: the single plain left panel shows EVERY section stacked —
  // including the view options that used to live behind the 视图 rail item.
  const showView = !section || section === 'view';

  const eventGlyph = (ev: ReconEventType | null) =>
    ev === 'speciation' ? 'S' : ev === 'duplication' ? 'D' : ev === 'transfer' ? 'T' : '–';

  return (
    <>
      {!section && (
        <div className="panel-header">
          <span className="panel-header-title">{S.nav.recon}</span>
                  </div>
      )}

      {/* ---- panel head: identity only. M3 (UI_UX_REVIEW): the counts live in
          the status bar (one authoritative position) — the panel head, the
          inspector overview and the pane headers used to repeat them. ---- */}
      {section && (
        <div className="recon-panel-head">
          <div className="recon-panel-head-title">{S.recon.section}</div>
          <div className="recon-panel-head-sub">
            {activeEntry ? (
              <>
                <span className="recon-panel-gene" title={activeEntry.name}>{activeEntry.name}</span>
                <span className="recon-readonly-tag">{S.recon.readonlyPane}</span>
              </>
            ) : (
              <span>{S.recon.emptyReconTitle}</span>
            )}
          </div>
        </div>
      )}

      {/* ---- 树库 ---- */}
      {showTrees && (
        <Section title={S.recon.railTrees} pinable>
          <div className="recon-action-stack">
            <button className="btn primary" onClick={onBuildGeneTree}>
              <PlusIcon /> {S.recon.buildGeneTree}
            </button>
            <button className="btn" onClick={onCopySpeciesTree}>
              {S.recon.copySpeciesTree}
            </button>
            <div className="recon-action-links">
              {/* 用户反馈: real rounded buttons, not bare text links. */}
              <button className="btn" onClick={() => void file.actionImportGeneTree()}>
                {S.recon.importFile}
              </button>
              <button
                className="btn"
                title={S.recon.loadReconSampleTitle}
                onClick={() => openSample(SAMPLE_PROJECTS.find((d) => d.id === 'recon-family')!)}
              >
                {S.recon.loadReconSample}
              </button>
            </div>
            {tabOptions.length > 0 && (
              <div className="recon-action-tab">
                <select
                  className="recon-action-select"
                  value={tabChoice}
                  title={S.recon.importTab}
                  aria-label={S.recon.importTab}
                  onChange={(e) => {
                    const id = e.target.value;
                    setTabChoice(id);
                    importFromTab(id);
                  }}
                >
                  <option value="">{S.recon.importTab}</option>
                  {tabOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ---- 场景 ---- */}
      {showScenario && activeEntry && activeStat && (
        <>
          <Section title={S.recon.activeGene} pinable>
            <Field label={S.recon.geneTreeName}>
              <TextField
                value={activeEntry.name}
                onCommit={(v) => apply((d) => renameGeneTree(d, activeEntry.id, v))}
              />
            </Field>
            <div className="recon-stat-grid">
              <span className="recon-chip chip-sigma">S {activeStat.summary.speciation}</span>
              <span className="recon-chip chip-dup">D {activeStat.summary.duplication}</span>
              <span className="recon-chip chip-transfer">T {activeStat.summary.transfer}</span>
              <span className="recon-chip chip-loss">L {activeStat.summary.losses}</span>
              <span className="recon-chip">
                {S.recon.mappedCount} {activeStat.summary.mappedInternal}/{activeStat.summary.totalInternal}
              </span>
            </div>

            <div className="recon-action-stack" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => {
                if (useStore.getState().reconEditTarget !== 'gene') {
                  notify.info(tr('请先切换到「基因树编辑」模式（顶部工具栏）', 'Switch to “Edit gene tree” mode first (top toolbar)'));
                  return;
                }
                onEditGeneTree(activeEntry.id);
              }}>
                {S.recon.editTopology}
              </button>
              {/* 用户反馈: the MRCA suggestion and the DP optimum are gone from
                  the panel. */}
              <button
                className="btn"
                title={tr('以选中的基因节点为新根（DTL 结果对根位高度敏感）', 'Re-root on the selected gene node (DTL counts are highly root-sensitive)')}
                onClick={() => {
                  const nodeId = useStore.getState().geneSelection[0];
                  if (!nodeId) {
                    notify.info(tr('请先在基因树面板选中一个节点', 'Select a node in the gene pane first'));
                    return;
                  }
                  let ok = false;
                  apply((d) => {
                    ok = rerootGeneTree(d, activeEntry.id, nodeId, 0.5);
                  });
                  notify.info(
                    ok
                      ? tr('基因树已重新定根：映射按节点 id 保留，请重新校验场景', 'Gene tree re-rooted: mappings were kept by node id — re-validate the scenario')
                      : tr('无法重新定根（目标无效）', 'Cannot re-root (invalid target)'),
                  );
                }}
              >
                {tr('重新定根（选中节点）', 'Re-root (selected node)')}
              </button>
              <button className="btn" onClick={clearAll}>
                <TrashIcon /> {S.recon.clearAssumptions}
              </button>
            </div>
          </Section>

          {/* ---- 节点映射 (用户反馈: split from 映射与事件) — the text
              equivalent of the mapping lines: gene node → species node. ---- */}
          <Section title={S.recon.nodeMapping} pinable>
            <input
              className="cc-search-input recon-list-search"
              value={listQuery}
              placeholder={S.recon.assumptionSearch}
              onChange={(e) => setListQuery(e.target.value)}
              aria-label={S.recon.assumptionSearch}
            />
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
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ---- 演化事件 (用户反馈: split from 映射与事件) — one row per gene
              node carrying an event or losses: glyph + node + event + count. */}
          {eventRows.length > 0 && (
            <Section title={S.recon.eventList} pinable>
              <ul className="recon-assumption-list">
                {eventRows.map((row) => (
                  <li
                    key={`ev-${row.gid}`}
                    className="recon-assumption-row"
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
                    <span className="recon-row-glyph">{eventGlyph(row.event)}</span>
                    <span className="recon-row-label" title={row.label}>{row.label}</span>
                    <span className="recon-row-event-name">
                      {row.event
                        ? row.event === 'speciation'
                          ? tr('物种形成', 'Speciation')
                          : row.event === 'duplication'
                            ? tr('基因重复', 'Duplication')
                            : tr('水平转移', 'Horizontal transfer')
                        : ''}
                    </span>
                    {row.losses > 0 && <span className="recon-row-loss">L{row.losses}</span>}
                    {row.hasError && <span className="recon-row-flag bad">{S.recon.severityError}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {/* ---- 视图 ---- */}
      {showView && (
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
          <CheckboxField
            label={S.recon.showMappings}
            checked={options.showMappings}
            onChange={(v) => setReconViewOptions({ showMappings: v })}
          />
          <CheckboxField
            label={S.recon.showLabels}
            checked={options.showLabels}
            onChange={(v) => setReconViewOptions({ showLabels: v })}
          />
          <CheckboxField
            label={S.recon.showEventGlyphs}
            checked={options.showEventGlyphs}
            onChange={(v) => setReconViewOptions({ showEventGlyphs: v })}
          />
          <CheckboxField
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
              <CheckboxField
                label={S.recon.showTransfers}
                checked={options.embeddedShowTransfers}
                onChange={(v) => setReconViewOptions({ embeddedShowTransfers: v })}
              />
              <CheckboxField
                label={S.recon.showLossStubs}
                checked={options.embeddedShowLossStubs}
                onChange={(v) => setReconViewOptions({ embeddedShowLossStubs: v })}
              />
            </>
          ) : (
            <CheckboxField
              label={S.recon.syncZoom}
              checked={options.syncZoom}
              onChange={(v) => setReconViewOptions({ syncZoom: v })}
            />
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
                  showEventGlyphs: true,
                  showLosses: true,
                  showMappings: true,
                  syncZoom: true,
                  embeddedTubeWidth: 18,
                  embeddedLaneGap: 3,
                  embeddedShowTransfers: true,
                  embeddedShowLossStubs: true,
                });
                window.dispatchEvent(new CustomEvent('cladeforge:recon-fit'));
              }}
            >
              {S.recon.resetBoth}
            </button>
          </div>
        </Section>
      )}

      {/* ---- 代价设置（场景节底部，默认折叠） ---- */}
      {(showScenario || !activeEntry) && (
        <Section title={S.recon.costs} defaultOpen={false} pinable>
          <div className="recon-cost-numbers">
            <Field label={S.recon.costDup}>
              <NumberField
                value={costs.dup}
                min={0}
                step={1}
                onCommit={(v) => v !== undefined && commitCosts({ dup: v })}
              />
            </Field>
            <Field label={S.recon.costTransfer}>
              <NumberField
                value={costs.transfer}
                min={0}
                step={1}
                onCommit={(v) => v !== undefined && commitCosts({ transfer: v })}
              />
            </Field>
            <Field label={S.recon.costLoss}>
              <NumberField
                value={costs.loss}
                min={0}
                step={1}
                onCommit={(v) => v !== undefined && commitCosts({ loss: v })}
              />
            </Field>
          </div>
          <Field label={tr('代价预设', 'Cost presets')}>
            <select
              value=""
              onChange={(e) => {
                const preset = RECON_COST_PRESETS.find((p) => p.id === e.target.value);
                if (!preset) return;
                commitCosts(preset.costs);
                notify.info(
                  tr(
                    `已应用预设「${preset.label}」（D=${preset.costs.dup}, T=${preset.costs.transfer}, L=${preset.costs.loss}）。基因转移代价低时 HGT 更容易被采纳；默认等价代价（1, 1, 1）取代了旧的 transfer=2 偏置`,
                    `Applied preset "${preset.labelEn}" (D=${preset.costs.dup}, T=${preset.costs.transfer}, L=${preset.costs.loss}). Cheap transfers make HGT easier to adopt; the default is now the unbiased unit vector (1,1,1)`,
                  ),
                );
              }}
            >
              <option value="">{tr('选择预设…', 'Pick a preset…')}</option>
              {RECON_COST_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {tr(p.label, p.labelEn)}
                </option>
              ))}
            </select>
          </Field>
          {/* The comparability statement moved next to the DP numbers it
              qualifies (A-17): inside this collapsed section it never met the
              "DP optimal cost" chip it is a scope declaration FOR. */}
        </Section>
      )}
    </>
  );
}
