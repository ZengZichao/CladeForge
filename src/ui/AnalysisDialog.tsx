// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Inference-assist dialog: parsimony ancestral-state suggestions, hypothesis
// consistency checks and character-correlation hints for one character.
//
// Everything here is advisory. Parsimony offers a reference baseline the user
// can apply as suggestions (then review per-node); the checks and correlations
// are prompts, not verdicts. Statistics are named exactly as the model computes
// them and carry their scope statement next to the number: the correlation
// metric is a Jaccard overlap ratio (descriptive), Blomberg's K is a point
// estimate without a significance test, and CI/RI exist only for equally
// weighted characters.
//
// Every number on this dialog is CONDITIONAL ON THE SINGLE USER-EDITED
// TOPOLOGY. That statement used to live in code comments and the manual —
// places users never see — and now it is the first line of the dialog itself.
//
// The heavy statistics only run while the dialog is OPEN (the useMemos check
// `open` first): the dialog used to stay mounted with all of its per-edit
// recomputation live even when closed, which made every keystroke pay for a
// statistics pass nobody was reading.

import { useMemo, useRef, useState } from 'react';
import { useStore } from '../model/store';
import { findCharacter, isObservedState } from '../model/characters';
import { parsimony } from '../model/parsimony';
import type { AsrWarning } from '../model/asr';
import {
  benjaminiHochberg,
  blombergK,
  blombergKBlockReason,
  blombergKNullTest,
  ciRiApplies,
  communityPhyloStats,
  discreteSignal,
  faithPd,
  fritzPurvisD,
  rootToTipRegression,
  treeSummary,
  yuleBalanceZScores,
  type BalanceZScores,
  type CommunityPhyloStats,
  type RootToTipRegression,
} from '../model/stats';
import { sampleMprBranchRates } from '../model/parsimony';
import { sampleStochasticMap } from '../model/asr';
import { DEFAULT_PERMUTATION_SEED } from '../model/consistency';
import {
  characterCorrelations,
  characterCorrelationTests,
  checkConsistency,
  type AdjustedCorrelationTest,
} from '../model/consistency';
import { requestConfirm } from './confirmDialog';
import { saveText } from '../io/fileService';
import { notify } from './toast';
import { APP_VERSION, type AnalysisResult } from '../model/types';
import { fillParsimony, newId } from '../model/treeOps';
import type { Project } from '../model/types';
import { useDialogFocus } from './useDialogFocus';
import { RangeField } from './fields';
import { S, tr } from './strings';

/** Locale-aware name of one Mk degradation class. */
function asrWarningLabel(kind: AsrWarning['kind']): string {
  switch (kind) {
    case 'unset-branch-length':
      return S.analysis.asrWarnUnset;
    case 'zero-branch-length':
      return S.analysis.asrWarnZero;
    case 'negative-branch-length':
      return S.analysis.asrWarnNegative;
    case 'invalid-branch-length':
      return S.analysis.asrWarnInvalid;
    case 'posterior-collapse':
      return S.analysis.asrWarnCollapse;
    case 'missing-branch-lengths-refused':
      return tr('缺失枝长过多，重建被拒绝', 'too many missing branch lengths; reconstruction refused');
    case 'no-usable-observations':
      return tr('可用观测不足，重建被拒绝', 'too few usable observations; reconstruction refused');
    case 'flat-rate-profile':
      return tr('速率剖面平坦，重建被拒绝', 'flat rate profile; reconstruction refused');
    default:
      return kind;
  }
}

/** Benjamini–Hochberg-adjusted p for the family, read out at one index. */
function bhAdjust(pValues: number[], index: number): number | null {
  const adjusted = benjaminiHochberg(pValues);
  return adjusted[index] ?? null;
}

/** A profile-likelihood CI bound: non-finite means the interval left the bracket. */
function asrCiBound(v: number): string {
  // `10 ** NaN` keeps an undetermined endpoint non-finite; printing it as a
  // number would be the fabricated-precision trap the model layer refuses.
  return Number.isFinite(v) ? v.toPrecision(3) : tr('不可定', 'undetermined');
}

/** Stable fingerprint of the inputs a correlation run depended on. */
function familyFingerprint(project: Project): string {
  const chars = project.characters
    .filter((c) => c.type === 'discrete')
    .map((c) => `${c.id}:${c.states.length}`)
    .join(',');
  return `${chars}|nodes=${Object.keys(project.nodes).length}`;
}

