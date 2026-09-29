// Resolve WHICH interactive canvas element sits under a pointer event.
//
// The data-* attributes live on group wrappers (custom edges mark their
// <g data-role="custom-edge" data-edge-id>, nodes mark shapes/ports), but the
// physical hit often lands on a CHILD element (the fat transparent selection
// path of a custom edge, a label, a port dot). Reading e.target's own
// attributes therefore misses — a click on a custom edge lands on that child
// and would otherwise fall through to the background gesture, clearing the
// selection on pointer-up. Resolving through closest() makes bubbling/child
// hits behave identically to direct hits, for every canvas surface at once.

import type { EdgeId, NodeId } from '../model/types';

export interface HitTarget {
  role: 'port' | 'custom-edge' | 'node' | null;
  nodeId: NodeId | null;
  edgeId: EdgeId | null;
}

const NULL_HIT: HitTarget = { role: null, nodeId: null, edgeId: null };

export function hitTargetFor(target: EventTarget | null): HitTarget {
  const el = target instanceof Element ? target : null;
  if (!el || typeof el.closest !== 'function') return NULL_HIT;

  // Priority: port ⊃ custom-edge ⊃ node. The port dot renders inside the
  // node group, so it must win over the node branch; a node group also
  // contains label/hit children that should select the node.
  const port = el.closest('[data-role="port"]');
  if (port) {
    return { role: 'port', nodeId: port.getAttribute('data-node-id'), edgeId: null };
  }
  const edge = el.closest('[data-role="custom-edge"]');
  if (edge) {
    return { role: 'custom-edge', nodeId: null, edgeId: edge.getAttribute('data-edge-id') };
  }
  const node = el.closest('[data-role="node"], [data-node-id]');
  if (node) {
    const role = node.getAttribute('data-role');
    return {
      role: role === 'port' ? 'port' : 'node',
      nodeId: node.getAttribute('data-node-id'),
      edgeId: null,
    };
  }
  return NULL_HIT;
}
