// Derived per-gene-tree view model for the reconciliation panel.
//
// Extracted from `ReconPanel.tsx` so the counting rules are testable without
// rendering the panel (the repository's test net covers `.ts` only).
//
// "已映射尖端" is a union, not a sum. A tip counts as mapped when at least one of
// the two sources — label hits, or an explicit assumption — says so. The sources
// overlap: `suggestLcaScenario` writes a `speciesNode` assumption FOR THE TIPS it
// just mapped by label, so adding the two counts every auto-mapped tip twice and
// the panel can read "240/120".

import { mapTipsByLabel, scenarioSummary, validateScenario, type ReconIssue } from '../model/reconciliation';
import type { GeneTreeEntry, NodeId, Project, ReconCosts } from '../model/types';

/** What `scenarioSummary` reports for one gene tree (its type is inline). */
export type GeneSummary = ReturnType<typeof scenarioSummary>;

export interface GeneRow {
  id: string;
  name: string;
  /** Tips of the gene tree. */
  tips: number;
  /** Tips whose placement is known — label mapping OR an assumption. */
  mappedTips: number;
  /** Tips with neither: they can never take part in the scenario. */
  unmappedTips: number;
  summary: GeneSummary;
  issues: ReconIssue[];
  errors: number;
  warnings: number;
  /** Gene-tip labels with no species counterpart. */
  unmatchedLabels: string[];
  /** Labels dropped because several species tips share them. */
  ambiguousLabels: string[];
}

/**
 * Distinct gene tips whose species placement is known, either from the label
 * mapping or from an explicit assumption. `assumed` keys are gene node ids.
 */
export function countMappedTips(
  entry: GeneTreeEntry,
  tipMappings: Record<NodeId, NodeId | null>,
): number {
  let mapped = 0;
  for (const n of Object.values(entry.doc.nodes)) {
    if (n.childrenIds.length > 0) continue;
    const fromLabel = tipMappings[n.id] != null;
    const fromAssumption = entry.assumptions[n.id]?.speciesNode != null;
    if (fromLabel || fromAssumption) mapped += 1;
  }
  return mapped;
}

export function geneTreeRows(project: Project): GeneRow[] {
  const costs: ReconCosts = project.reconCosts ?? { dup: 1, transfer: 2, loss: 1 };
  return (project.geneTrees ?? []).map((entry) => {
    const { mappings, unmatchedLabels, ambiguousLabels } = mapTipsByLabel(project, entry.doc);
    const tips = Object.values(entry.doc.nodes).filter((n) => n.childrenIds.length === 0).length;
    const mappedTips = Math.min(tips, countMappedTips(entry, mappings));
    const issues = validateScenario(project, entry.doc, entry.assumptions, costs);
    const errors = issues.filter((i) => i.severity === 'error').length;
    return {
      id: entry.id,
      name: entry.name,
      tips,
      mappedTips,
      unmappedTips: tips - mappedTips,
      summary: scenarioSummary(entry.doc, entry.assumptions, costs),
      issues,
      errors,
      warnings: issues.length - errors,
      unmatchedLabels,
      ambiguousLabels,
    };
  });
}
