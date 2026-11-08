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

import { useMemo, useState } from 'react';
import { useStore } from '../model/store';
import { findCharacter } from '../model/characters';
import { parsimony } from '../model/parsimony';
import type { AsrWarning } from '../model/asr';
import {
  blombergK,
  blombergKBlockReason,
  blombergKNullTest,
  ciRiApplies,
  discreteSignal,
  treeSummary,
} from '../model/stats';
import {
  characterCorrelations,
  characterCorrelationTests,
  checkConsistency,
  type AdjustedCorrelationTest,
} from '../model/consistency';
import { requestConfirm } from './confirmDialog';
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
    default:
      return kind;
  }
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
  const project = useStore((s) => s.project);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const select = useStore((s) => s.select);
  const focusNode = useStore((s) => s.focusNode);
  const runAsr = useStore((s) => s.runAsr);
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
  const runKNull = (cid: string) => {
    const c = project.characters.find((x) => x.id === cid);
    if (!c) return;
    const r = blombergKNullTest(project, c);
    if (r) setKNulls((m) => ({ ...m, [cid]: r }));
    else notify.info(tr('该性状无法模拟零分布（数据或矩阵不可用）', 'Cannot simulate a BM null for this character (data or matrix unavailable)'));
  };
  // The stored analysis runs (first-class, exportable).
  const runHistory = open ? (project.analysisResults ?? []).slice().reverse() : [];

  // Focus trap + Esc close + initial focus.
  const ref = useDialogFocus(open, onClose);

  const applyParsimonyBaseline = () => {
    if (!character) return;
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

  const exportResultsCsv = () => {
    if (!tests) return;
    const lines = [
      ['character_a', 'character_b', 'jaccard', 'p_raw', 'p_adjusted_holm', 'permutations', 'resolution', 'null_mean', 'family_total', 'family_selection'].join(','),
      ...tests.map((t) =>
        [
          JSON.stringify(t.aName),
          JSON.stringify(t.bName),
          t.score.toFixed(4),
          t.pValue.toFixed(6),
          t.adjustedP.toFixed(6),
          t.permutations,
          t.resolution.toFixed(6),
          t.nullMean.toFixed(4),
          t.familyTotal ?? '',
          t.familySelection ?? '',
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cladeforge-correlation-tests.csv';
    a.click();
    URL.revokeObjectURL(url);
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

  // Issue tag color mapping
  const tagColor = (tag: string): string => {
    if (tag === tr('局部不一致', 'Local inconsistency')) return 'var(--danger)';
    if (tag === tr('同塑', 'Homoplasy')) return 'var(--warning, #f59e0b)';
    if (tag === tr('模糊重建', 'Ambiguous reconstruction')) return 'var(--info, #3b82f6)';
    return 'var(--muted)';
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
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

        {/* Tree summary statistics (3.2) */}
        {summary && (
        <div className="panel-section">
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

            <div className="panel-section">
              <h3>{S.analysis.parsimonySection}</h3>
              <div className="field">
                <label>{S.analysis.cost}</label>
                <span>{mp ? (mp.feasible ? mp.cost : tr('无可行解', 'infeasible')) : 0}</span>
              </div>
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

            <div className="panel-section">
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
                  {signal.unresolvedTree && (
                    <div className="hint">
                      {tr(
                        '树含未解析多歧枝：CI/RI 会偏乐观（变化可在多歧枝间“免费”共享）',
                        'The tree contains unresolved polytomies: CI/RI read optimistic (changes are shared "for free" across unresolved branches)',
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

            <div className="panel-section">
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

            <div className="panel-section">
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
                    <button className="btn ghost" onClick={exportResultsCsv}>
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
          <div className="panel-section">
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
                    <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => runKNull(c.id)}>
                      {tr('模拟 BM 零分布', 'Simulate BM null')}
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

        {/* ASR model settings and threshold (2.2) */}
        {discrete.length > 0 && (
          <div className="panel-section">
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
                disabled={!character || character.type !== 'discrete'}
                onClick={() => runAsr(false)}
              >
                {S.analysis.asrRun}
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
                  {asr.rate.method === 'ml' && asr.rate.rate !== undefined && (
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
                          · 95% CI [{asr.rate.logLikelihoodCi[0].toPrecision(3)}, {asr.rate.logLikelihoodCi[1].toPrecision(3)}]
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
                <button className="btn" onClick={() => runAsr(true)}>
                  {S.review.asrForceContinue}
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
          <div className="panel-section">
            <h3>{S.review.analysisRunHistory}</h3>
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
          </div>
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
