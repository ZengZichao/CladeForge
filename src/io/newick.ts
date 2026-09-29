// Newick format parser + serialiser.
// Grammar (simplified): subtree ";"  where
//   subtree  := "(" subtree ("," subtree)* ")" name? (":" length)? | name? (":" length)?
//
// The parser works on a token stream whose scanner keeps square-bracket
// comments as first-class tokens instead of discarding them: a comment
// attaches to the node whose name / branch-length immediately precedes it and
// is preserved in `node.meta.comment`, so metadata such as `[&NHX:...]`
// survives a round-trip. Underscores in unquoted names become spaces
// (standard Newick convention); quoted names are kept verbatim.
//
// A numeric label on an *internal* node is interpreted as a branch-support
// value (the common RAxML / FigTree convention) and round-trips through
// `support` — unless it was quoted in the input (`((A,B)'0.95',C)R`), which is
// read as a deliberate node name. Round-tripping is lossless:
//   * a node carrying BOTH a name and a support value writes the name and puts
//     the support in a `[&support=…]` comment, because Newick has a single
//     label slot; a numeric *name* is quoted so it is not re-read as support;
//   * a branch length that cannot be stored (negative / non-finite) is dropped
//     — a negative depth would corrupt the phylogram layout — but it is
//     reported through `parseNewickTrees().issues` instead of vanishing.
// Multiple ";"-separated trees in one string are supported via
// `parseNewickMulti`. The parser is iterative (explicit stack + token index)
// so deeply nested trees cannot blow the call stack, and it is defensive
// about malformed input (unbalanced brackets, stray tokens, missing ";") and
// about runaway input size (see io/limits).
//
// Rootedness is resolved per document in `resolveRootedness`: an
// explicit `[&R]` / `[&U]` comment on the root is consumed into
// `root.meta.rooted`, and a trifurcate root with no declaration is recorded as
// unrooted (the shape IQ-TREE / RAxML / MrBayes emit). Exporters read that flag
// — `serializeNexus` writes `[&U]`, and `serializeNewick(…, {rootedMarker: true})`
// appends `[&U]` — so an unrooted import can no longer come back out as a
// rooted tree.

import { createEmptyProject } from '../model/sampleTree';
import { newId } from '../model/treeOps';
import { tr } from '../ui/strings';
import { assertNodeCount, assertTreeInput, assertTreeCount } from './limits';
import type { NodeId, Project, TreeNode } from '../model/types';

// --- tokeniser -----------------------------------------------------------------

