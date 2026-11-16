// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// PhyloRecViewer-compatible visual theme for the reconciliation canvas.
// 用户反馈 (2026-11-16): 协调树编辑的视觉效果对齐 PhyloRecViewer —— 物种枝
// 是石板灰圆角管道，基因谱系按家族着色。Colours are exposed as CSS custom
// properties (consumed via inline `style={{ stroke: 'var(--…)' }}` so SVG picks
// them up and the dark theme overrides them in one place).
//
//   --pr-tube-fill / --pr-tube-stroke : species tube gradient ends
//   --pr-gene-<n>                     : per gene-family lineage colours

/** Gene-family categorical palette (Radix steps), index modulo length. */
export const PR_FAMILY_COUNT = 16;

export function prFamilyVar(index: number): string {
  return `var(--pr-gene-${((index % PR_FAMILY_COUNT) + PR_FAMILY_COUNT) % PR_FAMILY_COUNT})`;
}

/** Species tube gradient ends — CSS vars, theme-aware (see app.css). */
export const PR_TUBE_FILL = 'var(--pr-tube-fill)';
export const PR_TUBE_STROKE = 'var(--pr-tube-stroke)';
