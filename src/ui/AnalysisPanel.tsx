// Left-column "分析" module panel: tree summary statistics, inference-assist
// summary for the active character (parsimony cost, CI/RI, consistency issues,
// correlations), and the full set of analysis action buttons (matrix, inference,
// ASR) — forming a complete analysis workflow entry point.
//
// This replaces the previous behaviour where the analysis module re-rendered
// the whole CharacterPanel ("性状与状态"), duplicating the hypothesis module.
// Character management stays under 假说; this module is purely analytical.

import { useMemo } from 'react';
import { useStore } from '../model/store';
import { findCharacter } from '../model/characters';
import { parsimony } from '../model/parsimony';
import { discreteSignal, treeSummary } from '../model/stats';
import { characterCorrelations, checkConsistency } from '../model/consistency';
import { Section } from './Section';
import { S, tr } from './strings';

export function AnalysisPanel({
  onOpenMatrix,
  onOpenAnalysis,
}: {
  onOpenMatrix: () => void;
  onOpenAnalysis: () => void;
}) {
  const project = useStore((s) => s.project);
  const activeCharacterId = useStore((s) => s.activeCharacterId);
  const characters = useStore((s) => s.project.characters);
  const runAsr = useStore((s) => s.runAsr);
  const clearAsr = useStore((s) => s.clearAsr);
  const asr = useStore((s) => s.asr);
  const character = findCharacter(project, activeCharacterId ?? '');

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
  const summary = useMemo(() => treeSummary(project), [project]);

  const asrDisabled = !character || character.type !== 'discrete';

  return (
    <>
      <div className="panel-header">
        <span className="panel-header-title">{S.nav.analysis}</span>
        <span className="panel-header-subtitle">{S.analysis.title}</span>
      </div>

      {/* Tree summary statistics */}
      <Section id="analysis-tree-summary" title={S.analysis.treeSummarySection} pinable>
        <div className="field">
          <label>{S.analysis.tipCount}</label>
          <span className="field-value">{summary.tipCount}</span>
        </div>
        <div className="field">
          <label>{S.analysis.internalCount}</label>
          <span className="field-value">{summary.internalCount}</span>
        </div>
        <div className="field">
          <label>{S.analysis.resolution}</label>
          <span className="field-value">{(summary.resolution * 100).toFixed(1)}%</span>
        </div>
        <div className="field">
          <label>{S.analysis.avgBranchLength}</label>
          <span className="field-value">{summary.avgBranchLength.toFixed(3)}</span>
        </div>
        {/* Coverage is shown with the number, so a mean over 3 of 40
            branches cannot be read as a mean over the tree. */}
        {summary.missingBranchLengths > 0 && (
          <div className="hint">
            {S.analysis.branchLengthCoverage(summary.branchLengthNodes, summary.missingBranchLengths)}
          </div>
        )}
        <div className="field">
          <label>{S.analysis.sackinIndex}</label>
          <span className="field-value">{summary.sackinIndex}</span>
        </div>
        <div className="field">
          <label>{S.analysis.collessIndex}</label>
          <span className="field-value">{summary.collessIndex}</span>
        </div>
        {!summary.collessApplies &&
          summary.internalCount - Math.round(summary.resolution * summary.internalCount) > 0 && (
            <div className="hint">
              {S.analysis.collessBinaryOnly(
                summary.internalCount - Math.round(summary.resolution * summary.internalCount),
              )}
            </div>
          )}
      </Section>

      {/* Character-level analysis summary */}
      <Section id="analysis-character" title={S.analysis.title} pinable>
        {!character ? (
          <>
            <div className="hint">{S.analysis.needCharacter}</div>
          </>
        ) : (
          <>
            <div className="field">
              <label>{S.analysis.character}</label>
              <span className="field-value">{character.name}</span>
            </div>
            <div className="field">
              <label>{S.analysis.cost}</label>
              <span className="field-value">{mp ? mp.cost : 0}</span>
            </div>
            {signal ? (
              <div className="field">
                <label>CI / RI</label>
                <span className="field-value">
                  {signal.ci.toFixed(2)} / {signal.ri.toFixed(2)}
                </span>
              </div>
            ) : (
              // A weighted character has no CI/RI at all — say so instead
              // of leaving the row out, which reads as "not enough data".
              <div className="field">
                <label>CI / RI</label>
                <span className="field-value">
                  {character.costMatrix ? S.analysis.signalWeighted : S.analysis.signalNone}
                </span>
              </div>
            )}
            <div className="field">
              <label>{S.analysis.consistencySection}</label>
              <span className="field-value">
                {issues.length === 0 ? S.analysis.consistencyNone : tr(`${issues.length} 处提示`, `${issues.length} note(s)`)}
              </span>
            </div>
            <div className="field">
              <label>{S.analysis.correlationSection}</label>
              <span className="field-value">
                {/* "Correlated" is a conclusion; the count is of pairs that
                    reach the descriptive overlap threshold. */}
                {correlations.length === 0
                  ? S.analysis.correlationNone
                  : tr(
                      `${correlations.length} 对达到 Jaccard 重叠比 ≥ 0.5（描述性，未检验）`,
                      `${correlations.length} pair(s) at Jaccard overlap ≥ 0.5 (descriptive, untested)`,
                    )}
              </span>
            </div>
            <div className="hint">{S.analysis.fillHint}</div>
          </>
        )}
      </Section>

      {/* Analysis action buttons — complete workflow entry points */}
      <Section title={S.analysisMenu.label} pinable>
        <div className="field row-actions">
          <button
            className="btn"
            disabled={characters.length === 0}
            onClick={onOpenMatrix}
          >
            {S.analysisMenu.matrix}
          </button>
          <button
            className="btn primary"
            disabled={characters.length === 0}
            onClick={onOpenAnalysis}
          >
            {S.analysisMenu.inference}
          </button>
        </div>
        <div className="field row-actions">
          <button
            className="btn"
            disabled={asrDisabled}
            title={S.character.asrHint}
            onClick={runAsr}
          >
            {S.analysisMenu.asr}
          </button>
          {asr && (
            <button className="btn ghost" onClick={clearAsr}>
              {S.analysisMenu.clearAsr}
            </button>
          )}
        </div>
      </Section>
    </>
  );
}
