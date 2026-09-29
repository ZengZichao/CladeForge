// Style presets (themes). Each preset writes the project-wide style DEFAULTS
// (node fill/stroke/label colour, branch colour) and the canvas background, so
// every node/branch that has no per-object override adopts the theme at once.
// Per-object overrides are intentionally preserved.

import type { Project } from './types';

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
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'default',
    label: '默认',
    labelEn: 'Default',
    background: '#ffffff',
    nodeFill: '#ffffff',
    nodeStroke: '#1a1a1a',
    labelColor: '#1a1a1a',
    branchColor: '#3a3a3a',
  },
  {
    id: 'journal',
    label: '期刊黑白',
    labelEn: 'Journal B/W',
    background: '#ffffff',
    nodeFill: '#ffffff',
    nodeStroke: '#000000',
    labelColor: '#000000',
    branchColor: '#000000',
  },
  {
    id: 'presentation',
    label: '演示彩色',
    labelEn: 'Presentation',
    background: '#f8fafc',
    nodeFill: '#33658a',
    nodeStroke: '#24486a',
    labelColor: '#1a1a1a',
    branchColor: '#33658a',
  },
  {
    id: 'dark',
    label: '暗色',
    labelEn: 'Dark',
    background: '#1a1816',
    nodeFill: '#282623',
    nodeStroke: '#e8e6e3',
    labelColor: '#e8e6e3',
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
}
