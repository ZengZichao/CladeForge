// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Shared node-search matching for the canvas filter box.
//
// The search field lives in CanvasControls, but the MATCHES must be visible on
// the tree itself (GUI-B OBS-03: the box showed a count while the canvas gave no
// cue which nodes matched). Keeping the parser here means the field and the
// highlight can never drift apart.

import type { TreeNode } from '../model/types';

export interface ParsedNodeSearch {
  /** Trimmed raw text, e.g. `type:leaf taxon`. */
  raw: string;
  typeFilter: 'leaf' | 'internal' | null;
  labelText: string;
}

export function parseNodeSearch(query: string): ParsedNodeSearch {
  const raw = query.trim().toLowerCase();
  const typeMatch = /^type:(leaf|internal)\s*(.*)$/.exec(raw);
  if (typeMatch) {
    return { raw, typeFilter: typeMatch[1] as 'leaf' | 'internal', labelText: typeMatch[2].trim() };
  }
  return { raw, typeFilter: null, labelText: raw };
}

/** True when `node` satisfies the query. An empty query matches nothing (the
 *  highlight is only drawn while the user is actually searching). */
export function nodeMatchesSearch(node: TreeNode, query: string): boolean {
  const q = parseNodeSearch(query);
  if (!q.raw) return false;
  if (q.typeFilter === 'leaf' && node.childrenIds.length > 0) return false;
  if (q.typeFilter === 'internal' && node.childrenIds.length === 0) return false;
  if (!q.labelText) return true;
  return (node.label || '').toLowerCase().includes(q.labelText);
}
