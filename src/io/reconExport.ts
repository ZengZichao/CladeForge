// Reconciliation report exports.
//
// buildReconciliationReport(): human-readable Markdown covering every embedded
// gene tree — placement/event table, event counts, scenario cost under the
// project's DTL cost vector, validation issues, plus the reconciled topology
// itself annotated with `[&&NHX:...]` tags so external tools can consume it.

import { tr } from '../ui/strings';
import type { GeneNodeAssumption, NodeId, Project } from '../model/types';
import { mapTipsByLabel, validateScenario } from '../model/reconciliation';
import { escapeName } from './newick';

/**
 * Make a string safe to drop into the Markdown document.
 *
 * Only the characters that actually break the output are handled: `\` is doubled
 * first, because a literal backslash changes what every later escape means
 * (`T4\|phage` must come out as `T4\\\|phage`, or the renderer reads an escaped
 * backslash glued to a live cell separator); `|` splits a table row into extra
 * columns; and a line break ends the row (or the heading) wherever it appears.
 * Deliberately NOT `escapeName()`: that wraps any label
 * containing a space in double quotes, which is correct Newick and wrong here —
 * a report titled `Reconciliation report — "My Project"`, and a table cell
 * reading “"T4 phage"”, are both quoting bugs wearing a label.
 */
function esc(s: string): string {
  // Backslash doubling runs FIRST — the pipe rule inserts a backslash of its own,
  // and the doubling rule must not see it — then `<` and `>`, then the line break,
  // then the pipe LAST.
  return s
    .replace(/\\/g, '\\\\')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\|/g, '\\|');
}

function speciesLabel(project: Project, id: NodeId): string {
  return project.nodes[id]?.label || id.slice(0, 6);
}

/** Species label actually in effect for a gene node (assumption or label match). */
function effectiveMapping(
  project: Project,
  gene: Project,
  n: { id: NodeId },
  assumptions: Record<NodeId, GeneNodeAssumption>,
  tipFallback: Record<NodeId, NodeId | null>,
): NodeId | null {
  return assumptions[n.id]?.speciesNode ?? (gene.nodes[n.id].childrenIds.length === 0 ? tipFallback[n.id] : null) ?? null;
}

/**
 * NHX tag values cannot contain the characters the tag syntax itself is built
 * from, so they are folded to `_`. A species label with a colon ("Bacillus :
 * sp.") would otherwise silently split one tag into two.
 */
function nhxValue(s: string): string {
  return s.replace(/[[\]:;,=]/g, '_');
}

/** Species node ids in the subtree rooted at `id` (iterative: deep trees). */
function speciesSubtree(species: Project, id: NodeId): Set<NodeId> {
  const out = new Set<NodeId>();
  const stack: NodeId[] = [id];
  while (stack.length) {
    const cur = stack.pop() as NodeId;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of species.nodes[cur]?.childrenIds ?? []) stack.push(c);
  }
  return out;
}

/**
 * Newick string of the gene tree annotated with minimal NHX tags.
 *
 * Unlike `serializeNewick`, this writer is complete for a reconciliation:
 *   * branch lengths are emitted, so an NHX consumer keeps the gene tree's own
 *     scale;
 *   * losses are emitted on TIP branches too, because `suggestLcaScenario`
 *     records losses there and an internal-only branch would hide them;
 *   * a transfer carries the inferred donor in the CladeForge extension key
 *     `TD=` — plain NHX `T=true` cannot express which branch donated, so the
 *     event would be unrecoverable downstream;
 *   * the walk is iterative, matching newick.ts, so a pectinate gene tree cannot
 *     overflow the call stack.
 */
export function geneTreeNhk(project: Project, gene: Project, assumptions: Record<NodeId, GeneNodeAssumption>): string {
  const tipMap = mapTipsByLabel(project, gene).mappings;
  const parts = new Map<NodeId, string>();
  const order: NodeId[] = [];
  const stack: NodeId[] = [gene.rootId];
  while (stack.length) {
    const id = stack.pop() as NodeId;
    const n = gene.nodes[id];
    if (!n) continue;
    order.push(id);
    for (const c of n.childrenIds) stack.push(c);
  }
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const id = order[k];
    const n = gene.nodes[id];
    if (!n) continue;
    const kids = n.childrenIds.map((c) => parts.get(c) ?? '');
    const self = kids.length > 0 ? `(${kids.join(',')})` : '';
    const label = n.label ? escapeName(n.label) : escapeName(id.slice(0, 5));
    const bl =
      typeof n.branchLength === 'number' && Number.isFinite(n.branchLength) && n.branchLength >= 0
        ? `:${n.branchLength}`
        : '';
    const mapTo = effectiveMapping(project, gene, n, assumptions, tipMap);
    const a = assumptions[id];
    const tagParts: string[] = [];
    if (mapTo) tagParts.push(`S=${nhxValue(speciesLabel(project, mapTo))}`);
    if (n.childrenIds.length > 0) {
      if (a?.event === 'speciation') tagParts.push('E=speciation');
      if (a?.event === 'duplication') tagParts.push('D=true');
      if (a?.event === 'transfer') {
        tagParts.push('T=true');
        // Donor = the child placed outside the recipient's species subtree,
        // the same feasibility criterion validateScenario applies.
        if (mapTo) {
          const inside = speciesSubtree(project, mapTo);
          const donor = n.childrenIds
            .map((c) => gene.nodes[c])
            .filter(Boolean)
            .map((c) => effectiveMapping(project, gene, c, assumptions, tipMap))
            .find((m): m is NodeId => !!m && !inside.has(m));
          if (donor) tagParts.push(`TD=${nhxValue(speciesLabel(project, donor))}`);
        }
      }
    }
    // Losses belong to the branch entering a node — including a tip branch.
    if ((a?.losses ?? 0) > 0) tagParts.push(`L=${a!.losses}`);
    parts.set(id, `${self}${label}${bl}${tagParts.length ? `[&&NHX:${tagParts.join(':')}]` : ''}`);
  }
  return `${parts.get(gene.rootId) ?? ''};`;
}

