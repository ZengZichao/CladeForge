// Input-size and structural guards for the parse paths.
//
// Every user-supplied document reaches a parser before any UI sees it, so the
// limits live next to the parsers instead of in the file picker: a mis-saved
// binary, a 500 MB Newick paste or a hand-edited project blob must fail fast
// with a readable message instead of hanging the webview or exhausting memory.
//
// The numbers are generous on purpose — a 10 000-tip Newick is ≈250 kB and a
// full workspace JSON with 10 000 nodes is a few MB, so real documents stay
// three to four orders of magnitude below the ceilings.

/** Largest tree text we are willing to tokenise (≈ 2 M nodes' worth of Newick). */
export const MAX_TREE_CHARS = 64 * 1024 * 1024;

/** Largest project JSON we are willing to `JSON.parse`. */
export const MAX_PROJECT_CHARS = 192 * 1024 * 1024;

/**
 * Hard cap on the nodes ONE TREE may create (10 000 tips → 20 000 nodes).
 * Documents are bounded by `MAX_DOCUMENT_NODES`, not by this — otherwise a file
 * holding 250 000 small trees would slip past every guard.
 */
export const MAX_PARSED_NODES = 2_000_000;

/** Largest number of trees one document may declare. */
export const MAX_TREES_PER_DOCUMENT = 10_000;

/**
 * Total nodes across every tree in one document. `MAX_PARSED_NODES` resets per
 * tree, so without this a multi-tree file multiplies its own ceiling by the
 * number of trees it contains.
 */
export const MAX_DOCUMENT_NODES = 4_000_000;

/** Reject a document declaring an absurd number of trees before any is parsed. */
export function assertTreeCount(count: number): void {
  if (count > MAX_TREES_PER_DOCUMENT) {
    throw new Error(
      `The input declares ${count} trees, above the ${MAX_TREES_PER_DOCUMENT} allowed in one file.`,
    );
  }
}

function tooBig(kind: string, size: number, limit: number): string {
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${kind} is ${mb(size)} — the limit is ${mb(limit)}. The file is almost certainly not a ${kind} (or is far too large to open safely).`;
}

/**
 * Drop a leading UTF-8 byte-order mark.
 *
 * Windows Notepad (and some exporters) prepend U+FEFF to a saved file.
 * `String.prototype.trim` removes it from Newick input, but `JSON.parse`
 * rejects it outright, so a project file edited that way could never be
 * reopened.
 */
export function stripBom(text: string): string {
  return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Reject absurd tree input before the tokeniser touches it. */
export function assertTreeInput(text: string): void {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('Tree text is empty');
  if (text.length > MAX_TREE_CHARS) throw new Error(tooBig('Newick/NEXUS input', text.length, MAX_TREE_CHARS));
}

/** Reject absurd project input before `JSON.parse`. */
export function assertProjectInput(text: string): void {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('Project file is empty');
  if (text.length > MAX_PROJECT_CHARS) throw new Error(tooBig('project file', text.length, MAX_PROJECT_CHARS));
}

/**
 * Called by the parsers as nodes are created, so runaway input stops early.
 * `treeNodes` bounds one tree; `totalNodes` bounds the whole document.
 */
export function assertNodeCount(totalNodes: number, treeNodes = totalNodes): void {
  if (treeNodes > MAX_PARSED_NODES) {
    throw new Error(
      `A single tree declares ${treeNodes} nodes, above the ${MAX_PARSED_NODES} limit; the input looks malformed.`,
    );
  }
  if (totalNodes > MAX_DOCUMENT_NODES) {
    throw new Error(
      `The input declares over ${MAX_DOCUMENT_NODES} nodes in total, above what one document may hold.`,
    );
  }
}
