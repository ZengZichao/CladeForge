// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import { DEFAULT_NODE_STYLE, defaultStyleDefaults, resolveNodeStyle } from './types';
import { createEmptyProject } from './sampleTree';

/**
 * H-D5: a label drawn across its own branch was unreadable, and the halo that
 * fixes it (`style.labelHalo`) defaulted off. The default is now on — but only
 * as a DEFAULT: a node that explicitly turns the halo off must keep it off.
 */
describe('node label halo default', () => {
  it('is on in DEFAULT_NODE_STYLE', () => {
    expect(DEFAULT_NODE_STYLE.labelHalo).toBe(true);
  });

  it('reaches new documents through the style defaults', () => {
    expect(defaultStyleDefaults().node.labelHalo).toBe(true);
    expect(createEmptyProject('halo').defaults.node.labelHalo).toBe(true);
  });

  it('an explicit per-node value still wins over the default', () => {
    const project = createEmptyProject('halo-override');
    const root = project.nodes[project.rootId];
    expect(resolveNodeStyle(root, project).labelHalo).toBe(true);
    root.style = { labelHalo: false };
    expect(resolveNodeStyle(root, project).labelHalo).toBe(false);
  });
});
