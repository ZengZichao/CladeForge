// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Left panel of the reconciliation workspace, presented ONE SECTION AT A TIME
// (the rail picks: 树库 / 场景 / 校验 / 视图). In the STANDARD workspace's
// 协同 module the same content renders stacked (`section` undefined) — the
// pre-workspace behaviour, kept intact there.
//
// New capabilities per the 2026-10-31 reconciliation review:
//  - the SCENARIO section carries a searchable, filterable ASSUMPTION LIST
//    (§5.3): click a row to select + centre the gene node, hover to highlight
//    its mapping line — the text equivalent of the lines (§5.6.8);
//  - the VIEW section exposes the transient canvas options (scope, event
//    filter, label/glyph/loss/mapping toggles, sync zoom, fit/reset);
//  - the TREES section offers "载入协同示例" so the demo is reachable from a
//    non-empty document too (§7.4).

import { useMemo, useState } from 'react';
import { Cross1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  clearAssumptions as clearAssumptionsOp,
  makeGeneTreeEntry,
  removeGeneTree,
  renameGeneTree,
  setReconCosts,
} from '../model/geneTrees';
import { DEFAULT_RECON_COSTS, type ReconCosts, type ReconSection, type ReconEventType } from '../model/types';
import { mapTipsByLabel, suggestLcaScenario, type ReconIssue } from '../model/reconciliation';
import { geneTreeRows } from './reconStats';
import { dtlScenarioToAssumptions, type DtlScenario } from '../model/dtl';
import { rerootGeneTree } from '../model/geneTrees';
import { solveDtlWithPolytomiesAsync } from '../model/dtlAsync';
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

