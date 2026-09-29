// @vitest-environment jsdom
// Regression coverage for the custom-edge selection bug: the pointer hit lands
// on the fat transparent CHILD path while data-edge-id lives on the parent
// <g>, so resolution must walk up via closest().

import { describe, it, expect } from 'vitest';
import { hitTargetFor } from './hitTarget';

function svg(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = `<svg>${html}</svg>`;
  return host.firstElementChild!;
}

describe('hitTargetFor', () => {
  it('resolves a custom edge when the hit lands on its child hit-path', () => {
    const root = svg(
      `<g data-role="custom-edge" data-edge-id="e1">
         <path id="hit" stroke="transparent" />
         <path id="vis" stroke="#333" />
       </g>`,
    );
    const hit = hitTargetFor(root.querySelector('#hit'));
    expect(hit).toEqual({ role: 'custom-edge', nodeId: null, edgeId: 'e1' });
    // The visible stroke child resolves identically.
    expect(hitTargetFor(root.querySelector('#vis')).edgeId).toBe('e1');
  });

  it('prefers the port over the enclosing node group', () => {
    const root = svg(
      `<g data-role="node" data-node-id="n1">
         <circle id="dot" data-role="port" data-node-id="n1" />
         <circle id="body" data-role="node" data-node-id="n1" />
       </g>`,
    );
    expect(hitTargetFor(root.querySelector('#dot'))).toEqual({
      role: 'port',
      nodeId: 'n1',
      edgeId: null,
    });
    expect(hitTargetFor(root.querySelector('#body'))).toEqual({
      role: 'node',
      nodeId: 'n1',
      edgeId: null,
    });
  });

  it('still resolves elements that carry their own attributes', () => {
    const root = svg(`<circle id="c" data-role="node" data-node-id="n2" />`);
    expect(hitTargetFor(root.querySelector('#c'))).toEqual({
      role: 'node',
      nodeId: 'n2',
      edgeId: null,
    });
  });

  it('returns nulls for background / non-canvas targets', () => {
    const root = svg(`<rect id="bg" data-role="background" />`);
    expect(hitTargetFor(root.querySelector('#bg'))).toEqual({
      role: null,
      nodeId: null,
      edgeId: null,
    });
    expect(hitTargetFor(null)).toEqual({ role: null, nodeId: null, edgeId: null });
  });
});