export function AnalysisDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Late-bound close handler: `requestClose` needs state declared below, while
  // the focus hook needs a handler immediately (M11).
  const requestCloseRef = useRef<() => void>(() => onClose());
  const project = useStore((s) => s.project);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const select = useStore((s) => s.select);
  const focusNode = useStore((s) => s.focusNode);
  const runAsr = useStore((s) => s.runAsr);
  const asrRunning = useStore((s) => s.asrRunning);
  const clearAsr = useStore((s) => s.clearAsr);
  const asr = useStore((s) => s.asr);
  const asrOptions = useStore((s) => s.asrOptions);
  const setAsrOptions = useStore((s) => s.setAsrOptions);
  const apply = useStore((s) => s.apply);
  const recordAnalysis = useStore((s) => s.recordAnalysis);

  const discrete = project.characters.filter((c) => c.type === 'discrete');
  const [charId, setCharId] = useState<string>('');
  const effectiveId =
    (charId && discrete.some((c) => c.id === charId) && charId) ||
    (activeCharacterId && discrete.some((c) => c.id === activeCharacterId) && activeCharacterId) ||
    discrete[0]?.id ||
    '';
  const character = findCharacter(project, effectiveId);

  // `open` gates every heavy computation: a closed dialog recomputes nothing.
  const mp = useMemo(
    () => (open && character ? parsimony(project, character) : null),
    [open, project, character],
  );
  const issues = useMemo(
    () => (open && character ? checkConsistency(project, character) : []),
    [open, project, character],
  );
  const signal = useMemo(
    () => (open && character ? discreteSignal(project, character) : null),
    [open, project, character],
  );
  const correlations = useMemo(() => (open ? characterCorrelations(project) : []), [open, project]);
  // Significance is not free. The overlap ratio is descriptive; a p-value
  // only exists after the tree-constrained permutation test has been RUN, on
  // demand. THE FAMILY IS THE MODEL'S OWN: `characterCorrelationTests` defines
  // membership by "a statistic exists", never by the observed score, and caps
  // on the stable pair key — the dialog's own score-ranked copy was the exact
  // data-driven-family mistake the model's principle forbids.
  const [tested, setTested] = useState<{
    fingerprint: string;
    rows: AdjustedCorrelationTest[];
    familyTotal: number;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const currentFingerprint = useMemo(
    () => (open ? familyFingerprint(project) : ''),
    [open, project],
  );
  const tests = tested && tested.fingerprint === currentFingerprint ? tested.rows : null;
  const runCorrelationTests = () => {
    if (testing) return;
    setTesting(true);
    // Yield one frame so the "running" label paints before the synchronous work.
    setTimeout(() => {
      try {
        const rows = characterCorrelationTests(project);
        const familyTotal = rows[0]?.familyTotal ?? rows.length;
        setTested({ fingerprint: familyFingerprint(project), rows, familyTotal });
      } finally {
        setTesting(false);
      }
    }, 0);
  };
  const summary = useMemo(() => (open ? treeSummary(project) : null), [open, project]);
  const nonBinaryInternals = summary
    ? summary.internalCount - Math.round(summary.resolution * summary.internalCount)
    : 0;
  const continuousChars = project.characters.filter((c) => c.type === 'continuous');
  const continuousResults = useMemo(
    () =>
      open
        ? continuousChars.map((c) => ({
            character: c,
            result: blombergK(project, c),
            reason: blombergKBlockReason(project, c),
          }))
        : [],
    [open, project, continuousChars],
  );
  // BM null p-values for K are computed on demand (400 simulated traits each).
  const [kNulls, setKNulls] = useState<Record<string, ReturnType<typeof blombergKNullTest>>>({});
  // 400 BM simulations are a synchronous seconds-long pass on a large tree:
  // mark busy and yield a frame first so the button shows the running state
  // instead of the window just freezing (H1).
  const [kNullRunning, setKNullRunning] = useState<string | null>(null);
  const runKNull = (cid: string) => {
    if (kNullRunning) return;
    const c = project.characters.find((x) => x.id === cid);
    if (!c) return;
    setKNullRunning(cid);
    setTimeout(() => {
      try {
        const r = blombergKNullTest(useStore.getState().project, c);
        if (r) setKNulls((m) => ({ ...m, [cid]: r }));
        else notify.info(tr('该性状无法模拟零分布（数据或矩阵不可用）', 'Cannot simulate a BM null for this character (data or matrix unavailable)'));
      } finally {
        setKNullRunning(null);
      }
    }, 0);
  };
  // --- additional statistics (A-18 / H8): eight model-layer methods had no UI.
  // Everything here runs ON DEMAND with a busy handoff, never on render.
  type ExtraResults = {
    rtt?: RootToTipRegression | { blocked: string };
    yule?: BalanceZScores | { blocked: string };
    fritz?: { d: number; pValue: number; tips: number; replicates: number } | { blocked: string };
    faith?: { state: string; pd: number | null }[];
    community?: { state: string; stats: CommunityPhyloStats | { blocked: string } }[];
    mpr?: { changedBranches: number; samples: number; cost: number } | { blocked: string };
    stoch?: { changedBranches: number; meanChangesPerSample: number; samples: number } | { blocked: string };
  };
  const [extra, setExtra] = useState<ExtraResults>({});
  const [extraBusy, setExtraBusy] = useState<string | null>(null);
  const runExtra = <K extends keyof ExtraResults>(key: K, task: () => ExtraResults[K]) => {
    if (extraBusy) return;
    setExtraBusy(key);
    setTimeout(() => {
      try {
        const result = task();
        setExtra((m) => ({ ...m, [key]: result }));
      } finally {
        setExtraBusy(null);
      }
    }, 0);
  };

  // The stored analysis runs (first-class, exportable).
  const runHistory = open ? (project.analysisResults ?? []).slice().reverse() : [];

  // Focus trap + Esc close + initial focus.
  const ref = useDialogFocus(open, () => requestCloseRef.current());

  const applyParsimonyBaseline = () => {
    if (!character) return;
    // Pre-check the data before showing any confirmation: on a character with
    // zero scored tips, `parsimony` returns cost 0 and every internal node
    // resolves to the first declared state — a "successful" overwrite built
    // from nothing. The guard turns that silent degradation into a message.
    const scoredTips = Object.values(project.nodes).filter(
      (n) => n.childrenIds.length === 0 && isObservedState(character, n.charStates?.[character.id]),
    ).length;
    if (scoredTips === 0) {
      notify.info(S.review.analysisApplyParsimonyNoData);
      return;
    }
    requestConfirm({
      key: 'apply-parsimony',
      title: S.review.analysisApplyParsimony,
      message: S.review.analysisApplyParsimonyConfirm,
      confirmLabel: S.review.analysisApplyParsimony,
      onConfirm: () => {
        apply((d) => {
          fillParsimony(d, character.id);
        });
        notify.success(S.review.analysisApplied(Object.values(project.nodes).filter((n) => n.childrenIds.length > 0).length));
      },
    });
  };

  const copyCitation = async (method: string, params: Record<string, string | number | boolean | null>) => {
    const bits = [
      `CladeForge ${APP_VERSION}`,
      method,
      ...Object.entries(params).map(([k, v]) => `${k}=${String(v)}`),
      `topology: single user-edited tree (${Object.keys(project.nodes).length} nodes)`,
      `generated: ${new Date().toISOString()}`,
    ];
    try {
      await navigator.clipboard?.writeText(bits.join('\n'));
      notify.success(S.review.analysisCopied);
    } catch {
      notify.info(bits.join('\n'));
    }
  };

  const exportResultsCsv = async () => {
    if (!tests) return;
    const lines = [
      ['character_a', 'character_b', 'jaccard', 'p_raw', 'p_adjusted_holm', 'p_adjusted_bh', 'permutations', 'seed', 'resolution', 'null_mean', 'family_total', 'family_selection'].join(','),
      ...tests.map((t) =>
        [
          JSON.stringify(t.aName),
          JSON.stringify(t.bName),
          t.score.toFixed(4),
          t.pValue.toFixed(6),
          t.adjustedP.toFixed(6),
          (bhAdjust(tests.map((x) => x.pValue), tests.indexOf(t)) ?? NaN).toFixed(6),
          t.permutations,
          DEFAULT_PERMUTATION_SEED,
          t.resolution.toFixed(6),
          t.nullMean.toFixed(4),
          t.familyTotal ?? '',
          t.familySelection ?? '',
        ].join(','),
      ),
    ];
    // Through the same save pipeline as every other export (A-06): the webview
    // download used to land in an unfindable default folder with no toast.
    const saved = await saveText(
      'cladeforge-correlation-tests.csv',
      lines.join('\n'),
      [{ name: 'CSV', extensions: ['csv'] }],
    );
    if (saved) {
      notify.success(
        tr(
          `已导出 cladeforge-correlation-tests.csv（${tests.length} 行检验结果）`,
          `Exported cladeforge-correlation-tests.csv (${tests.length} test row${tests.length === 1 ? '' : 's'})`,
        ),
      );
    }
  };

  const recordRun = (kind: AnalysisResult['kind'], method: string, params: Record<string, string | number | boolean | null>, payload: unknown, characterIds?: string[]) => {
    recordAnalysis({
      id: newId(),
      kind,
      title: method,
      characterIds,
      fingerprint: familyFingerprint(project),
      method,
      params,
      version: APP_VERSION,
      createdAt: new Date().toISOString(),
      payload,
    });
    notify.success(S.review.analysisRecorded);
  };

  if (!open) return null;

  // M11: permutation results and BM nulls take seconds of compute and live in
  // component state; a stray backdrop click used to erase them silently. Runs
  // saved to the run history are already safe — this protects only unsaved work.
  const requestClose = () => {
    if (!tested && Object.keys(kNulls).length === 0) {
      onClose();
      return;
    }
    requestConfirm({
      key: 'analysis-close-discard',
      title: S.analysis.close,
      message: tr(
        '关闭会丢弃尚未保存到运行记录的检验结果（重新打开需重新计算）。已「保存到运行记录」的结果不受影响。',
        'Closing discards test results not saved to the run history (they would be recomputed after reopening). Results already saved to the run history are unaffected.',
      ),
      confirmLabel: S.analysis.close,
      onConfirm: onClose,
    });
  };

  requestCloseRef.current = requestClose;

  // Issue tag color mapping
  const tagColor = (tag: string): string => {
    if (tag === tr('局部不一致', 'Local inconsistency')) return 'var(--danger)';
    if (tag === tr('同塑', 'Homoplasy')) return 'var(--warning, #f59e0b)';
    if (tag === tr('模糊重建', 'Ambiguous reconstruction')) return 'var(--info, #3b82f6)';
    return 'var(--muted)';
  };

  return (
    <div className="dialog-backdrop" onMouseDown={() => requestCloseRef.current()}>
      <div
        ref={ref}
        className="dialog analysis-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={S.analysis.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>{S.analysis.title}</h2>

        {/* Conditional-on-topology statement: the methodological boundary every
            reader of these numbers has to know, ON SCREEN, not just in a manual
            chapter nobody opens. */}
        <div className="hint" style={{ borderColor: 'var(--warning, #f59e0b)' }}>
          ⚠ {S.review.analysisTopologyWarning}
        </div>

        {/* Section jump-nav (A-07/M1): the dialog is a long single page, and
            "run an ASR" meant scrolling six screens of statistics to find the
            block. The chips scroll to each section without closing anything. */}
        <div className="row-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="navigation" aria-label={tr('分析区块导航', 'Analysis section navigation')}>
          {([
            ['sec-summary', S.analysis.treeSummarySection],
            ['sec-parsimony', S.analysis.parsimonySection],
            ['sec-signal', S.analysis.signalSection],
            ['sec-consistency', S.analysis.consistencySection],
            ['sec-correlation', S.analysis.correlationSection],
            ['sec-continuous', S.analysis.continuousSection],
            ['sec-asr', S.analysis.asrModelSection],
            ['sec-extra', tr('更多统计量', 'Additional statistics')],
            ['sec-history', S.review.analysisRunHistory],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn ghost"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tree summary statistics (3.2) */}
        {summary && (
        <div className="panel-section" id="sec-summary">
          <h3>{S.analysis.treeSummarySection}</h3>
          <div className="field"><label>{S.analysis.tipCount}</label><span>{summary.tipCount}</span></div>
          <div className="field"><label>{S.analysis.internalCount}</label><span>{summary.internalCount}</span></div>
          <div className="field"><label>{S.analysis.resolution}</label><span>{(summary.resolution * 100).toFixed(1)}%</span></div>
          <div className="field"><label>{S.analysis.avgBranchLength}</label><span>{summary.avgBranchLength.toFixed(3)}</span></div>
          <div className="field"><label>{S.analysis.totalBranchLength}</label><span>{summary.totalBranchLength.toFixed(3)}</span></div>
          {/* The height is reported in the unit the data actually provides, and
              how much of the tree has any length at all is stated instead of
              being hidden behind a silently imputed scale. */}
          <div className="field">
            <label>{S.analysis.treeHeight}</label>
            <span>{summary.treeHeight.toFixed(3)} · {summary.treeHeightUnit === 'branch-length' ? S.analysis.treeHeightUnitBranch : S.analysis.treeHeightUnitEdges}</span>
          </div>
          {summary.missingBranchLengths > 0 && (
            <div className="hint">{S.analysis.branchLengthCoverage(summary.branchLengthNodes, summary.missingBranchLengths)}</div>
          )}
          <div className="field"><label>{S.analysis.sackinIndex}</label><span>{summary.sackinIndex}</span></div>
          <div className="field"><label>{S.analysis.collessIndex}</label><span>{summary.collessIndex}</span></div>
          {!summary.collessApplies && nonBinaryInternals > 0 && (
            <div className="hint">{S.analysis.collessBinaryOnly(nonBinaryInternals)}</div>
          )}
        </div>
        )}

        {discrete.length === 0 || !character ? (
          <div className="hint">{S.analysis.needCharacter}</div>
        ) : (
          <>
            <div className="field">
              <label>{S.analysis.character}</label>
              <select value={effectiveId} onChange={(e) => setCharId(e.target.value)}>
                {discrete.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="panel-section" id="sec-parsimony">
              <h3>{S.analysis.parsimonySection}</h3>
              {/* No scored tips → cost 0 with every internal node resolving to
                  the first declared state is a grid artefact, not a result; the
                  guard on the apply button already refuses, and the number
                  itself says why (A-19). */}
              {character && Object.values(project.nodes).every(
                (n) => n.childrenIds.length > 0 || !isObservedState(character, n.charStates?.[character.id]),
              ) ? (
                <div className="hint" style={{ color: 'var(--warning, #f59e0b)' }}>
                  {S.review.analysisApplyParsimonyNoData}
                </div>
              ) : (
                <div className="field">
                  <label>{S.analysis.cost}</label>
                  <span>{mp ? (mp.feasible ? mp.cost : tr('无可行解', 'infeasible')) : 0}</span>
                </div>
              )}
              <div className="hint">{S.analysis.fillHint}</div>
              {/* The apply exit the module comment always promised: one action
                  writes the MP baseline to every internal node as ONE undo-able
                  step, and the user then reviews per-node. */}
              <div className="field row-actions">
                <button className="btn" onClick={applyParsimonyBaseline}>
                  {S.review.analysisApplyParsimony}
                </button>
                <button
                  className="btn ghost"
                  onClick={() =>
                    recordRun(
                      'parsimony',
                      'Sankoff parsimony (generalised, tie-broken)',
                      {
                        cost: mp?.feasible ? mp.cost : null,
                        optimization: 'sankoff-min',
                        character: character.name,
                      },
                      { cost: mp?.feasible ? mp.cost : null },
                      [character.id],
                    )
                  }
                >
                  {S.review.analysisRecordRun}
                </button>
              </div>
            </div>

            <div className="panel-section" id="sec-signal">
              <h3>{S.analysis.signalSection}</h3>
              {signal ? (
                <>
                  {/* Show m, s, g and the formulas (3.1) */}
                  <div className="field"><label>{S.analysis.minSteps}</label><span>{signal.minSteps}</span></div>
                  <div className="field"><label>{S.analysis.steps}</label><span>{signal.steps}</span></div>
                  <div className="field"><label>{S.analysis.maxSteps}</label><span>{signal.maxSteps}</span></div>
                  <div className="field"><label>CI</label><span>{signal.ci.toFixed(3)} = m/s</span></div>
                  <div className="field"><label>RI</label><span>{signal.ri.toFixed(3)} = (g−s)/(g−m)</span></div>
                  {signal.missingCodes > 0 && (
                    <div className="hint">{S.analysis.signalMissingCodes(signal.missingCodes)}</div>
                  )}
                  {signal.polymorphicTips > 0 && (
                    <div className="hint">{S.analysis.signalPolymorphic(signal.polymorphicTips)}</div>
                  )}
                  {signal.unresolvedTree && (
                    <div className="hint">
                      {tr(
                        '树含多歧分支：CI/RI 会偏乐观（变化可在多歧分支间“免费”共享）',
                        'The tree contains unresolved polytomies: CI/RI read optimistic (changes are shared “for free” across unresolved branches)',
                      )}
                    </div>
                  )}
                  <div className="hint">{S.analysis.signalHint}</div>
                </>
              ) : (
                // A weighted character and an under-scored one get different
                // messages, so "no signal" never reads as "too few tips".
                <div className="hint">
                  {character && !ciRiApplies(character) && Boolean(character.costMatrix)
                    ? S.analysis.signalWeighted
                    : S.analysis.signalNone}
                </div>
              )}
            </div>

            <div className="panel-section" id="sec-consistency">
              <h3>{S.analysis.consistencySection}</h3>
              {issues.length === 0 ? (
                <div className="hint">{S.analysis.consistencyNone}</div>
              ) : (
                <ul className="issue-list">
                  {issues.map((it, i) => (
                    <li
                      key={i}
                      className={`issue issue-${it.severity}${it.nodeId ? ' issue-click' : ''}`}
                      onClick={() => {
                        if (it.nodeId) {
                          // Click-through SELECTS and pans WITHOUT closing the
                          // dialog: analysis is an "look, then look again"
                          // activity, and the old onClose() made the user re-run
                          // the whole dialog per issue.
                          select(it.nodeId);
                          focusNode(it.nodeId);
                        }
                      }}
                    >
                      <span className="issue-tag" style={{ color: tagColor(it.tag) }}>[{it.tag}]</span>{' '}
                      {it.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="panel-section" id="sec-correlation">
              <h3>{S.analysis.correlationSection}</h3>
              {correlations.length === 0 && (
                <div className="hint">{S.analysis.correlationNone}</div>
              )}
              {correlations.length > 0 && (
                <ul className="issue-list">
                  {correlations.map((c) => {
                    const row = tests?.find((x) => x.aId === c.aId && x.bId === c.bId);
                    return (
                      <li key={`${c.aId}-${c.bId}`} className="issue issue-info">
                        <div>
                          {c.aName} ↔ {c.bName} · {S.analysis.correlationType}:{' '}
                          {c.score.toFixed(3)} ·{' '}
                          {S.analysis.correlationSample(c.sampleSize)}
                        </div>
                        <div className="hint">
                          {S.analysis.correlationShared(c.shared, c.aBranches, c.bBranches)} ·{' '}
                          {S.analysis.correlationExpected(c.expectedShared)}
                        </div>
                        {row ? (
                          <div className="hint">
                            <strong>{S.analysis.correlationPValue}</strong>{' '}
                            {S.analysis.correlationPSummary(row.pValue, row.permutations, row.resolution)}{' '}
                            · {S.analysis.correlationNullMean(row.nullMean)}
                            <div>
                              <strong>{S.analysis.correlationPAdjusted}</strong>{' '}
                              {row.adjustedP.toFixed(4)} ·{' '}
                              {row.adjustedP <= 0.05
                                ? S.analysis.correlationVerdictYes
                                : S.analysis.correlationVerdictNo}
                            </div>
                            <div className="hint">
                              BH:{' '}
                              {(
                                bhAdjust(
                                  (tests ?? []).map((x) => x.pValue),
                                  (tests ?? []).indexOf(row),
                                ) ?? NaN
                              ).toFixed(4)}{' '}
                              ({tr('Benjamini–Hochberg 校正，供对照', 'Benjamini–Hochberg adjustment, for comparison')})
                            </div>
                            <div>{S.analysis.correlationTestMethod(row.method)}</div>
                          </div>
                        ) : (
                          <div className="hint">
                            {tests
                              ? S.analysis.correlationNotTestable(S.analysis.correlationNotTestableWhy)
                              : S.analysis.correlationNoSignificance}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="hint">{S.review.analysisPermutationNote}</div>
              <div className="hint">{S.analysis.correlationDescriptive}</div>
              <div className="hint">{S.analysis.correlationGateNote}</div>
              <div className="field row-actions">
                <button className="btn" disabled={testing} onClick={runCorrelationTests}>
                  {testing
                    ? S.analysis.correlationTesting
                    : tests
                      ? S.analysis.correlationRerunTest
                      : S.analysis.correlationRunTest}
                </button>
                {tests && tests.length > 0 && (
                  <>
                    <button className="btn ghost" onClick={() => void exportResultsCsv()}>
                      {S.review.analysisExportCsv}
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() =>
                        recordRun(
                          'correlation',
                          'Tree-constrained one-sided upper-tail tip-state permutation + Holm',
                          {
                            pairs: tests.length,
                            familyTotal: tested?.familyTotal ?? tests.length,
                            familySelection: tests[0]?.familySelection ?? 'stable-key',
                          },
                          tests.map((t) => ({
                            a: t.aName,
                            b: t.bName,
                            jaccard: t.score,
                            p: t.pValue,
                            adjustedP: t.adjustedP,
                            permutations: t.permutations,
                          })),
                        )
                      }
                    >
                      {S.review.analysisRecordRun}
                    </button>
                  </>
                )}
              </div>
              {tests && tested && (
                <div className="hint">
                  {S.review.analysisFamily(tests.length, tested.familyTotal)}
                </div>
              )}
              {tests && tests.length > 0 && (
                // A-18: the seed and the run size are part of the method
                // fingerprint — reproducibility a reader cannot see is not
                // reproducibility.
                <div className="hint">
                  {S.analysis.correlationSeedInfo(tests[0].permutations, DEFAULT_PERMUTATION_SEED)}
                </div>
              )}
              {tests && tests.length > 0 && (
                <>
                  <div className="hint">
                    <strong>{S.analysis.correlationAllTestedTitle}</strong>
                  </div>
                  <ul className="issue-list">
                    {tests.map((test) => (
                      <li key={`all-${test.aId}-${test.bId}`} className="issue issue-info">
                        <div>
                          {test.aName} ↔ {test.bName} · {S.analysis.correlationType}:{' '}
                          {test.score.toFixed(3)}
                        </div>
                        <div className="hint">
                          {S.analysis.correlationPSummary(test.pValue, test.permutations, test.resolution)}{' '}
                          ·{' '}
                          <strong>{S.analysis.correlationPAdjusted}</strong> {test.adjustedP.toFixed(4)} ·{' '}
                          {test.adjustedP <= 0.05
                            ? S.analysis.correlationVerdictYes
                            : S.analysis.correlationVerdictNo}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="hint">
                    {S.analysis.correlationSignificant(tests.filter((r) => r.adjustedP <= 0.05).length)}{' '}
                    · {S.analysis.correlationMultiTest(tests.length)}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Continuous character analysis (3.2) */}
        {continuousResults.length > 0 && (
          <div className="panel-section" id="sec-continuous">
            <h3>{S.analysis.continuousSection}</h3>
            {continuousResults.map(({ character: c, result, reason }) => {
              // Bind once: the guard below must narrow ONE value, not two
              // independent `kNulls[c.id]` lookups that TS cannot correlate.
              const knull = kNulls[c.id];
              return (
              <div key={c.id} className="field">
                <label>{c.name}</label>
                <span>
                  {result ? (
                    <>
                      {/* No verdict words ("保守演化" / "过度分散") appear: they
                          would assert an evolutionary conclusion from a point
                          estimate nobody tested. The simulated BM null p-value
                          is one click away and the zero-variation case is named. */}
                      {S.analysis.blombergK}: {result.k.toFixed(3)} (n = {result.n}) ·{' '}
                      {S.analysis.blombergKScale(result.imputedBranches, result.totalBranches)}
                      {result.zeroBranches > 0 && (
                        <span>
                          {' '}
                          ·{' '}
                          {tr(
                            `${result.zeroBranches} 条真实零枝长（同期分化，按 0 计入）`,
                            `${result.zeroBranches} real zero-length branch${result.zeroBranches === 1 ? '' : 'es'} (synchronous divergence, used as 0)`,
                          )}
                        </span>
                      )}
                    </>
                  ) : reason ? (
                    S.analysis.continuousBlockedReason(reason)
                  ) : (
                    S.analysis.continuousNone
                  )}
                </span>
                {result && (
                  <span className="field row-actions" style={{ display: 'inline-flex', gap: 6 }}>
                    <button
                      className="btn ghost"
                      style={{ fontSize: 11 }}
                      disabled={kNullRunning !== null}
                      onClick={() => runKNull(c.id)}
                    >
                      {kNullRunning === c.id ? S.analysis.kNullRunningLabel : tr('模拟 BM 零分布', 'Simulate BM null')}
                    </button>
                    {knull && (
                      <span style={{ fontSize: 12 }}>
                        p ≈ {knull.pValue.toFixed(3)} ({knull.replicates}{' '}
                        {tr('次模拟', 'simulations')})
                      </span>
                    )}
                  </span>
                )}
              </div>
              );
            })}
            <div className="hint">{S.analysis.blombergKHint}</div>
            <div className="hint">{S.analysis.blombergKNoTest}</div>
          </div>
        )}


        {/* Additional tree statistics (A-18 / H8): eight methods the model layer
            already implemented and tested had no UI entry at all. Each runs on
            demand with its own guard and says WHY when it cannot run. */}
        <div className="panel-section" id="sec-extra">
          <h3>{tr('更多统计量（按需运行）', 'Additional statistics (run on demand)')}</h3>
          <div className="field row-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button className="btn ghost" disabled={extraBusy !== null} onClick={() => runExtra('rtt', () => {
              const live = useStore.getState().project;
              const usable = Object.values(live.nodes).filter(
                (n) => n.childrenIds.length === 0 && n.age !== undefined && n.branchLength !== undefined,
              ).length;
              if (usable === 0) {
                return { blocked: tr('没有任何末端同时具有校准年龄与枝长：根到尖回归需要两者。请先在时间模块校准年龄。', 'No tip has BOTH a calibrated age and a branch length: root-to-tip regression needs both. Calibrate ages in the Time module first.') };
              }
              const r = rootToTipRegression(live);
              return r ?? { blocked: tr('可用末端不足，无法拟合回归。', 'Not enough usable tips to fit the regression.') };
            })}>
              {extraBusy === 'rtt' ? S.analysis.asrRunningLabel : tr('根到尖回归', 'Root-to-tip regression')}
            </button>
            <button className="btn ghost" disabled={extraBusy !== null} onClick={() => runExtra('yule', () => {
              const live = useStore.getState().project;
              const r = yuleBalanceZScores(live);
              return r ?? { blocked: tr('需要 ≥ 4 个末端的二叉树，且 Yule 零分布非退化。', 'Needs ≥ 4 tips, a binary tree, and a non-degenerate Yule null.') };
            })}>
              {extraBusy === 'yule' ? S.analysis.asrRunningLabel : tr('Yule 平衡 z 分数', 'Yule balance z-scores')}
            </button>
            <button className="btn ghost" disabled={extraBusy !== null || !character || character.states.length !== 2} onClick={() => runExtra('fritz', () => {
              const live = useStore.getState().project;
              const r = fritzPurvisD(live, character!.id);
              return r ?? { blocked: tr('该性状需要恰好两个状态且有末端赋值。', 'This method needs a two-state character with scored tips.') };
            })}>
              {extraBusy === 'fritz' ? S.analysis.asrRunningLabel : tr('Fritz–Purvis D', 'Fritz–Purvis D')}
            </button>
            <button className="btn ghost" disabled={extraBusy !== null || !character || character.type !== 'discrete'} onClick={() => runExtra('faith', () => {
              const live = useStore.getState().project;
              const c = character!;
              return c.states.map((st) => ({ state: st.label, pd: faithPd(live, c.id, st.id) }));
            })}>
              {extraBusy === 'faith' ? S.analysis.asrRunningLabel : tr("Faith 系统发育多样性（按状态）", "Faith’s PD (per state)")}
            </button>
            <button
              className="btn ghost"
              disabled={extraBusy !== null || !character || character.type !== 'discrete'}
              onClick={() => runExtra('community', () => {
                const live = useStore.getState().project;
                const c = character!;
                const tips = Object.values(live.nodes).filter((n) => n.childrenIds.length === 0).length;
                if (tips > 300) {
                  return [
                    {
                      state: '*',
                      stats: {
                        blocked: tr(
                          `全树 ${tips} 个末端：NRI/NTI 需要构建 O(n²) 距离矩阵（与 Blomberg’s K 同一上限 300）。`,
                          `The tree has ${tips} tips: NRI/NTI builds an O(n²) distance matrix (same 300-tip ceiling as Blomberg’s K).`,
                        ),
                      },
                    },
                  ];
                }
                return c.states.map((st) => ({
                  state: st.label,
                  stats: communityPhyloStats(live, c.id, st.id) ?? { blocked: tr('该状态的末端不足 2 个，无法计算。', 'Fewer than 2 tips carry this state; nothing to compute.') },
                }));
              })}
            >
              {extraBusy === 'community' ? S.analysis.asrRunningLabel : tr('群落结构 NRI/NTI（按状态）', 'Community structure NRI/NTI (per state)')}
            </button>
            <button className="btn ghost" disabled={extraBusy !== null || !character || character.type !== 'discrete'} onClick={() => runExtra('mpr', () => {
              const live = useStore.getState().project;
              const c = character!;
              const r = sampleMprBranchRates(live, c);
              if (!r) return { blocked: tr('需要已赋值的离散性状。', 'Needs a scored discrete character.') };
              const changed = [...r.rates.values()].filter((v) => v > 0).length;
              return { changedBranches: changed, samples: r.samples, cost: r.cost };
            })}>
              {extraBusy === 'mpr' ? S.analysis.asrRunningLabel : tr('MPR 每枝变化率', 'MPR per-branch change rates')}
            </button>
            <button className="btn ghost" disabled={extraBusy !== null || !character || character.type !== 'discrete'} onClick={() => runExtra('stoch', () => {
              const live = useStore.getState().project;
              const c = character!;
              const r = sampleStochasticMap(live, c);
              if (!r) return { blocked: tr('需要已赋值的离散性状与可用枝长。', 'Needs a scored discrete character and usable branch lengths.') };
              const changed = [...r.perBranchChanges.entries()].filter(([, v]) => v > 0).length;
              return { changedBranches: changed, meanChangesPerSample: r.meanChangesPerSample, samples: r.samples };
            })}>
              {extraBusy === 'stoch' ? S.analysis.asrRunningLabel : tr('随机性状映射', 'Stochastic character map')}
            </button>
          </div>
          <div className="hint">
            {tr(
              '这些统计量在模型层已实现并有测试，此处按需运行（每次点击独立计算）。结果为点估计或描述性指标，不构成显著性结论（除非明示 p 值）。',
              'These methods are implemented and tested at the model layer; each button runs one on-demand computation. Results are point estimates or descriptive indices, not significance claims (unless a p-value is shown).',
            )}
          </div>

          {(() => {
            const blockedOf = (v: unknown): string | null =>
              v && typeof v === 'object' && 'blocked' in (v as Record<string, unknown>) ? String((v as { blocked: string }).blocked) : null;
            const rows: JSX.Element[] = [];
            const rtt = extra.rtt;
            if (rtt) {
              const b = blockedOf(rtt);
              rows.push(
                <div className="field" key="rtt">
                  <label>{tr('根到尖回归', 'Root-to-tip regression')}</label>
                  <span>
                    {b ?? (
                      <>
                        {tr('斜率', 'slope')} = {(rtt as RootToTipRegression).slope.toFixed(4)} · R² = {(rtt as RootToTipRegression).r2.toFixed(3)} · p ≈ {(rtt as RootToTipRegression).pValue.toFixed(4)} · n = {(rtt as RootToTipRegression).tips}
                        {((rtt as RootToTipRegression).excludedNoAge > 0 || (rtt as RootToTipRegression).excludedNoLength > 0) && (
                          <span className="hint">
                            {' '}· {tr(`排除无年龄 ${(rtt as RootToTipRegression).excludedNoAge} 个、无枝长 ${(rtt as RootToTipRegression).excludedNoLength} 个末端`, `excluded ${(rtt as RootToTipRegression).excludedNoAge} tip${(rtt as RootToTipRegression).excludedNoAge === 1 ? '' : 's'} without ages and ${(rtt as RootToTipRegression).excludedNoLength} without branch lengths`)}
                          </span>
                        )}
                        <span className="hint"> · {tr('斜率是速率的估计；R² 度量钟状信号。', 'the slope estimates a rate; R² measures clock-likeness.')}</span>
                      </>
                    )}
                  </span>
                </div>,
              );
            }
            const yule = extra.yule;
            if (yule) {
              const b = blockedOf(yule);
              rows.push(
                <div className="field" key="yule">
                  <label>{tr('Yule 平衡 z 分数', 'Yule balance z-scores')}</label>
                  <span>
                    {b ?? (
                      <>
                        Sackin z = {(yule as BalanceZScores).sackin.z.toFixed(3)} · Colless z = {(yule as BalanceZScores).colless.z.toFixed(3)}
                        <span className="hint"> · {tr(`对 ${(yule as BalanceZScores).replicates} 棵同规模 Yule 零树标准化（seed ${(yule as BalanceZScores).seed}）；z 明显为负 = 更平衡，明显为正 = 更不平衡。`, `standardised against ${(yule as BalanceZScores).replicates} same-size Yule nulls (seed ${(yule as BalanceZScores).seed}); clearly negative z = more balanced than Yule, clearly positive = less balanced.`)}</span>
                      </>
                    )}
                  </span>
                </div>,
              );
            }
            const fritz = extra.fritz;
            if (fritz) {
              const b = blockedOf(fritz);
              rows.push(
                <div className="field" key="fritz">
                  <label>{tr('Fritz–Purvis D', 'Fritz–Purvis D')}</label>
                  <span>
                    {b ?? (
                      <>
                        D = {(fritz as { d: number }).d.toFixed(3)} · p ≈ {(fritz as { pValue: number }).pValue.toFixed(4)} · n = {(fritz as { tips: number }).tips}
                        <span className="hint"> · {tr(`对 ${(fritz as { replicates: number }).replicates} 次 BM 零模拟；D≈1 = 随机，D≈0 = 系统发育聚集。`, `against ${(fritz as { replicates: number }).replicates} BM null simulations; D ≈ 1 = random, D ≈ 0 = phylogenetically clustered.`)}</span>
                      </>
                    )}
                  </span>
                </div>,
              );
            }
            if (extra.faith) {
              rows.push(
                <div className="field" key="faith">
                  <label>{tr("Faith 系统发育多样性", "Faith’s PD")}</label>
                  <span>
                    {extra.faith.map((f) => `${f.state}: ${f.pd === null ? tr('无末端', 'no tips') : f.pd.toFixed(3)}`).join(' · ')}
                    <span className="hint"> · {tr('被该状态覆盖的最小 spanning 枝长总和（不含根路径）。', 'total length of the minimum spanning branches covered by each state (root path excluded).')}</span>
                  </span>
                </div>,
              );
            }
            if (extra.community) {
              rows.push(
                <div className="field" key="community">
                  <label>{tr('群落结构 NRI/NTI', 'Community structure NRI/NTI')}</label>
                  <span>
                    {extra.community.map((c) => {
                      const b = blockedOf(c.stats);
                      return b
                        ? `${c.state}: ${b}`
                        : `${c.state}: NRI ${(c.stats as CommunityPhyloStats).nri.toFixed(3)} / NTI ${(c.stats as CommunityPhyloStats).nti.toFixed(3)}`;
                    }).join(' · ')}
                    <span className="hint"> · {tr('正值 = 该状态的末端比随机更聚集；NRI 用平均对间距离，NTI 用最近邻距离。', 'positive = the state\u2019s tips are more clustered than random; NRI uses mean pairwise distance, NTI nearest-neighbour.')}</span>
                  </span>
                </div>,
              );
            }
            if (extra.mpr) {
              const b = blockedOf(extra.mpr);
              rows.push(
                <div className="field" key="mpr">
                  <label>{tr('MPR 每枝变化率', 'MPR per-branch change rates')}</label>
                  <span>
                    {b ?? (
                      <>
                        {tr(`在 ${extra.mpr && typeof extra.mpr === 'object' && 'samples' in extra.mpr ? extra.mpr.samples : 0} 次等价最优 MPR 抽样中，${extra.mpr && typeof extra.mpr === 'object' && 'changedBranches' in extra.mpr ? extra.mpr.changedBranches : 0} 条枝至少一次发生状态变化`, `across ${extra.mpr && typeof extra.mpr === 'object' && 'samples' in extra.mpr ? extra.mpr.samples : 0} equally-optimal MPR draws, ${extra.mpr && typeof extra.mpr === 'object' && 'changedBranches' in extra.mpr ? extra.mpr.changedBranches : 0} branches change at least once`)}
                        <span className="hint"> · {tr('变化支数的分布即是简约重建对该性状的不确定度。', 'the spread of change branches IS the parsimony uncertainty for this character.')}</span>
                      </>
                    )}
                  </span>
                </div>,
              );
            }
            if (extra.stoch) {
              const b = blockedOf(extra.stoch);
              rows.push(
                <div className="field" key="stoch">
                  <label>{tr('随机性状映射', 'Stochastic character map')}</label>
                  <span>
                    {b ?? (
                      <>
                        {tr(`每次映射平均 ${extra.stoch && typeof extra.stoch === 'object' && 'meanChangesPerSample' in extra.stoch ? extra.stoch.meanChangesPerSample.toFixed(2) : '—'} 次变化（100 次抽样），${extra.stoch && typeof extra.stoch === 'object' && 'changedBranches' in extra.stoch ? extra.stoch.changedBranches : 0} 条枝至少一次变化`, `mean of ${extra.stoch && typeof extra.stoch === 'object' && 'meanChangesPerSample' in extra.stoch ? extra.stoch.meanChangesPerSample.toFixed(2) : '—'} changes per map (100 draws); ${extra.stoch && typeof extra.stoch === 'object' && 'changedBranches' in extra.stoch ? extra.stoch.changedBranches : 0} branches change at least once`)}
                        <span className="hint"> · {tr('Mk 后验条件下的随机映射；固定 seed 20260919，同文档可复现。', 'stochastic mapping conditioned on the Mk posterior; fixed seed 20260919, replayable.')}</span>
                      </>
                    )}
                  </span>
                </div>,
              );
            }
            return rows.length > 0 ? <>{rows}</> : null;
          })()}
        </div>

        {/* ASR model settings and threshold (2.2) */}
        {discrete.length > 0 && (
          <div className="panel-section" id="sec-asr">
            <h3>{S.analysis.asrModelSection}</h3>
            <div className="field">
              <label>{S.analysis.asrModel}</label>
              {/* Read-only statement instead of a one-option dropdown: "only ER
                  exists" is a fact, not a choice, and a dropdown with a single
                  option pretends otherwise. SYM/ARD are named as NOT implemented. */}
              <span>
                {S.analysis.asrModelER} — {tr('唯一实现；SYM/ARD 未实现', 'the only implemented model; SYM/ARD are not implemented')}
              </span>
            </div>
            <div className="field">
              <label>{S.analysis.asrThreshold}</label>
              <RangeField
                value={asrOptions.threshold}
                min={0}
                max={1}
                step={0.05}
                onCommit={(v) => v !== undefined && setAsrOptions({ threshold: v })}
              />
            </div>
            {/* The slider sets the threshold AsrPieLayer actually draws with —
                the layer keeps no constant of its own — so the label above is
                true. */}
            <div className="hint">{S.analysis.asrThresholdHint(asrOptions.threshold)}</div>
            <div className="hint">{S.analysis.asrModelErOnly}</div>
            <div className="field row-actions">
              <button
                className="btn primary"
                disabled={!character || character.type !== 'discrete' || asrRunning}
                onClick={() => runAsr(false)}
              >
                {asrRunning ? S.analysis.asrRunningLabel : S.analysis.asrRun}
              </button>
              {asr && (
                <button className="btn ghost" onClick={clearAsr}>
                  {S.analysisMenu.clearAsr}
                </button>
              )}
            </div>
            {asr && (
              <div className="field">
                <label>{S.review.analysisMethod}</label>
                <span>
                  {asr.model} ·{' '}
                  {asr.rate.method === 'ml'
                    ? `${S.review.analysisRate}: ${S.review.analysisRateMl}`
                    : S.review.analysisRateMoment}
                  {asr.rate.method === 'ml' && Number.isFinite(asr.rate.rate) && (
                    <>
                      {' '}
                      · r = {Number(asr.rate.rate.toPrecision(4))}
                      {asr.rate.logLikelihood !== undefined && (
                        <>
                          {' '}
                          · {S.review.analysisLnL} = {asr.rate.logLikelihood.toFixed(3)}
                        </>
                      )}
                      {asr.rate.logLikelihoodCi && (
                        <>
                          {' '}
                          · 95% CI [{asrCiBound(asr.rate.logLikelihoodCi[0])}, {asrCiBound(asr.rate.logLikelihoodCi[1])}]
                        </>
                      )}
                    </>
                  )}
                  {asr.rate.sensitivity && (
                    <div className="hint">
                      {S.review.analysisRateSensitivity(asr.rate.sensitivity.maxDelta, asr.rate.sensitivity.nodesChangedArgmax)}
                    </div>
                  )}
                </span>
              </div>
            )}
            {asr?.stale && (
              <div className="hint" style={{ color: 'var(--warning, #f59e0b)' }}>
                {S.review.analysisStale}
              </div>
            )}
            {asr && (
              <div className="field">
                <label>{S.analysis.asrResultSummary}</label>
                <span>
                  {asr.warnings.length === 0
                    ? S.analysis.asrNoWarnings
                    : S.analysis.asrWarningCount(asr.warnings.length)}
                </span>
              </div>
            )}
            {/* Each degradation class is listed with its own distinct-node
                count (one Set<NodeId> per class), so "N 个节点缺失枝长" always means
                N distinct nodes, and a recorded ZERO branch is stated separately
                from an UNSET one. */}
            {asr && asr.warnings.length > 0 && (
              <ul className="issue-list">
                {asr.warnings.map((w, i) => (
                  <li key={`${w.kind}-${i}`} className={`issue issue-${w.kind === 'zero-branch-length' ? 'info' : 'warning'}`}>
                    {S.analysis.asrWarningList(asrWarningLabel(w.kind), w.count)} — {w.message}
                  </li>
                ))}
              </ul>
            )}
            {asr && asr.probs.size === 0 && (
              <div className="field row-actions">
                <button className="btn" disabled={asrRunning} onClick={() => runAsr(true)}>
                  {asrRunning ? S.analysis.asrRunningLabel : S.review.asrForceContinue}
                </button>
              </div>
            )}
            {asr && asr.probs.size > 0 && (
              <div className="field row-actions">
                <button
                  className="btn ghost"
                  onClick={() =>
                    recordRun(
                      'asr',
                      asr.rate.method === 'ml' ? 'Mk-ER marginal ASR, ML rate' : 'Mk-ER marginal ASR, moment rate',
                      {
                        model: asr.model,
                        rate: asr.rate.rate,
                        rateMethod: asr.rate.method,
                        threshold: asr.threshold,
                        lnL: asr.rate.logLikelihood ?? null,
                      },
                      { nodes: asr.probs.size },
                      [asr.characterId],
                    )
                  }
                >
                  {S.review.analysisRecordRun}
                </button>
                <button
                  className="btn ghost"
                  onClick={() =>
                    void copyCitation(`Mk-ER marginal ASR (rate ${asr.rate.method})`, {
                      r: Number(asr.rate.rate.toPrecision(4)),
                      threshold: asr.threshold,
                    })
                  }
                >
                  {S.review.analysisCopyCitation}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Retained analysis runs: the numbers a user may cite, kept with the
            document instead of evaporating with a component's state. */}
        {runHistory.length > 0 && (
          <details className="panel-section" id="sec-history">
            <summary style={{ cursor: 'pointer' }}>
              <h3 style={{ display: 'inline' }}>{S.review.analysisRunHistory}</h3>
            </summary>
            <ul className="issue-list">
              {runHistory.slice(0, 12).map((r) => (
                <li key={r.id} className="issue issue-info">
                  <div>
                    {r.title ?? r.kind} · {new Date(r.createdAt).toLocaleString()} · v{r.version}
                    {r.pinned ? ' · 📌' : ''}
                  </div>
                  <div className="hint">{r.method}</div>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            {S.analysis.close}
          </button>
        </div>
      </div>
    </div>
  );
}
