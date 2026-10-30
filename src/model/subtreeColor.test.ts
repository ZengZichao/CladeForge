// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addChildren, setSubtreeBranchColor } from './treeOps';

describe('setSubtreeBranchColor', () => {
  it('colours the selected incoming branch and every descendant, but not siblings or ancestors', () => {
    const p = createEmptyProject('subtree-colour');
    const [selected, sibling] = addChildren(p, p.rootId, 2);
    const [descendant] = addChildren(p, selected, 1);
    const [deep] = addChildren(p, descendant, 1);
    p.nodes[sibling].branchStyle = { color: '#123456' };

    const changed = setSubtreeBranchColor(p, selected, '#ff0000');

    expect(changed).toBe(3); // selected + descendant + deep
    expect(p.nodes[selected].branchStyle?.color).toBe('#ff0000');
    expect(p.nodes[descendant].branchStyle?.color).toBe('#ff0000');
    expect(p.nodes[deep].branchStyle?.color).toBe('#ff0000');
    // Sibling stays exactly as it was; root has no incoming branch to colour.
    expect(p.nodes[sibling].branchStyle?.color).toBe('#123456');
    expect(p.nodes[p.rootId].branchStyle).toBeUndefined();
  });

  it('keeps other branch style fields while replacing only the colour', () => {
    const p = createEmptyProject('subtree-style');
    const [selected] = addChildren(p, p.rootId, 2);
    p.nodes[selected].branchStyle = { width: 6, dash: 'dashed', color: '#000000' };
    setSubtreeBranchColor(p, selected, '#00ff00');
    expect(p.nodes[selected].branchStyle).toEqual({
      width: 6,
      dash: 'dashed',
      color: '#00ff00',
    });
  });
});
