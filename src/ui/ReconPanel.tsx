// Left "协同 Reconcile" module: gene-tree / species-tree DTL reconciliation.
//
// v1 covers the document workflow: import or reuse gene trees, pick the active
// one, review per-gene statistics and validation issues, generate an LCA-based
// suggestion, clear assumptions, and tune the DTL cost vector used by the DP
// solver (the solver itself is driven from here too once a binary gene tree is
// available). Assumption edits live in the right-hand inspector while the
// canvas shows the side-by-side reconciliation view.

import { useMemo, useState } from 'react';
import { Cross1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { useStore } from '../model/store';
import {
  addGeneTree,
  clearAssumptions as clearAssumptionsOp,
  removeGeneTree,
  renameGeneTree,
  setReconCosts,
} from '../model/geneTrees';
import { makeGeneTreeEntry } from '../model/geneTrees';
import type { Project, ReconCosts } from '../model/types';
import { mapTipsByLabel, scenarioSummary, suggestLcaScenario, validateScenario, type ReconIssue } from '../model/reconciliation';
import { geneTreeRows } from './reconStats';
import { solveDtl, dtlScenarioToAssumptions, type DtlScenario } from '../model/dtl';
import * as file from '../io/fileActions';
import { Field, NumberField, TextField } from './fields';
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
      return tr('未解析', 'Unresolved');
    case 'dangling':
      return tr('悬空', 'Dangling');
    case 'event-conflict':
      return tr('冲突', 'Conflict');
    case 'mislabelled':
      return tr('可疑标记', 'Mislabelled');
    case 'loss-shortfall':
      return tr('损失不足', 'Loss shortfall');
    case 'timing':
      return tr('时序', 'Timing');
    case 'tip-on-internal':
      return tr('尖端居祖先', 'Tip on ancestor');
    case 'leaf-event':
      return tr('尖端事件', 'Leaf event');
    default:
      return '?';
  }
}

export function ReconPanel() {
  // Individual selectors, not `const st = useStore()`. A store
  // subscription without a selector re-renders this panel on EVERY state change —
  // including `view` (pan / zoom), which forces the per-gene `mapTipsByLabel` +
  // `scenarioSummary` + `validateScenario` sweep to re-run while the user is
  // simply moving the canvas.
  const apply = useStore((s) => s.apply);
  const project = useStore((s) => s.project);
  const activeGeneTreeId = useStore((s) => s.activeGeneTreeId);
  const setActiveGeneTree = useStore((s) => s.setActiveGeneTree);
  const setReconMode = useStore((s) => s.setReconMode);
  const selectGeneNode = useStore((s) => s.selectGeneNode);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const tabStore = useStore((s) => s.tabStore);
  /** Last DP run for the ACTIVE gene tree (id guarded) — transient, per panel. */
  const [dp, setDp] = useState<{ geneId: string; scenario: DtlScenario } | null>(null);

  const [tabChoice, setTabChoice] = useState<string>('');
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

  const costs = project.reconCosts ?? { dup: 1, transfer: 2, loss: 1 };

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
      message: tr(`将移除基因树「${name}」。`, `Remove gene tree "${name}".`),
      confirmLabel: S.recon.remove,
      danger: true,
      onConfirm: () => {
        apply((d) => removeGeneTree(d, id));
        if (activeGeneTreeId === id) {
          const rest = project.geneTrees?.find((g) => g.id !== id);
          setActiveGeneTree(rest?.id ?? null);
        }
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

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.recon}</span>
        <span className="panel-header-subtitle">{S.recon.section}</span>
      </div>

      <Section title={S.recon.geneTrees} pinable>
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
                title={tr(`${row.errors} 错误 / ${row.warnings} 提示`, `${row.errors} error(s) / ${row.warnings} note(s)`)}
              >
                {row.errors > 0 ? row.errors : row.warnings > 0 ? row.warnings : '✓'}
              </span>
              <span className="gene-meta">
                {tr(`${row.mappedTips}/${row.tips}`, `${row.mappedTips}/${row.tips}`)}
              </span>
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

        <div className="field row-actions">
          <button className="btn primary" onClick={() => void file.actionImportGeneTree()}>
            <PlusIcon /> {S.recon.importFile}
          </button>
        </div>
        {tabOptions.length > 0 && (
          <div className="field row-actions">
            <select value={tabChoice} onChange={(e) => setTabChoice(e.target.value)}>
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
          </div>
        )}
      </Section>

      {activeEntry && activeStat && (
        <>
          <Section title={S.recon.activeGene} pinable>
            <Field label={S.recon.rename}>
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

            <div className="field row-actions-spread" style={{ marginTop: 8 }}>
              <div className="actions-group">
                <button className="btn primary" onClick={runLcaSuggestion}>
                  {S.recon.suggestLca}
                </button>
                <button
                  className="btn"
                  title={tr('动态规划计算最优协同场景', 'Dynamic-programming optimum')}
                  onClick={() => {
                    const r = solveDtl(project, activeEntry.doc, costs);
                    if (r.error || !r.scenario) {
                      notify.info(r.error ?? tr('求解失败', 'Solver failed'));
                      setDp(null);
                      return;
                    }
                    setDp({ geneId: activeEntry.id, scenario: r.scenario });
                  }}
                >
                  {S.recon.dpRun}
                </button>
                <button className="btn" onClick={clearAll}>
                  <TrashIcon /> {S.recon.clearAssumptions}
                </button>
              </div>
            </div>

            {dp && dp.geneId === activeEntry.id && (
              <div className="recon-stat-grid" style={{ marginTop: 8 }}>
                <span className="recon-chip">
                  {S.recon.dpCurrent} {scenarioSummary(activeEntry.doc, activeEntry.assumptions, costs).cost}
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

          <Section title={S.recon.validation} pinable>
            {activeStat.issues.length === 0 ? (
              <div className="hint">✓ {S.recon.noIssues}</div>
            ) : (
              <>
                <div className="hint">
                  {tr(
                    `${activeStat.errors} 错误 / ${activeStat.warnings} 提示 · ${S.recon.issuesTitle}`,
                    `${activeStat.errors} error(s) / ${activeStat.warnings} note(s) · ${S.recon.issuesTitle}`,
                  )}
                </div>
                <ul className="issue-list">
                  {activeStat.issues.map((it, i) => (
                    <li
                      key={i}
                      className={`issue issue-${it.severity}${it.nodeId ? ' issue-click' : ''}`}
                      onClick={() => {
                        if (it.nodeId) {
                          // Jump straight into the reconciliation view, focused
                          // on the offending node.
                          setActiveGeneTree(activeEntry.id);
                          setReconMode(true);
                          selectGeneNode(it.nodeId);
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
        </>
      )}

      <Section title={S.recon.costs} defaultOpen={false} pinable>
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
      </Section>
    </>
  );
}