/** Full Markdown reconciliation report for every gene tree in the project. */
export function buildReconciliationReport(project: Project): string {
  const c = project.reconCosts ?? { dup: 1, transfer: 2, loss: 1 };
  const L: string[] = [];
  L.push(`# ${tr('协同重建报告', 'Reconciliation report')} — ${esc(project.name || 'CladeForge')}`);
  L.push('');
  L.push(
    tr(
      `代价向量：加倍 δ=${c.dup} · 转移 τ=${c.transfer} · 损失 λ=${c.loss} （物种化 σ 计为 0）`,
      `Costs: duplication δ=${c.dup}, transfer τ=${c.transfer}, loss λ=${c.loss} (speciation σ = 0).`,
    ),
  );
  L.push('');

  const trees = project.geneTrees ?? [];
  if (trees.length === 0) {
    L.push(`> ${tr('本项目中没有嵌入的基因树。', 'No embedded gene trees in this project.')}`);
    return `${L.join('\n')}\n`;
  }

  for (const g of trees) {
    const tipMap = mapTipsByLabel(project, g.doc).mappings;
    L.push(`## ${esc(g.name)}`);
    L.push('');
    const counts = { sigma: 0, delta: 0, tau: 0, loss: 0 };
    let mappedInternal = 0;
    let totalInternal = 0;

    type Row = [string, string, string, string];
    const rows: Row[] = [];
    for (const n of Object.values(g.doc.nodes)) {
      const internal = n.childrenIds.length > 0;
      if (internal) totalInternal += 1;
      const mapTo = effectiveMapping(project, g.doc, n, g.assumptions, tipMap);
      const a = g.assumptions[n.id];
      if (!internal && !a && !mapTo) continue;
      if (internal && a) mappedInternal += 1;
      if (a?.event === 'speciation') counts.sigma += 1;
      else if (a?.event === 'duplication') counts.delta += 1;
      else if (a?.event === 'transfer') counts.tau += 1;
      counts.loss += Math.max(0, a?.losses ?? 0);
      rows.push([
        esc(n.label || n.id.slice(0, 6)),
        internal ? tr('内部', 'internal') : tr('尖端', 'tip'),
        mapTo ? esc(speciesLabel(project, mapTo)) : '—',
        [
          a?.event === 'speciation' ? 'σ' : '',
          a?.event === 'duplication' ? 'δ' : '',
          a?.event === 'transfer' ? 'τ' : '',
          (a?.losses ?? 0) > 0 ? `λ${a!.losses}` : '',
        ].join(' ') || '—',
      ]);
    }

    const cost =
      counts.delta * c.dup + counts.tau * c.transfer + counts.loss * c.loss;

    L.push(
      tr(
        `- 尖端 ${tipCountOf(g.doc)} 个；已映射内部节点 ${mappedInternal}/${totalInternal}`,
        `- ${tipCountOf(g.doc)} tips; resolved internal nodes ${mappedInternal}/${totalInternal}.`,
      ),
    );
    L.push(
      tr(
        `- 事件统计：σ ${counts.sigma} · δ ${counts.delta} · τ ${counts.tau} · λ ${counts.loss}`,
        `- Events: σ ${counts.sigma}, δ ${counts.delta}, τ ${counts.tau}, λ ${counts.loss}.`,
      ),
    );
    L.push(tr(`- 场景总代价：**${cost}**`, `- Total scenario cost: **${cost}**.`));
    L.push('');

    // Issues
    const issues = validateScenario(project, g.doc, g.assumptions, c);
    if (issues.length > 0) {
      L.push(`### ${tr('校验问题', 'Validation issues')}`);
      L.push('');
      for (const it of issues) {
        L.push(`- \`${it.severity === 'error' ? tr('错误', 'error') : tr('提示', 'note')}\` ${esc(it.message)}`);
      }
      L.push('');
    } else {
      L.push(`> ✓ ${tr('校验通过：无不一致。', 'Validation passed with no inconsistencies.')}`);
      L.push('');
    }

    // Placement table
    L.push(`### ${tr('映射与事件', 'Placements & events')}`);
    L.push('');
    L.push(
      `| ${tr('基因节点', 'gene node')} | ${tr('类型', 'type')} | ${tr('物种靶点', 'species target')} | ${tr('事件/损失', 'events/losses')} |`,
    );
    L.push('| --- | --- | --- | --- |');
    for (const r of rows) L.push(`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`);
    L.push('');

    // Annotated topology
    L.push(`### ${tr('注释拓扑 (Newick + NHX)', 'Annotated topology (Newick + NHX)')}`);
    L.push('```newick');
    L.push(geneTreeNhk(project, g.doc, g.assumptions));
    L.push('```');
    L.push('');
  }
  return `${L.join('\n')}\n`;
}

// tiny local helper kept tiny on purpose
function tipCountOf(doc: Project): number {
  return Object.values(doc.nodes).filter((n) => n.childrenIds.length === 0).length;
}