type Token =
  | { t: '(' }
  | { t: ')' }
  | { t: ',' }
  | { t: ':' }
  | { t: ';' }
  /** `quoted` records that the label arrived inside single quotes, which is
   *  how a *deliberate* numeric node name is distinguished from a support
   *  value on an internal node. */
  | { t: 'label'; v: string; quoted: boolean }
  | { t: 'comment'; v: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  const skipWs = () => {
    while (i < n && /\s/.test(input[i])) i += 1;
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    const c = input[i];
    if ('(),:;'.includes(c)) {
      tokens.push({ t: c } as Token);
      i += 1;
    } else if (c === "'" || c === '"') {
      // Quoted label: a doubled quote char is an escaped quote. Both styles are
      // accepted on input — `"` is what this writer emits, `'` is read because it
      // is what other tools export.
      const q = c;
      i += 1;
      let v = '';
      while (i < n) {
        if (input[i] === q) {
          if (input[i + 1] === q) {
            v += q;
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        v += input[i];
        i += 1;
      }
      tokens.push({ t: 'label', v, quoted: true });
    } else if (c === '[') {
      const end = input.indexOf(']', i);
      if (end === -1) throw new Error('Unbalanced "[" in Newick string');
      tokens.push({ t: 'comment', v: input.slice(i + 1, end) });
      i = end + 1;
    } else if (c === ']') {
      // A stray closing bracket has no matching '['. Reject it explicitly:
      // the label scanner below terminates on ']', so without this branch it
      // would consume nothing and spin forever (index never advances).
      throw new Error('Unbalanced "]" in Newick string');
    } else {
      let v = '';
      while (i < n && !'(),:;[]'.includes(input[i]) && !/\s/.test(input[i])) {
        v += input[i];
        i += 1;
      }
      // An unquoted label may legitimately contain whitespace: the binomial
      // convention (`Homo sapiens`) shows up constantly in exports that should
      // have quoted it. Stopping at the space would leave the second word as a
      // separate label token, which then overwrites the first — silently deleting
      // the genus of every affected tip. Keep absorbing while the whitespace is
      // followed by more label text rather than a structural char.
      while (i < n && /\s/.test(input[i])) {
        let k = i;
        while (k < n && /\s/.test(input[k])) k += 1;
        if (k >= n || '(),:;[]'.includes(input[k])) break;
        let m = k;
        while (m < n && !'(),:;[]'.includes(input[m]) && !/\s/.test(input[m])) m += 1;
        if (m === k) break;
        v += ' ' + input.slice(k, m);
        i = m;
      }
      tokens.push({ t: 'label', v: v.replace(/_/g, ' '), quoted: false });
    }
  }
  return tokens;
}

// --- helpers -------------------------------------------------------------------

/** A bare number (optionally signed / decimal / scientific) with nothing else. */
function isNumericToken(s: string): boolean {
  return s !== '' && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s);
}

/**
 * Attach a name to a node. An *unquoted* bare number on an internal node is a
 * branch-support value (the RAxML / FigTree convention); a quoted one is a name
 * the user deliberately chose that merely looks like a number, and a tip name
 * is never support.
 */
function applyLabel(node: TreeNode, label: string, quoted = false): void {
  if (!label) return;
  if (!quoted && node.childrenIds.length > 0 && isNumericToken(label)) {
    node.support = Number(label);
  } else {
    node.label = label;
  }
}

export function escapeName(label: string): string {
  if (label === '') return '';
  // `_` must NOT survive unquoted: the Newick convention reads it as a space, and
  // the tokenizer here does exactly that. Writing `Pakicetus_2` bare therefore
  // reads back as `Pakicetus 2` — a label drift that silently orphans every
  // character state keyed on the original name. Quote such labels instead.
  if (/^[A-Za-z0-9.\-+]+$/.test(label)) return label;
  // Control characters (newline / tab / etc.) are invalid inside a Newick label
  // even when quoted; collapse them to spaces before quoting.
  const clean = label.replace(/[\u0000-\u001f]/g, ' ');
  // Double quotes are the Newick convention for a label containing spaces, and
  // this reader accepts both styles on input. Note the limit of that choice:
  // ape 5.8.1 does not read either style correctly — `"Tobacco mosaic virus"`
  // comes back as `"Tobaccomosaicvirus"` and `"Gracilicutes (GN)"` as `GN` — so
  // tools that must recover such names should read the exported node table
  // (or a NEXUS TRANSLATE block) rather than the Newick. See
  // scripts/cross-check/ape_agreement.R, which builds trees from nodes.tsv.
  return `"${clean.replace(/"/g, '""')}"`;
}

/**
 * Text shown at a node: its label, or its support value for an unlabelled
 * internal node. A node that has both a name and a support value keeps the
 * name here — the support travels in a `[&support=…]` comment (see
 * `supportComment`), because Newick offers only one label slot.
 */
function nodeToken(node: TreeNode, unnamedAs = ''): string {
  if (node.label) {
    // Quote a purely numeric NAME on an internal node: written bare it would be
    // re-read as a support value and the name would disappear.
    if (node.childrenIds.length > 0 && isNumericToken(node.label)) {
      return `"${node.label.replace(/"/g, '""')}"`;
    }
    return escapeName(node.label);
  }
  if (node.childrenIds.length === 0) {
    // An unnamed tip would serialise to `(A,)`, which most downstream readers
    // reject. Fall back to a deterministic, obviously-synthetic placeholder
    // (`unnamed_1`, …) rather than the node id: ids are random nanoids, so a name
    // derived from an id would invent a *different* fake taxon on every export and
    // every re-parse.
    return unnamedAs || 'unnamed';
  }
  if (node.childrenIds.length > 0 && isFiniteNumber(node.support)) return String(node.support);
  return '';
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Every `[...]` comment preserved on a node, oldest first.
 *
 * `meta.comments` is the modern list. `meta.comment` (a single string) is still
 * read so that documents saved before comments were accumulated keep their
 * annotations instead of silently losing them.
 */
function nodeComments(node: TreeNode): string[] {
  const raw = node.meta?.comments;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  const legacy = node.meta?.comment;
  return typeof legacy === 'string' && legacy !== '' ? [legacy] : [];
}

/**
 * The `[&support=…]` annotation used when a node cannot put its support in the
 * single Newick label slot. Recognised on the way back in by `attachComment`, so
 * the pair survives a round-trip instead of one of the two being dropped.
 */
function supportComment(node: TreeNode): string {
  if (!isFiniteNumber(node.support)) return '';
  // An unlabelled INTERNAL node already carries the support in the label slot
  // (see `nodeToken`), so it needs no annotation. Every other case — a named
  // internal node, or any tip with a support value — has to smuggle the value in
  // a comment, otherwise it is silently lost on export.
  if (!node.label && node.childrenIds.length > 0) return '';
  return `&support=${node.support}`;
}

// --- parser ----------------------------------------------------------------------

/** Parse one tree statement (a token run between semicolons). */
/**
 * Node counters shared by every tree parsed from ONE document, so the caps in
 * `limits.ts` bound the document and not just each individual tree.
 */
export interface ParseBudget {
  tree: number;
  total: number;
}

/** A fresh budget for one document. */
export function newParseBudget(): ParseBudget {
  return { tree: 0, total: 0 };
}

function parseSegment(
  tokens: Token[],
  name: string,
  issues: string[],
  budget: ParseBudget = newParseBudget(),
): Project {
  const nodes: Record<NodeId, TreeNode> = {};
  // The node-count guard below must not ask `Object.keys(nodes).length` for every
  // node created: that makes parsing O(n²) — about 447 ms at 2 000 tips, so the
  // "interactive up to ~1 000 tips" claim degrades faster than a casual benchmark
  // would notice. A counter keeps the guard and makes the walk linear.
  const makeNode = (parentId: NodeId | null): TreeNode => {
    const id = newId();
    const node: TreeNode = { id, label: '', parentId, childrenIds: [] };
    nodes[id] = node;
    budget.tree += 1;
    budget.total += 1;
    // Runaway / malformed input must not be able to allocate without bound —
    // for this tree AND for the document as a whole.
    assertNodeCount(budget.total, budget.tree);
    return node;
  };

  /** Human-readable handle for a node in a warning message. */
  const who = (node: TreeNode): string => node.label || node.id.slice(0, 6);

  /**
   * An unquoted label that contained whitespace was merged into a single name by
   * the tokenizer. That is almost always what the author meant (`Homo sapiens`),
   * but it is a judgement call, so surface it rather than rewriting names in
   * silence.
   */
  const noteMergedLabel = (v: string, quoted: boolean): void => {
    if (quoted || !/\s/.test(v)) return;
    issues.push(
      tr(
        `节点名「${v}」未加引号且含空格，已合并为一个名称；如非本意请在源文件中用双引号包裹`,
        `Node name "${v}" was unquoted and contained whitespace; merged into a single name. Quote it in the source file if that is not intended`,
      ),
    );
  };

  let ti = 0;
  const root = makeNode(null);
  let current = root;
  const stack: TreeNode[] = [];

  /**
   * Preserve a comment on `node` so serialisation can round-trip it. A comment
   * that is exactly the support annotation written by `supportComment` is read
   * back into `support` instead of being stored, so a node with both a name and
   * a support value round-trips unchanged.
   */
  const attachComment = (node: TreeNode, text: string): void => {
    const m = /^&support=(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/.exec(text.trim());
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) {
        node.support = v;
        return;
      }
    }
    // Keep EVERY comment. Two adjacent bracket groups would otherwise overwrite
    // each other, so `X[&U][&note=hi]` loses the unrooted declaration and flips
    // the tree's polarity on export.
    node.meta = { ...node.meta, comments: [...nodeComments(node), text] };
  };
  const readLabel = (): { v: string; quoted: boolean } | null => {
    const tok = ti < tokens.length ? tokens[ti] : null;
    if (tok && tok.t === 'label') {
      ti += 1;
      return { v: tok.v, quoted: tok.quoted };
    }
    return null;
  };
  const readBranchLength = (): void => {
    if (ti < tokens.length && tokens[ti].t === ':') {
      ti += 1;
      const raw = readLabel();
      if (raw !== null) {
        const len = parseFloat(raw.v);
        if (!Number.isFinite(len)) {
          issues.push(
            tr(
              `节点「${who(current)}」的枝长「${raw.v}」不是数值，已按缺失枝长处理`,
              `Branch length "${raw.v}" on "${who(current)}" is not a number; treated as missing`,
            ),
          );
        } else if (len < 0) {
          // Negative branch lengths are nonsensical and would corrupt the
          // phylogram layout (negative cumulative depth), so they cannot be
          // stored — but dropping them silently loses data, so the
          // caller is told, per node, what was discarded.
          issues.push(
            tr(
              `节点「${who(current)}」的枝长为负（${raw.v}），无法用于系统发育树绘图，已按缺失枝长处理（原值未保存）`,
              `Negative branch length (${raw.v}) on "${who(current)}" cannot be drawn on a phylogram and was treated as missing (the value is not stored)`,
            ),
          );
        } else {
          current.branchLength = len;
        }
      }
    }
  };
  const readComment = (): void => {
    // A node can carry several consecutive bracket comments (e.g. CladeForge's
    // own `[&support=…]` next to an `[&&NHX:…]` annotation); read them all so
    // none is mistaken for topology.
    while (ti < tokens.length && tokens[ti].t === 'comment') {
      attachComment(current, (tokens[ti] as { t: 'comment'; v: string }).v);
      ti += 1;
    }
  };

  while (ti < tokens.length) {
    const tok = tokens[ti];
    switch (tok.t) {
      case '(': {
        ti += 1;
        const child = makeNode(current.id);
        current.childrenIds.push(child.id);
        stack.push(current);
        current = child;
        break;
      }
      case ',': {
        ti += 1;
        const parent = stack[stack.length - 1];
        if (!parent) throw new Error("Unexpected ',' in Newick string");
        const sibling = makeNode(parent.id);
        parent.childrenIds.push(sibling.id);
        current = sibling;
        break;
      }
      case ')': {
        ti += 1;
        const parent = stack.pop();
        if (!parent) throw new Error("Unbalanced ')' in Newick string");
        current = parent;
        const label = readLabel();
        if (label) {
          applyLabel(current, label.v, label.quoted);
          noteMergedLabel(label.v, label.quoted);
        }
        readBranchLength();
        readComment();
        break;
      }
      case ':': {
        readBranchLength();
        readComment();
        break;
      }
      case 'label': {
        applyLabel(current, tok.v, tok.quoted);
        noteMergedLabel(tok.v, tok.quoted);
        ti += 1;
        readComment();
        break;
      }
      case 'comment': {
        attachComment(current, tok.v);
        ti += 1;
        break;
      }
      case ';':
        // Segments are pre-split on ';', so this is unreachable; kept for
        // exhaustiveness.
        ti += 1;
        break;
    }
  }

  if (stack.length > 0) throw new Error('Unbalanced "(" in Newick string');

  const project = createEmptyProject(name);
  project.nodes = nodes;
  project.rootId = root.id;
  // A Newick file may say (explicitly or by its shape) that the tree is unrooted.
  // Recording that on the root's meta is what stops the NEXUS / Newick exporters
  // from claiming `[&R]` for an IQ-TREE / RAxML output.
  resolveRootedness(project, issues);
  return project;
}

/** A `[&R]` / `[&U]` node comment: the file declaring the tree's rootedness. */
const ROOTEDNESS_COMMENT = /^&\s*([RUru])\s*$/;

/**
 * Decide `root.meta.rooted` for a freshly parsed document.
 *
 *   1. an explicit `[&R]` / `[&U]` comment on the root wins, and is CONSUMED —
 *      leaving it as a node annotation would make it round-trip as metadata and
 *      duplicate on export (the same reason `nexus.ts` strips the statement
 *      marker before handing the tree to this parser);
 *   2. otherwise a root with three or more children is the classic signature of
 *      an UNSPECIFIED-root tree: IQ-TREE, RAxML, MrBayes and PhyML all write an
 *      unrooted topology as a trifurcation at an arbitrary node. Nothing was
 *      declared, so this is an inference — it is therefore also reported to the
 *      user instead of quietly changing the polarity of their analysis;
 *   3. a binary root with no declaration stays silent (`undefined`), which is
 *      CladeForge's convention (an adjacency tree edited in-app is rooted).
 */
function resolveRootedness(project: Project, issues: string[]): void {
  const root = project.nodes[project.rootId];
  if (!root) return;
  const comments = nodeComments(root);
  const declaredIdx = comments.findIndex((c) => ROOTEDNESS_COMMENT.test(c.trim()));
  const declared = declaredIdx >= 0 ? ROOTEDNESS_COMMENT.exec(comments[declaredIdx].trim()) : null;
  if (declared) {
    const rest = { ...root.meta };
    delete rest.comment;
    // Consume only the rootedness comment; the others stay attached so they
    // still round-trip.
    const kept = comments.filter((_, i) => i !== declaredIdx);
    if (kept.length) rest.comments = kept; else delete rest.comments;
    root.meta = { ...rest, rooted: declared[1].toUpperCase() === 'R' };
    if (declared[1].toUpperCase() === 'U') {
      issues.push(
        tr(
          '文件声明该树为无根树（[&U]）：CladeForge 内部按有根邻接表存储，重根/极性请显式指定外群；导出时将保留无根标记',
          'The file declares this tree unrooted ([&U]): CladeForge stores an adjacency rooted at its root node, so set an outgroup explicitly before trusting polarity; the unrooted marker is kept on export',
        ),
      );
    }
    return;
  }
  if (root.childrenIds.length >= 3) {
    root.meta = { ...root.meta, rooted: false };
    issues.push(
      tr(
        `根节点分出 ${root.childrenIds.length} 个子枝（三歧根 = 无根树的常见写法），已按无根树（[&U]）处理；如需有根分析请显式指定外群重根`,
        `The root splits into ${root.childrenIds.length} branches (a trifurcate root is how unrooted trees are usually written), so the tree was treated as unrooted ([&U]); re-root on an explicit outgroup if a rooted analysis is intended`,
      ),
    );
  }
}

/** Result of a lossless multi-tree Newick read. */
export interface NewickParseResult {
  projects: Project[];
  /**
   * Data in the input that could not be represented in the document (negative
   * or non-numeric branch lengths, …). Callers MUST surface these — a silent
   * drop is what makes the round-trip lossy.
   */
  issues: string[];
}

/**
 * Parse every ";"-separated tree in `input`, reporting anything that could not
 * be represented. Most files hold a single tree; multi-tree files (e.g.
 * bootstrap replicates) yield one Project each.
 */
export function parseNewickTrees(
  input: string,
  name = 'Imported tree',
  budget: ParseBudget = newParseBudget(),
): NewickParseResult {
  assertTreeInput(input);
  const trimmed = input.trim();
  const issues: string[] = [];

  const segments: Token[][] = [];
  let cur: Token[] = [];
  for (const tok of tokenize(trimmed)) {
    if (tok.t === ';') {
      if (cur.length > 0) segments.push(cur);
      cur = [];
    } else {
      cur.push(tok);
    }
  }
  if (cur.length > 0) segments.push(cur);
  if (segments.length === 0) throw new Error('No tree found in Newick string (missing ";"?)');

  assertTreeCount(segments.length);
  const projects = segments.map((seg, idx) => {
    budget.tree = 0; // per-tree ceiling resets; the document ceiling does not
    return parseSegment(seg, segments.length > 1 ? `${name} (${idx + 1})` : name, issues, budget);
  });
  return { projects, issues };
}

/** Parse every tree, discarding the "could not be represented" notes. */
export function parseNewickMulti(input: string, name = 'Imported tree'): Project[] {
  return parseNewickTrees(input, name).projects;
}

/** Parse a Newick string, returning the first tree (see `parseNewickMulti`). */
export function parseNewick(input: string, name = 'Imported tree'): Project {
  return parseNewickMulti(input, name)[0];
}

// --- serialiser -------------------------------------------------------------------

export interface NewickSerializeOptions {
  /**
   * Append the declared rootedness to the root node as a `[&U]` comment.
   * Only an UNROOTED document is annotated: a CladeForge tree that never said
   * anything is rooted by convention, so writing `[&R]` on every export would be
   * an unfounded always-rooted claim. `nexus.ts` leaves this off because a TREE
   * statement carries its own `[&R]` / `[&U]` marker.
   */
  rootedMarker?: boolean;
}

export function serializeNewick(
  project: Project,
  options: NewickSerializeOptions = {},
): string {
  const { nodes, rootId } = project;
  // Iterative post-order build so deep trees don't overflow the call stack.
  const parts = new Map<NodeId, string>();
  const order: NodeId[] = [];
  const stack: NodeId[] = [rootId];
  while (stack.length) {
    const id = stack.pop() as NodeId;
    const n = nodes[id];
    if (!n) continue;
    order.push(id);
    for (const c of n.childrenIds) stack.push(c);
  }

  // Deterministic stand-in names for tips that have none, numbered left to
  // right so repeated exports of the same document agree.
  const unnamed = new Map<NodeId, string>();
  {
    let k = 0;
    const walk: NodeId[] = [rootId];
    while (walk.length) {
      const id = walk.pop() as NodeId;
      const n = nodes[id];
      if (!n) continue;
      if (n.childrenIds.length === 0) {
        if (!n.label) {
          k += 1;
          unnamed.set(id, `unnamed_${k}`);
        }
      } else {
        for (let i = n.childrenIds.length - 1; i >= 0; i -= 1) walk.push(n.childrenIds[i]);
      }
    }
  }

  for (let k = order.length - 1; k >= 0; k -= 1) {
    const id = order[k];
    const n = nodes[id];
    let out = '';
    if (n.childrenIds.length > 0) {
      out += `(${n.childrenIds.map((c) => parts.get(c) ?? '').join(',')})`;
      // Release each child's substring the moment it has been folded in.
      // Keeping every intermediate made the walk O(n·depth) in memory: 726 MB of
      // heap to emit a 130 kB string on a 16 000-tip pectinate tree, so a large
      // pectinate export could OOM the webview.
      for (const c of n.childrenIds) parts.delete(c);
    }
    out += nodeToken(n, unnamed.get(id));
    if (n.branchLength !== undefined) out += `:${n.branchLength}`;
    // Comments are written last so a name / support pair that cannot share the
    // single label slot travels in `[&support=…]` (see `supportComment`).
    const texts = [
      supportComment(n),
      // One `[...]` group per preserved comment — never a merged blob, so a
      // document with several annotations survives the round-trip.
      ...nodeComments(n).map((c) => c.replace(/[[\]]/g, '')),
    ];
    for (const safe of texts) {
      // Square brackets are stripped so a comment can never emit an unbalanced
      // / stray bracket that would break (or hang) a subsequent parse.
      if (safe) out += `[${safe}]`;
    }
    parts.set(id, out);
  }
  const rootPart = parts.get(rootId) ?? '';
  // Written as a comment on the ROOT node — `((A,B),C)R[&U];` — which is the
  // shape this parser itself reads back (`resolveRootedness`), so an unrooted
  // document survives a write → read cycle instead of silently becoming rooted.
  const marker =
    options.rootedMarker && nodes[rootId]?.meta?.rooted === false && !/\[&\s*[Uu]\s*\]$/.test(rootPart)
      ? '[&U]'
      : '';
  return `${rootPart}${marker};`;
}
