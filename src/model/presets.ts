// Style presets (themes). Each preset writes the project-wide style DEFAULTS
// (node fill/stroke/label colour, branch colour) and the canvas background, so
// every node/branch that has no per-object override adopts the theme at once.
// Per-object overrides are intentionally preserved.

import type { BranchGradient, BranchStyle, Project } from './types';

export interface StylePreset {
  id: string;
  label: string;
  /** English label — picked at display time when the UI language is EN. */
  labelEn: string;
  background: string;
  nodeFill: string;
  nodeStroke: string;
  labelColor: string;
  branchColor: string;
  /** Optional branch restyling (PhyloRec 管道: curved thick tubes). */
  branch?: Partial<Pick<BranchStyle, 'shape' | 'width' | 'opacity'>>;
  /** Optional depth-gradient restyling. */
  gradient?: Partial<BranchGradient>;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'default',
    label: '默认',
    labelEn: 'Default',
    background: '#fcfcfc',
    nodeFill: '#fcfcfc',
    nodeStroke: '#1a1a1a',
    labelColor: '#202020',
    branchColor: '#3a3a3a',
  },
  {
    id: 'journal',
    label: '黑白',
    labelEn: 'B/W',
    background: '#fcfcfc',
    nodeFill: '#fcfcfc',
    nodeStroke: '#000000',
    labelColor: '#202020',
    branchColor: '#000000',
  },
  {
    id: 'presentation',
    label: '彩色',
    labelEn: 'Color',
    background: '#f8fafc',
    nodeFill: '#33658a',
    nodeStroke: '#24486a',
    labelColor: '#202020',
    branchColor: '#33658a',
  },
  {
    // 用户反馈 (2026-11-16): PhyloRecViewer look — smooth curved slate tubes
    // with a fill→stroke depth gradient, paper background.
    id: 'phylo',
    label: 'PhyloRec 管道',
    labelEn: 'PhyloRec tubes',
    background: '#f9f9fb',
    nodeFill: '#fcfcfd',
    nodeStroke: '#1c2024',
    labelColor: '#1c2024',
    branchColor: '#d9d9e0',
    branch: { shape: 'curved', width: 12, opacity: 1 },
    gradient: { enabled: true, from: '#f0f0f3', to: '#d9d9e0' },
  },
  {
    id: 'dark',
    label: '暗色',
    labelEn: 'Dark',
    background: '#1a1816',
    nodeFill: '#282623',
    nodeStroke: '#e8e6e3',
    labelColor: '#eeeeee',
    branchColor: '#9a958f',
  },
];

/** Apply a preset to the project-wide style defaults and canvas background. */
export function applyStylePreset(project: Project, preset: StylePreset): void {
  project.canvas.background = preset.background;
  project.defaults.node.fill = preset.nodeFill;
  project.defaults.node.stroke = preset.nodeStroke;
  project.defaults.node.labelColor = preset.labelColor;
  project.defaults.branch.color = preset.branchColor;
  if (preset.branch) {
    if (preset.branch.shape !== undefined) project.defaults.branch.shape = preset.branch.shape;
    if (preset.branch.width !== undefined) project.defaults.branch.width = preset.branch.width;
    if (preset.branch.opacity !== undefined) project.defaults.branch.opacity = preset.branch.opacity;
  }
  if (preset.gradient) {
    project.defaults.branchGradient = {
      ...project.defaults.branchGradient,
      ...preset.gradient,
    };
  }
}
