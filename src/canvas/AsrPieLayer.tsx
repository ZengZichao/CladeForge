// Ancestral-state probability pies. For each on-screen INTERNAL node, draws a
// pie whose wedges are the posterior state probabilities from the
// Mk reconstruction — a near-solid pie means a confident inference, a split pie
// marks an uncertain node (where a hypothesis is needed). Tips are omitted (they
// are certain and already coloured by the node markers). Hover shows the numbers.
//
// The display cut-off is the reconstruction's OWN `threshold` (asr.ts
// AsrOptions.threshold, echoed on AsrResult and driven by the slider in the
// analysis dialog), not a constant invented here: a hard-coded 0.001 / 0.999
// would reduce that slider to a decorative control.
//
//   * a state whose posterior is below `threshold` is not drawn at all;
//   * when one state holds at least 1 − threshold of the mass every other state
//     is under the cut-off by definition, so the node is drawn as a solid disc
//     (and the degenerate hairline arc is avoided);
//   * a node whose whole posterior fell below the cut-off is UNCERTAIN, not
//     unsupported: it is drawn hollow (grey ring) so "the data is diffuse here"
//     stays visible instead of the pie silently vanishing.

import { memo, type ReactElement } from 'react';
import { useStore } from '../model/store';
import type { NodeId, Point, TreeNode } from '../model/types';

/** World-space pie radius; the screen-space floor below keeps it clickable. */
const R = 9;
/** Minimum on-screen radius (px): below this zoom the pie would vanish. */
const MIN_SCREEN_R = 3.5;

/**
 * Wedge plan for one node: which states are shown and whether the pie collapses
 * to a single solid colour. Kept as a pure function so the canvas layer and the
 * figure exporter (io/exportImage.ts) apply exactly the same rule.
 */
export function asrWedgePlan(
  probs: number[],
  threshold: number,
): { shown: number[]; solidIndex: number; anyMass: boolean } {
  const t = Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0;
  const shown: number[] = [];
  let solidIndex = -1;
  let anyMass = false;
  for (let i = 0; i < probs.length; i += 1) {
    const p = probs[i];
    if (!(p > 0)) continue; // no mass → no wedge, whatever the threshold says
    anyMass = true;
    if (p < t) continue; // below the display threshold, so not drawn
    shown.push(i);
    if (p >= 1 - t) solidIndex = i;
  }
  return { shown, solidIndex, anyMass };
}

export const AsrPieLayer = memo(function AsrPieLayer({
  probs,
  states,
  positions,
  nodes,
  culled,
  threshold,
}: {
  probs: Map<NodeId, number[]>;
  states: { label: string; color: string }[];
  positions: Map<NodeId, Point>;
  nodes: Record<string, TreeNode>;
  culled: Set<NodeId>;
  /** Display cut-off carried by the ASR result, not a local constant. */
  threshold: number;
}) {
  const scale = useStore((s) => s.view.scale);
  // Screen-space radius floor: `r_world = max(R, min_screen / scale)`.
  const r = Math.max(R, MIN_SCREEN_R / Math.max(scale, 0.01));
  const pies: ReactElement[] = [];
  for (const [id, p] of probs) {
    const node = nodes[id];
    if (!node || node.childrenIds.length === 0) continue; // internal nodes only
    if (p.length !== states.length) continue; // dimension mismatch (stale asr) → skip
    if (culled.size > 0 && !culled.has(id)) continue; // on-screen only
    const pos = positions.get(id);
    if (!pos) continue;

    const { shown, solidIndex, anyMass } = asrWedgePlan(p, threshold);
    if (!anyMass) continue; // no data at all — nothing meaningful to draw
    const wedges: ReactElement[] = [];
    let a = -Math.PI / 2;
    if (solidIndex >= 0) {
      wedges.push(
        <circle key={solidIndex} cx={pos.x} cy={pos.y} r={r} fill={states[solidIndex]?.color} />,
      );
    } else if (shown.length > 0) {
      for (const i of shown) {
        const frac = p[i];
        const a1 = a + frac * Math.PI * 2;
        const x0 = pos.x + r * Math.cos(a);
        const y0 = pos.y + r * Math.sin(a);
        const x1 = pos.x + r * Math.cos(a1);
        const y1 = pos.y + r * Math.sin(a1);
        const large = frac > 0.5 ? 1 : 0;
        wedges.push(
          <path
            key={i}
            d={`M ${pos.x} ${pos.y} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`}
            fill={states[i]?.color}
          />,
        );
        a = a1;
      }
    }
    // Uncertain (real posterior, nothing clears the threshold): a hollow grey
    // ring — visible, honest, and clearly NOT a confident single state.

    // The hover tooltip used to be unreachable: the whole group carried
    // `pointerEvents="none"`, so `<title>` never fired and the manual's
    // "hover to read the posteriors" was dead text. A transparent hit disc
    // now carries the hover; the visible wedges stay click-through.
    const title = states
      .map((s, i) => `${s.label} ${(p[i] * 100).toFixed(0)}%`)
      .join('\n');
    pies.push(
      <g key={id}>
        {wedges}
        {shown.length === 0 && (
          <circle cx={pos.x} cy={pos.y} r={r} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="2 1.6" />
        )}
        <circle cx={pos.x} cy={pos.y} r={r} fill="none" stroke="var(--text)" strokeWidth={0.75} />
        <circle cx={pos.x} cy={pos.y} r={Math.max(r, 7)} fill="transparent">
          <title>{title}</title>
        </circle>
      </g>,
    );
  }
  return <g>{pies}</g>;
});
