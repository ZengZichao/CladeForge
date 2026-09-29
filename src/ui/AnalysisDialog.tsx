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

import { useMemo, useState } from 'react';
import { useStore } from '../model/store';
import { findCharacter } from '../model/characters';
import { parsimony } from '../model/parsimony';
import type { AsrWarning } from '../model/asr';
import {
  blombergK,
  blombergKBlockReason,
  ciRiApplies,
  discreteSignal,
  holmBonferroni,
  treeSummary,
} from '../model/stats';
import {
  characterCorrelations,
  checkConsistency,
  correlationPermutationTest,
  type CorrelationTest,
} from '../model/consistency';
import type { Character, NodeId, Project } from '../model/types';
import { useDialogFocus } from './useDialogFocus';
import { RangeField } from './fields';
import { S, tr } from './strings';

/**
 * The inference is decoupled from the descriptive screen: pairs already flagged
 * at Jaccard ≥ 0.5 are not the only ones that can carry a p-value, and a pair
 * whose two single deep changes coincide (overlap 1/3) would otherwise be neither
 * shown nor tested. Everything the permutation test CAN be run on is tested,
 * because the family that gets corrected must be the family that was tested — and
 * the most-overlapping pairs go first, so the wall-clock cap drops the least
 * informative pairs instead of the most promising ones.
 */
const MAX_TESTED_PAIRS = 24;

function testAllCharacterPairs(project: Project): {
  rows: { test: CorrelationTest; adjusted: number }[];
  skipped: number;
} {
  const discrete = project.characters.filter((c) => c.type === 'discrete' && c.states.length > 0);
  const changes = new Map<string, Set<NodeId>>();
  for (const c of discrete) changes.set(c.id, parsimony(project, c).changeBranches);
  const candidates: { a: Character; b: Character; score: number }[] = [];
  for (let i = 0; i < discrete.length; i += 1) {
    for (let j = i + 1; j < discrete.length; j += 1) {
      const a = discrete[i];
      const b = discrete[j];
      const A = changes.get(a.id) as Set<NodeId>;
      const B = changes.get(b.id) as Set<NodeId>;
      if (A.size < 2 || B.size < 2) continue; // no statistic to permute
      let inter = 0;
      for (const x of A) if (B.has(x)) inter += 1;
      const union = A.size + B.size - inter;
      candidates.push({ a, b, score: union > 0 ? inter / union : 0 });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  const tests: CorrelationTest[] = [];
  for (const { a, b } of candidates.slice(0, MAX_TESTED_PAIRS)) {
    const t = correlationPermutationTest(project, a, b);
    if (t) tests.push(t);
  }
  // One adjustment across the whole tested family. Holm controls the
  // family-wise error rate, which is what "flag the pairs worth calling
  // co-evolved" needs; the raw per-pair p is still shown, clearly labelled.
  const adjusted = holmBonferroni(tests.map((t) => t.pValue));
  const rows = tests
    .map((test, i) => ({ test, adjusted: adjusted[i] }))
    .sort((x, y) => x.adjusted - y.adjusted || y.test.score - x.test.score);
  return { rows, skipped: Math.max(0, candidates.length - MAX_TESTED_PAIRS) };
}

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
    default:
      return kind;
  }
}

