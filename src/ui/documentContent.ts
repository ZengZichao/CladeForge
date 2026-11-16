// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// The single definition of "this document has something to edit".
//
// The module rail and both side panels exist to edit a tree, so they are shown
// only once the document actually has one — a fresh tab (root node, no
// children) is the empty-state front page and owns the whole canvas. Keeping
// the predicate in one place means the workspace, the status bar and any future
// caller cannot disagree about what counts as "opened a sample / file".

import type { Project } from '../model/types';

/**
 * True when the document's root has at least one child.
 *
 * A blank document still has a root node (the editor needs one to add children
 * to), so node COUNT is not the test — the root's `childrenIds` is. A missing
 * root (a corrupt / half-written file) reads as "no content", never as content.
 */
export function documentHasTree(project: Project): boolean {
  return (project.nodes[project.rootId]?.childrenIds.length ?? 0) > 0;
}
