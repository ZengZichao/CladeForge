// Plain-language results for the three tree-edit actions that return more than a
// "done".
//
// Extracted from `ContextMenu.tsx` / `CommandPalette.tsx` / `TimePanel.tsx` so
// the wording is testable without rendering (the repository's test net covers
// `.ts` only — same reason `fileMenu.ts`, `deleteGuard.ts` and `reconStats.ts`
// exist). All three entry points share these strings, so the menu, the command
// palette and the time panel describe the same outcome identically.
//
// What each action guarantees:
//
//  * `outgroupReroot` returns a reason when it REFUSES (the selected clade
//    already hangs off the current root, a node vanished, …), and the caller
//    shows it, so a refused re-root never reads as a successful no-op.
//  * `applyMidpointReroot` reports the patristic diameter it measured and how
//    many branches it had to EXCLUDE because they carry no usable length. Those
//    branches are not priced as length 1 — that would put the "midpoint" at the
//    nearest node on the path.
//  * `estimateAges` reports how many ages it filled versus preserved, and in
//    which unit. With no absolute age anywhere the numbers it writes are EDGE
//    COUNTS, so the message says so instead of letting the axis read as an
//    absolute Ma scale.

import type {
  EstimateAgesResult,
  MidpointResult,
  OutgroupRerootFailure,
} from '../model/treeOps';
import { tr } from './strings';

/** Why an outgroup re-root is impossible, in words; `null` failure means "go ahead". */
export function outgroupFailureText(reason: OutgroupRerootFailure | null): string | null {
  switch (reason) {
    case null:
      return null;
    case 'empty-selection':
      return tr(
        '没有选中任何节点，无法以选定类群为外群定根。',
        'Nothing is selected, so there is no outgroup to root on.',
      );
    case 'node-missing':
      return tr(
        '选中的节点已不在当前树中（可能刚被删除或撤销），无法定根。',
        'A selected node is no longer in this tree (deleted or undone), so the re-root was skipped.',
      );
    case 'outgroup-is-root':
      return tr(
        '选定类群的最近共同祖先就是当前的根：外群已经挂在根上了，没有可以移根的枝。',
        'The most recent common ancestor of the selection IS the current root: the outgroup already hangs off the root, so there is no branch to move it onto.',
      );
    case 'unrootable':
      return tr(
        '树形结构不支持这次移根（找不到可放置新根的枝）。',
        'The tree structure cannot host this re-root (no branch could take the new root).',
      );
    default:
      return tr('无法以选定类群为外群定根。', 'The outgroup re-root could not be performed.');
  }
}

/** The outcome of a midpoint re-root: the measured diameter, and what was skipped. */
export function midpointText(result: MidpointResult): string {
  if (!result.ok) {
    return result.failure === 'too-small'
      ? tr(
          '树的节点太少（少于 3 个），无法测量尖-尖距离，中点定根未执行。',
          'Fewer than three nodes: no tip-to-tip path can be measured, so midpoint rooting was skipped.',
        )
      : tr(
          '树内没有任何可用枝长（缺失、0 或负值），中点定根未执行。',
          'No usable branch length exists in this tree (missing, zero or negative), so midpoint rooting was skipped.',
        );
  }
  const p = result.placement;
  if (!p) {
    return tr('中点定根已完成。', 'Midpoint rooting completed.');
  }
  const head = tr(
    `已在最长尖-尖路径的中点定根：树径 = ${formatDiameter(p.diameter)} 个枝长单位（新根落在枝内，不是某个节点上）。`,
    `Rooted at the midpoint of the longest tip-to-tip path: diameter = ${formatDiameter(p.diameter)} branch-length units (the new root sits INSIDE a branch, not on a node).`,
  );
  if (p.complete) return head;
  return (
    head +
    tr(
      `注意：${p.unknownEdges} 条分支没有可用枝长，已被排除在直径测量之外（没有按 1 计入），所以这个直径只覆盖树的一部分。`,
      ` Note that ${p.unknownEdges} branch(es) had no usable length and were EXCLUDED from the measurement (not priced as 1), so this diameter covers only part of the tree.`,
    )
  );
}

/** What "estimate ages from topology" actually wrote, and in what unit. */
export function estimateAgesText(result: EstimateAgesResult): string {
  const { filled, preserved, unit, timeUnit, calibrationAge, tipsAssumedPresent, changed } = result;
  if (!changed) {
    return tr(
      `没有需要填补的年代：${preserved} 个节点年代全部为你已输入的值，估算不会覆盖它们。`,
      `Nothing to fill: all ${preserved} node age(s) are values you entered, and estimation never overwrites those.`,
    );
  }
  const head = tr(
    `已按拓扑估算 ${filled.length} 个节点年代，保留你已输入的 ${preserved} 个。`,
    `Estimated ages for ${filled.length} node(s); kept the ${preserved} you had entered.`,
  );
  const tips =
    tipsAssumedPresent > 0
      ? tr(
          `${tipsAssumedPresent} 个尖端本无年代，已按现生（年代 0）处理。`,
          ` ${tipsAssumedPresent} tip(s) had no age and were read as extant (age 0).`,
        )
      : '';
  const scale =
    unit === 'relative'
      ? tr(
          `单位是分支数（相对时间），不是${timeUnit}：时间轴现在每格代表一条分支，请勿当作绝对年代读数。`,
          ` The values are EDGE COUNTS (relative time), not ${timeUnit}: the axis now spends one unit per branch, so do not read it as absolute age.`,
        )
      : tr(
          `数值已按你填写的最深年代 ${formatDiameter(calibrationAge)} ${timeUnit} 定标，与时间轴同单位。`,
          ` Scaled onto your deepest entered age, ${formatDiameter(calibrationAge)} ${timeUnit}, so the numbers share the time axis's unit.`,
        );
  return head + tips + scale;
}

/** Trim float noise so "5.000000000000001 个枝长单位" never reaches the UI. */
function formatDiameter(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