function issueTagText(issue: ReconIssue): string {
  switch (issue.kind) {
    case 'unmatched-tip':
      return tr('未匹配', 'Unmatched');
    case 'unresolved':
      return tr('未映射', 'Unmapped');
    case 'dangling':
      return tr('悬空', 'Dangling');
    case 'event-conflict':
      return tr('冲突', 'Conflict');
    case 'mislabelled':
      return tr('可疑标记', 'Mislabelled');
    case 'loss-shortfall':
      // PM-44: the literal calque "损失不足" is readable only by the author.
      // Say what the validator actually observed, and let the tooltip carry
      // the technical term for those who want it.
      return tr('丢失事件少于路径要求', 'Fewer losses than the path requires');
    case 'timing':
      return tr('时序', 'Timing');
    case 'tip-on-internal':
      // PM-44: "尖端居祖先" asserts that a sampled tip sits at an ancestral
      // species node — express it as the claim it is, tooltip keeps the term.
      return tr('末端被映射到祖先节点', 'Tip mapped onto an ancestral node');
    case 'leaf-event':
      return tr('末端事件', 'Tip event');
    default:
      return '?';
  }
}

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
  const setReconMode = useStore((s) => s.setReconMode);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const focusGeneNode = useStore((s) => s.focusGeneNode);
  const setReconHoverGene = useStore((s) => s.setReconHoverGene);
  const options = useStore((s) => s.reconViewOptions);
  const setReconViewOptions = useStore((s) => s.setReconViewOptions);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabStore = useStore((s) => s.tabStore);
  /** Last DP run for the ACTIVE gene tree (id guarded) — transient, per panel. */
  const [dp, setDp] = useState<{ geneId: string; scenario: DtlScenario } | null>(null);
  /** True while the DTL worker is solving; the button is disabled meanwhile. */
  const [solving, setSolving] = useState(false);

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

  const runLcaSuggestion = () => {
    if (!activeEntry) return;
    apply((d) => {
      const g = d.geneTrees?.find((x) => x.id === activeEntry.id);
      if (!g) return;
      const tipMap = mapTipsByLabel(d, g.doc).mappings;
      g.assumptions = suggestLcaScenario(d, g.doc, tipMap, g.assumptions);
    });
    notify.success(tr('已生成 LCA 建议场景', 'LCA suggestion applied'));
  };

  /**
   * Polytomy sweep: random binary resolutions × replicates. The pure solver
   * runs on the DTL worker, so the window stays responsive even on large
   * families; a result computed against a document that has since changed is
   * discarded instead of being applied to a tree the user no longer sees.
   */
  const runPolytomyDp = async () => {
    if (!activeEntry || solving) return;
    const entryId = activeEntry.id;
    const doc = project;
    const geneDoc = activeEntry.doc;
    const polytomies = Object.values(geneDoc.nodes).filter((n) => n.childrenIds.length > 2).length;
    setSolving(true);
    try {
      const r = await solveDtlWithPolytomiesAsync(doc, geneDoc, costs, undefined, {}, 8);
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
      if (polytomies > 0 && r.polytomySummary) {
        const c = r.polytomySummary.counts;
        notify.info(
          tr(
            `${polytomies} 处多歧枝已随机解析 ×${r.polytomySummary.replicates} 次重复：σ ${c.speciation.min}–${c.speciation.max}，δ ${c.duplication.min}–${c.duplication.max}，τ ${c.transfer.min}–${c.transfer.max}，λ ${c.losses.min}–${c.losses.max}${r.polytomySummary.sensitive ? '（计数随解析方式变化——结论对解析敏感）' : ''}`,
            `${polytomies} polytom${polytomies === 1 ? 'y' : 'ies'} randomly resolved ×${r.polytomySummary.replicates} replicate${r.polytomySummary.replicates === 1 ? '' : 's'}: σ ${c.speciation.min}–${c.speciation.max}, δ ${c.duplication.min}–${c.duplication.max}, τ ${c.transfer.min}–${c.transfer.max}, λ ${c.losses.min}–${c.losses.max}${r.polytomySummary.sensitive ? ' (counts vary with the resolution — the answer is resolution-sensitive)' : ''}`,
          ),
        );
      }
    } finally {
      setSolving(false);
    }
  };

  const clearAll = () => {
    if (!activeEntry) return;
    requestConfirm({
      key: 'recon-clear-assumptions',
      title: tr('清空协同假设', 'Clear reconciliation assumptions'),
      message: tr(
        `将移除「${activeEntry.name}」的全部映射与事件假设（可用撤销恢复）。`,
        `This removes every mapping/event assumption of "${activeEntry.name}" (undoable).`,
      ),
      confirmLabel: S.recon.clearAssumptions,
      onConfirm: () => apply((d) => clearAssumptionsOp(d, activeEntry.id)),
    });
  };

  const removeOne = (id: string) => {
    const name = project.geneTrees?.find((g) => g.id === id)?.name ?? '';
    requestConfirm({
      key: 'recon-remove-gene',
      title: S.recon.remove,
      message: tr(`将删除基因树「${name}」。`, `Delete gene tree "${name}".`),
      confirmLabel: S.recon.remove,
      danger: true,
      onConfirm: () => {
        apply((d) => removeGeneTree(d, id));
      },
    });
  };

  const importFromTab = () => {
    if (!tabChoice) return;
    const snapProject = tabStore[tabChoice]?.project;
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
    }[] = [];
    for (const n of Object.values(activeEntry.doc.nodes)) {
      const a = activeEntry.assumptions[n.id];
      const internal = n.childrenIds.length > 0;
      const label = n.label || n.id.slice(0, 6);
      const target = a?.speciesNode
        ? project.nodes[a.speciesNode]?.label || a.speciesNode.slice(0, 6)
        : '';
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
      });
    }
    return rows;
  }, [activeEntry, activeStat, project, listQuery, listFilter]);

  const showTrees = !section || section === 'trees';
  const showScenario = !section || section === 'scenario';
  const showValidation = !section || section === 'validation';
  const showView = section === 'view';

  const eventGlyph = (ev: ReconEventType | null) =>
    ev === 'speciation' ? 'σ' : ev === 'duplication' ? 'δ' : ev === 'transfer' ? 'τ' : '·';

  return (
    <>
      {!section && (
        <div className="panel-header">
          <span className="panel-header-title">{S.nav.recon}</span>
          <span className="panel-header-subtitle">{S.recon.section}</span>
        </div>
      )}

      {/* ---- panel head: always-visible identity + completeness (§5.3) ---- */}
      {section && (
        <div className="recon-panel-head">
          <div className="recon-panel-head-title">{S.recon.section}</div>
          <div className="recon-panel-head-sub">
            {activeEntry ? (
              <>
                <span className="recon-panel-gene" title={activeEntry.name}>{activeEntry.name}</span>
                <span className="recon-readonly-tag">{S.recon.readonlyPane}</span>
                {activeStat && (
                  <span>
                    {S.recon.sbTipsMapped(activeStat.mappedTips, activeStat.tips)} ·{' '}
                    {S.recon.sbInternal(activeStat.summary.mappedInternal, activeStat.summary.totalInternal)}
                  </span>
                )}
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
          {(project.geneTrees ?? []).length === 0 && (
            <div className="hint">{S.recon.empty}</div>
          )}
          <div className="gene-list">
            {stats.map((row) => (
              <div
                key={row.id}
                className={`gene-row${row.id === activeGeneTreeId ? ' active' : ''}`}
                onClick={() => setActiveGeneTree(row.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  // Enter on a focused row activates that gene tree — a
                  // composition keystroke must not switch documents.
                  if (isImeComposing(e)) return;
                  if (e.key === 'Enter') setActiveGeneTree(row.id);
                }}
              >
                <span className="gene-name" title={row.name}>
                  {row.name}
                </span>
                <span
                  className={`issue-badge${row.errors > 0 ? ' bad' : row.warnings > 0 ? ' warn' : ''}`}
                  title={tr(`${row.errors} 错误 / ${row.warnings} 提示`, `${row.errors} error${row.errors === 1 ? '' : 's'} / ${row.warnings} note${row.warnings === 1 ? '' : 's'}`)}
                >
                  {row.errors > 0 ? row.errors : row.warnings > 0 ? row.warnings : '✓'}
                </span>
                <span className="gene-meta">
                  {tr(`${row.mappedTips}/${row.tips}`, `${row.mappedTips}/${row.tips}`)}
                </span>
                <button
                  className="btn icon tiny"
                  title={S.recon.enterView}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveGeneTree(row.id);
                    setReconMode(true);
                  }}
                >
                  {S.recon.sampleBadge}
                </button>
                <button
                  className="btn icon danger"
                  title={S.recon.remove}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeOne(row.id);
                  }}
                >
                  <Cross1Icon />
                </button>
              </div>
            ))}
          </div>

          <div className="recon-action-stack">
            <button className="btn primary" onClick={onBuildGeneTree}>
              <PlusIcon /> {S.recon.buildGeneTree}
            </button>
            <button className="btn" onClick={onCopySpeciesTree}>
              {S.recon.copySpeciesTree}
            </button>
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
            {tabOptions.length > 0 && (
              <>
                <select
                  className="recon-action-select"
                  value={tabChoice}
                  onChange={(e) => setTabChoice(e.target.value)}
                >
                  <option value="">{S.recon.importTab}</option>
                  {tabOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button className="btn" disabled={!tabChoice} onClick={importFromTab}>
                  {S.recon.importTab}
                </button>
              </>
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
              <span className="recon-chip chip-sigma">σ {activeStat.summary.speciation}</span>
              <span className="recon-chip chip-dup">δ {activeStat.summary.duplication}</span>
              <span className="recon-chip chip-transfer">τ {activeStat.summary.transfer}</span>
              <span className="recon-chip chip-loss">λ {activeStat.summary.losses}</span>
              <span className="recon-chip">
                {S.recon.mappedCount} {activeStat.summary.mappedInternal}/{activeStat.summary.totalInternal}
              </span>
            </div>

            <div className="recon-action-stack" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => onEditGeneTree(activeEntry.id)}>
                {S.recon.editTopology}
              </button>
              <button className="btn primary" onClick={runLcaSuggestion}>
                {S.recon.suggestLca}
              </button>
              <button
                className="btn"
                title={tr('把每处多歧枝随机二叉化为多次求解（报告计数散布）', 'Randomly binary-resolve each polytomy across replicates (reports the count spread)')}
                onClick={() => void runPolytomyDp()}
                disabled={solving}
              >
                {solving ? tr('求解中…', 'Solving…') : S.recon.dpRun}
              </button>
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

            {dp && dp.geneId === activeEntry.id && (
              <>
                <div className="recon-stat-grid" style={{ marginTop: 8 }}>
                  <span className="recon-chip">
                    {S.recon.dpCurrent} {activeStat.summary.cost}
                  </span>
                  <span className="recon-chip chip-sigma">
                    {S.recon.dpOptimal} {dp.scenario.cost}
                  </span>
                  <button
                    className="btn"
                    onClick={() => {
                      apply((d) => {
                        const g = d.geneTrees?.find((x) => x.id === activeEntry.id);
                        if (!g) return;
                        // Keep the visual path fields (branchFraction /
                        // transferDonor) of nodes whose target is unchanged.
                        g.assumptions = dtlScenarioToAssumptions(d, g.doc, dp.scenario, g.assumptions);
                      });
                      notify.success(S.recon.dpApply);
                    }}
                  >
                    {S.recon.dpApply}
                  </button>
                </div>
                {/* The honesty strings the model already computes, rendered NEXT
                    to the numbers they qualify (A-17): without them, "k equally
                    optimal scenarios" and the free-root subsidy are invisible —
                    the displayed event classes read as THE answer. */}
                <div className="hint" style={{ marginTop: 6 }}>{S.recon.dpInvariant}</div>
                {dp.scenario.ambiguous.length > 0 && (
                  <div className="hint">{S.recon.dpAmbiguousNodes(dp.scenario.ambiguous.length)}</div>
                )}
                {dp.scenario.rootFees > 0 && (
                  <div className="hint">{S.recon.dpFreeRoot(dp.scenario.rootFees)}</div>
                )}
                <div className="hint">{S.recon.dpComparability}</div>
              </>
            )}
          </Section>

          {/* ---- assumption list: the text equivalent of the mapping lines ---- */}
          <Section title={S.recon.assumptionList} pinable>
            <input
              className="cc-search-input recon-list-search"
              value={listQuery}
              placeholder={S.recon.assumptionSearch}
              onChange={(e) => setListQuery(e.target.value)}
              aria-label={S.recon.assumptionSearch}
            />
            <div className="recon-filter-chips" role="tablist" aria-label={S.recon.assumptionList}>
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
                    <span className="recon-row-glyph">{eventGlyph(row.event)}</span>
                    <span className="recon-row-label" title={row.label}>{row.label}</span>
                    <span className="recon-row-arrow">→</span>
                    <span className="recon-row-target" title={row.target}>
                      {row.target || S.recon.tipUnmapped}
                    </span>
                    {row.losses > 0 && <span className="recon-row-loss">λ{row.losses}</span>}
                    {row.unresolved && <span className="recon-row-flag">{S.recon.filterUnresolved}</span>}
                    {row.hasError && <span className="recon-row-flag bad">{S.recon.severityError}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {/* ---- 校验 ---- */}
      {showValidation && activeEntry && activeStat && (
        <Section title={S.recon.validation} pinable>
          {activeStat.issues.length === 0 ? (
            <div className="hint">✓ {S.recon.noIssues}</div>
          ) : (
            <>
              <div className="hint">
                {tr(
                  `${activeStat.errors} 错误 / ${activeStat.warnings} 提示 · ${S.recon.issuesTitle}`,
                  `${activeStat.errors} error${activeStat.errors === 1 ? '' : 's'} / ${activeStat.warnings} note${activeStat.warnings === 1 ? '' : 's'} · ${S.recon.issuesTitle}`,
                )}
              </div>
              <ul className="issue-list">
                {activeStat.issues.map((it, i) => (
                  <li
                    key={i}
                    className={`issue issue-${it.severity}${it.nodeId ? ' issue-click' : ''}`}
                    onClick={() => {
                      if (it.nodeId) {
                        // Stay IN the reconciliation workspace: select + centre
                        // the offending gene node instead of hopping modes.
                        setActiveGeneTree(activeEntry.id);
                        selectGeneNode(it.nodeId);
                        focusGeneNode(it.nodeId);
                      }
                    }}
                  >
                    <span className="issue-tag">[{issueTagText(it)}]</span> {it.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
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
                    `已应用预设「${preset.label}」（δ=${preset.costs.dup}, τ=${preset.costs.transfer}, λ=${preset.costs.loss}）。水平转移代价低时 HGT 更容易被采纳；默认等价代价（1, 1, 1）取代了旧的 transfer=2 偏置`,
                    `Applied preset "${preset.labelEn}" (δ=${preset.costs.dup}, τ=${preset.costs.transfer}, λ=${preset.costs.loss}). Cheap transfers make HGT easier to adopt; the default is now the unbiased unit vector (1,1,1)`,
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