export function AnalysisDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const select = useStore((s) => s.select);
  const runAsr = useStore((s) => s.runAsr);
  const clearAsr = useStore((s) => s.clearAsr);
  const asr = useStore((s) => s.asr);
  const asrOptions = useStore((s) => s.asrOptions);
  const setAsrOptions = useStore((s) => s.setAsrOptions);

  const discrete = project.characters.filter((c) => c.type === 'discrete');
  const [charId, setCharId] = useState<string>('');
  const effectiveId =
    (charId && discrete.some((c) => c.id === charId) && charId) ||
    (activeCharacterId && discrete.some((c) => c.id === activeCharacterId) && activeCharacterId) ||
    discrete[0]?.id ||
    '';
  const character = findCharacter(project, effectiveId);

  const mp = useMemo(
    () => (character ? parsimony(project, character) : null),
    [project, character],
  );
  const issues = useMemo(
    () => (character ? checkConsistency(project, character) : []),
    [project, character],
  );
  const signal = useMemo(
    () => (character ? discreteSignal(project, character) : null),
    [project, character],
  );
  const correlations = useMemo(() => characterCorrelations(project), [project]);
  // Significance is not free. The overlap ratio is descriptive; a p-value
  // only exists after the tree-constrained permutation test has been RUN, on
  // demand, because it costs one parsimony solve per replicate. The results are
  // keyed to the document they were computed on, so any edit invalidates them
  // rather than leaving a stale p-value on screen — and every p in the family
  // carries its Holm–Bonferroni partner, because a per-pair 0.05 across a dozen
  // pairs is not a 0.05 test.
  const [tested, setTested] = useState<{
    project: typeof project;
    rows: { test: CorrelationTest; adjusted: number }[];
    skipped: number;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const tests = tested?.project === project ? tested.rows : null;
  const runCorrelationTests = () => {
    if (testing) return;
    setTesting(true);
    // Yield one frame so the "running" label paints before the synchronous work.
    setTimeout(() => {
      const snapshot = project;
      try {
        setTested({ project: snapshot, ...testAllCharacterPairs(snapshot) });
      } finally {
        setTesting(false);
      }
    }, 0);
  };
  const summary = useMemo(() => treeSummary(project), [project]);
  const nonBinaryInternals =
    summary.internalCount - Math.round(summary.resolution * summary.internalCount);
  const continuousChars = project.characters.filter((c) => c.type === 'continuous');
  const continuousResults = useMemo(
    () =>
      continuousChars.map((c) => ({
        character: c,
        result: blombergK(project, c),
        reason: blombergKBlockReason(project, c),
      })),
    [project, continuousChars],
  );

  // Focus trap + Esc close + initial focus.
  const ref = useDialogFocus(open, onClose);

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

        {/* Tree summary statistics (3.2) */}
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
                <span>{mp ? mp.cost : 0}</span>
              </div>
              <div className="hint">{S.analysis.fillHint}</div>
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
                          select(it.nodeId);
                          onClose();
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
                    const row = tests?.find((x) => x.test.aId === c.aId && x.test.bId === c.bId);
                    return (
                      <li key={`${c.aId}-${c.bId}`} className="issue issue-info">
                        <div>
                          {c.aName} ↔ {c.bName} · {S.analysis.correlationType}:{' '}
                          {Math.round(c.score * 100)}% ·{' '}
                          {S.analysis.correlationSample(c.sampleSize)}
                        </div>
                        <div className="hint">
                          {S.analysis.correlationShared(c.shared, c.aBranches, c.bBranches)} ·{' '}
                          {S.analysis.correlationExpected(c.expectedShared)}
                        </div>
                        {/* The faded / "(not significant)" grading of an
                            invalid p-value is gone. Opacity encodes the
                            DESCRIPTIVE overlap band, which is what the number
                            actually is; the verdict, when there is one, is the
                            Holm-adjusted p of a test that was really run. */}
                        {row ? (
                          <div className="hint">
                            <strong>{S.analysis.correlationPValue}</strong>{' '}
                            {S.analysis.correlationPSummary(row.test.pValue, row.test.permutations, row.test.resolution)}{' '}
                            · {S.analysis.correlationNullMean(row.test.nullMean)}
                            <div>
                              <strong>{S.analysis.correlationPAdjusted}</strong>{' '}
                              {row.adjusted.toFixed(4)} ·{' '}
                              {row.adjusted <= 0.05
                                ? S.analysis.correlationVerdictYes
                                : S.analysis.correlationVerdictNo}
                            </div>
                            <div>{S.analysis.correlationTestMethod(row.test.method)}</div>
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
              </div>
              {tests && tests.length > 0 && (
                <>
                  <div className="hint">
                    <strong>{S.analysis.correlationAllTestedTitle}</strong>
                  </div>
                  <ul className="issue-list">
                    {tests.map(({ test, adjusted }) => (
                      <li key={`all-${test.aId}-${test.bId}`} className="issue issue-info">
                        <div>
                          {test.aName} ↔ {test.bName} · {S.analysis.correlationType}:{' '}
                          {Math.round(test.score * 100)}%
                        </div>
                        <div className="hint">
                          {S.analysis.correlationPSummary(test.pValue, test.permutations, test.resolution)}{' '}
                          ·{' '}
                          <strong>{S.analysis.correlationPAdjusted}</strong> {adjusted.toFixed(4)} ·{' '}
                          {adjusted <= 0.05
                            ? S.analysis.correlationVerdictYes
                            : S.analysis.correlationVerdictNo}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="hint">
                    {S.analysis.correlationSignificant(tests.filter((r) => r.adjusted <= 0.05).length)}{' '}
                    · {S.analysis.correlationMultiTest(tests.length)}
                    {tested && tested.skipped > 0 ? ` · ${S.analysis.correlationSkippedPairs(tested.skipped)}` : ''}
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
            {continuousResults.map(({ character: c, result, reason }) => (
              <div key={c.id} className="field">
                <label>{c.name}</label>
                <span>
                  {result ? (
                    <>
                      {/* No verdict words ("保守演化" / "过度分散") appear: they
                          would assert an evolutionary conclusion from a point
                          estimate nobody tested. */}
                      {S.analysis.blombergK}: {result.k.toFixed(3)} (n = {result.n}) ·{' '}
                      {S.analysis.blombergKScale(result.imputedBranches, result.totalBranches)}
                    </>
                  ) : reason ? (
                    S.analysis.continuousBlockedReason(reason)
                  ) : (
                    S.analysis.continuousNone
                  )}
                </span>
              </div>
            ))}
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
              {/* Only the equal-rates Mk model is implemented; the closed-form
                  transition matrix in model/asr.ts is ER by construction. */}
              <select
                value={asrOptions.model}
                onChange={(e) => setAsrOptions({ model: e.target.value as 'ER' })}
              >
                <option value="ER">{S.analysis.asrModelER}</option>
              </select>
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
                onClick={runAsr}
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
                <label>{S.analysis.asrResultSummary}</label>
                <span>
                  {asr.model} ·{' '}
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
