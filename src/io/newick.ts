// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// Newick format parser + serialiser.
// Grammar (simplified): subtree ";"  where
//   subtree  := "(" subtree ("," subtree)* ")" name? (":" length)? | name? (":" length)?
//
// The parser works on a token stream whose scanner keeps square-bracket
// comments as first-class tokens instead of discarding them: every comment
// attaches to the node whose name / branch-length immediately precedes it and
// is appended, oldest first, to the ordered array `node.meta.comments` — NOT
// overwritten, so a node carrying `[&U]` and a note keeps both (`node.meta.comment`,
// a single string, is still read for documents saved before comments were
// accumulated). Metadata such as `[&NHX:...]` therefore survives a round-trip
// in full. Underscores in unquoted names become spaces
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
// — `serializeNexus` writes `[&R]` or `[&U]`, and `serializeNewick(…, {rootedMarker: true})`
// appends `[&U]` but deliberately never `[&R]` (see `NewickSerializeOptions`) —
// so an unrooted import can no longer come back out as a rooted tree.

import { createEmptyProject } from '../model/sampleTree';
import { inferSupportScale, newId } from '../model/treeOps';
import { tr } from '../ui/strings';
import { assertNodeCount, assertTreeInput, assertTreeCount } from './limits';
import type { NodeId, Project, SupportScale, TreeNode } from '../model/types';

/** File-wide support convention inference (see treeOps.inferSupportScale). */
function inferSupportScaleFromValues(values: number[]): SupportScale {
  return inferSupportScale(values);
}

// --- tokeniser -----------------------------------------------------------------

type Token =
  | { t: '('; at: number }
  | { t: ')'; at: number }
  | { t: ','; at: number }
  | { t: ':'; at: number }
  | { t: ';'; at: number }
  /** `quoted` records that the label arrived inside single quotes, which is
   *  how a *deliberate* numeric node name is distinguished from a support
   *  value on an internal node. `at` is the input index where the token
   *  starts, so a parse error can name the line and column. */
  | { t: 'label'; v: string; quoted: boolean; at: number }
  | { t: 'comment'; v: string; at: number };

/** 1-based line/column of a character index — what a user needs to actually
 *  FIND a syntax error in a thousands-line MrBayes or IQ-TREE output. */
export function lineColOf(input: string, index: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const stop = Math.min(Math.max(index, 0), input.length);
  for (let i = 0; i < stop; i += 1) {
    if (input[i] === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

/** The line containing `index`, trimmed to a readable excerpt. */
function excerptOf(input: string, index: number): string {
  const lineStart = input.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  let lineEnd = input.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = input.length;
  const text = input.slice(lineStart, lineEnd).trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * A parse error that says WHERE — line, column and the offending line — in
 * the user's language. Without the position, "Unbalanced (" on a 5 000-line
 * file asks the user to eyeball-scan the whole document.
 */
function parseErrorAt(input: string, index: number, zh: string, en: string): Error {
  const { line, col } = lineColOf(input, index);
  const where = tr(`第 ${line} 行第 ${col} 列`, `line ${line}, column ${col}`);
  const context = excerptOf(input, index);
  const ctx = context
    ? tr(`，出错位置附近：「${context}」`, `, near: "${context}"`)
    : '';
  return new Error(tr(`Newick 解析错误（${where}）：${zh}${ctx}`, `Newick parse error (${where}): ${en}${ctx}`));
}

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
      tokens.push({ t: c, at: i } as Token);
      i += 1;
    } else if (c === "'" || c === '"') {
      // Quoted label: a doubled quote char is an escaped quote. Both styles are
      // accepted on input — `"` is what this writer emits, `'` is read because it
      // is what other tools export. A quote that never closes is a malformed
      // file: refusing it beats silently accepting the half label.
      const q = c;
      const quoteStart = i;
      i += 1;
      let v = '';
      let closed = false;
      while (i < n) {
        if (input[i] === q) {
          if (input[i + 1] === q) {
            v += q;
            i += 2;
            continue;
          }
          i += 1;
          closed = true;
          break;
        }
        v += input[i];
        i += 1;
      }
      if (!closed) throw parseErrorAt(input, i, '引号未闭合', 'unterminated quote');
      tokens.push({ t: 'label', v, quoted: true, at: quoteStart });
    } else if (c === '[') {
      // Newick / NEXUS comments may NEST brackets — `(A[a[b]c],B)` is legal in a
      // NEXUS TREE statement. Scan to the MATCHING `]` instead of the first one,
      // which used to cut the comment short and leave `c]` to be read as a
      // label plus a stray-bracket error.
      let depth = 0;
      let j = i;
      for (; j < n; j += 1) {
        if (input[j] === '[') depth += 1;
        else if (input[j] === ']') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (j >= n) throw parseErrorAt(input, i, '注释「[」没有对应的「]」', 'unbalanced "["');
      tokens.push({ t: 'comment', v: input.slice(i + 1, j), at: i });
      i = j + 1;
    } else if (c === ']') {
      // A stray closing bracket has no matching '['. Reject it explicitly:
      // the label scanner below terminates on ']', so without this branch it
      // would consume nothing and spin forever (index never advances).
      throw parseErrorAt(input, i, '出现多余的「]」（没有对应的「[」）', 'unbalanced "]"');
    } else {
      const labelStart = i;
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
      tokens.push({ t: 'label', v: v.replace(/_/g, ' '), quoted: false, at: labelStart });
    }
  }
  return tokens;
}

// --- helpers -------------------------------------------------------------------

/** A bare number (optionally signed / decimal / scientific) with nothing else. */
function isNumericToken(s: string): boolean {
  return s !== '' && /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s);
}

/** Split on `sep`, ignoring separators nested inside {…} / (…) groups. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '{' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
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
  // the tokenizer here does exactly that. Writing `Taxon_A_2` bare therefore
  // reads back as `Taxon A 2` — a label drift that silently orphans every
  // character state keyed on the original name. Quote such labels instead.
  if (/^[A-Za-z0-9.\-+]+$/.test(label)) return label;
  // Control characters (newline / tab / etc.) are invalid inside a Newick label
  // even when quoted; collapse them to spaces before quoting.
  const clean = label.replace(/[\u0000-\u001f]/g, ' ');
  // Double quotes are the Newick convention for a label containing spaces, and
  // this reader accepts both styles on input. Note the limit of that choice:
  // ape 5.8.1 does not read either style correctly — a quoted `"Taxon name with
  // spaces"` comes back with the spaces deleted, and `"Genus (species)"` as just
  // `species` — so tools that must recover such names should read the exported
  // node table (or a NEXUS TRANSLATE block) rather than the Newick. See
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
  supportConvention: 'auto' | SupportScale = 'auto',
  /** The raw segment text, for line/column positions in parse errors. */
  source = '',
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
   *
   * BEYOND the support pair, structured annotations are now PARSED, not just
   * preserved as text: BEAST / FigTree `[&height=…]`, `[&height_95%_HPD={a,b}]`,
   * `[&posterior=…]`, `[&bootstrap=…]` / `[&ufboot=…]` / `[&SH-aLRT=…]` become
   * node age / age-interval / typed support fields, and the app's own NHX
   * dialect (`&&NHX:S=…,E=…,D=true,T=true,TD=…,L=…` written by reconExport)
   * is kept as a QUERYABLE map on `meta.nhx` instead of an opaque string —
   * so a reconciliation report can be read back as data.
   */
  const attachComment = (node: TreeNode, text: string): void => {
    const trimmed = text.trim();
    const m = /^&support=(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/.exec(trimmed);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) {
        node.support = v;
        return;
      }
    }
    // BEAST-style key[=value] pairs: `&key=val,key2=val2` or `&&NHX:key=val,...`.
    if (/^&{1,2}[A-Za-z_]/.test(trimmed)) {
      const isNhx = trimmed.startsWith('&&NHX:');
      const body = isNhx ? trimmed.slice(6) : trimmed.replace(/^&{1,2}/, '');
      const pairs: Record<string, string> = {};
      if (isNhx) {
        // NHX separates FIELDS with ':' (classic Bio::NHX); this app's own
        // writer uses ','. Accept both — splitting on ',' alone glued the two
        // fields of `&&NHX:S=human:D=Y` into one value.
        for (const part of body.split(/[:,]/)) {
          const eq = part.indexOf('=');
          if (eq <= 0) continue;
          pairs[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
        }
      } else {
        // BEAST values can be BRACE SETS (`height_95%_HPD={8,12}`), so the
        // split must ignore commas inside braces — a naive split cut the value
        // in half and the age interval was silently dropped.
        for (const part of splitTopLevel(body, ',')) {
          const eq = part.indexOf('=');
          if (eq <= 0) continue;
          pairs[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
        }
      }
      let consumed = false;
      const num = (v: string | undefined): number | undefined => {
        if (v === undefined) return undefined;
        const cleaned = v.replace(/[{}[\]]/g, '');
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : undefined;
      };
      // Age: BEAST height / nodetime / age.
      const height = num(pairs.height ?? pairs.nodetime ?? pairs.age);
      if (height !== undefined) {
        node.age = Math.abs(height);
        node.ageSource = 'clock';
        consumed = true;
      }
      // Age interval: height_95%_HPD={a,b} or height_range_ms={a,b}.
      const hpd = pairs['height_95%_HPD'] ?? pairs.height_range_ms ?? pairs.age_range;
      if (hpd) {
        const nums = hpd.replace(/[{}[\]]/g, '').split(/[\s,]+/).map(Number).filter(Number.isFinite);
        if (nums.length >= 2) {
          node.ageMin = Math.min(nums[0], nums[1]);
          node.ageMax = Math.max(nums[0], nums[1]);
          consumed = true;
        }
      }
      // Typed support: posterior (0–1), bootstrap / ufboot / SH-aLRT (0–100).
      const posterior = num(pairs.posterior);
      if (posterior !== undefined) {
        node.support = posterior;
        node.supportScale = 'fraction';
        node.supportKind = 'posterior';
        consumed = true;
      }
      for (const bootKey of ['bootstrap', 'ufboot', 'ufboot2', 'SH-aLRT', 'sh-aLRT'] as const) {
        const boot = num(pairs[bootKey]);
        if (boot !== undefined && boot > 1) {
          node.support = boot;
          node.supportScale = 'percent';
          node.supportKind = 'bootstrap';
          consumed = true;
          break;
        }
      }
      if (isNhx) {
        // Keep the full NHX map structured and queryable — including the app's
        // own S=/E=/D=/T=/TD=/L= reconciliation tags.
        node.meta = { ...node.meta, nhx: { ...(node.meta?.nhx as Record<string, string> | undefined), ...pairs } };
        consumed = true;
      }
      if (consumed) {
        // Still preserve the raw text for lossless round-tripping.
        node.meta = { ...node.meta, comments: [...nodeComments(node), text] };
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
        // A branch length must be a FULLY numeric token: parseFloat used to
        // accept `1.5abc` as 1.5 with no warning, silently corrupting the edge.
        if (!isNumericToken(raw.v)) {
          issues.push(
            tr(
              `节点「${who(current)}」的枝长「${raw.v}」不是数值，已按缺失枝长处理`,
              `Branch length "${raw.v}" on "${who(current)}" is not a number; treated as missing`,
            ),
          );
        } else if (Number(raw.v) < 0) {
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
          current.branchLength = Number(raw.v);
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
        if (!parent) throw parseErrorAt(source, tok.at, "出现多余的「,」（当前不在任何括号内）", "unexpected ',' outside any subtree");
        const sibling = makeNode(parent.id);
        parent.childrenIds.push(sibling.id);
        current = sibling;
        break;
      }
      case ')': {
        ti += 1;
        const parent = stack.pop();
        if (!parent) throw parseErrorAt(source, tok.at, "出现多余的「)」（没有对应的「(」）", "unbalanced ')'");
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

  if (stack.length > 0) {
    throw parseErrorAt(
      source,
      source.length,
      `输入结束时仍有 ${stack.length} 个未闭合的「(」`,
      `${stack.length} unclosed "(" at the end of the input`,
    );
  }

  const project = createEmptyProject(name);
  project.nodes = nodes;
  project.rootId = root.id;
  // A Newick file may say (explicitly or by its shape) that the tree is unrooted.
  // Recording that on the root's meta is what stops the NEXUS / Newick exporters
  // from claiming `[&R]` for an IQ-TREE / RAxML output.
  resolveRootedness(project, issues);

  // PM-31: duplicate tip labels used to be handled only at NEXUS export
  // (rewritten base_2 + notices), while the canvas and inspector stayed silent —
  // so a character-table join silently matched only ONE of the duplicates.
  // Report at import: which labels, how many tips each.
  {
    const byLabel = new Map<string, number>();
    for (const n of Object.values(project.nodes)) {
      if (n.childrenIds.length > 0 || !n.label) continue;
      byLabel.set(n.label, (byLabel.get(n.label) ?? 0) + 1);
    }
    const dupes = [...byLabel.entries()].filter(([, c]) => c > 1);
    if (dupes.length > 0) {
      const shown = dupes.slice(0, 3).map(([l, c]) => `${l}×${c}`).join(', ');
      issues.push(
        tr(
          `树中存在重复末端名（${dupes.length} 个，如 ${shown}）：性状表连接与注释表只会命中其中一个。建议先重命名或用 NEXUS 导出的重名处理`,
          `The tree has duplicate tip labels (${dupes.length}, e.g. ${shown}): character/annotation table joins will hit only one of each. Rename them first, or use the NEXUS export's deduplication`,
        ),
      );
    }
  }

  // Stamp the support convention the user declared (or the file-wide inference
  // chose) onto every support value that carries no explicit scale yet. A bare
  // `1` under the WRONG convention is the difference between 100% and 1%, so
  // the scale is recorded at the border, where the convention is known.
  if (supportConvention !== 'auto') {
    for (const n of Object.values(project.nodes)) {
      if (n.support !== undefined && !n.supportScale) n.supportScale = supportConvention;
      if (n.support !== undefined && n.supportScale === 'percent' && !n.supportKind) {
        n.supportKind = 'bootstrap';
      }
      if (n.support !== undefined && n.supportScale === 'fraction' && !n.supportKind) {
        n.supportKind = 'posterior';
      }
    }
  }
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
          '文件声明该树为无根树（[&U]）：CladeForge 内部按有根邻接表存储，重新定根/极性请显式指定外群；导出时将保留无根标记',
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
        `根节点分出 ${root.childrenIds.length} 个子枝（三歧根 = 无根树的常见写法），已按无根树（[&U]）处理；如需有根分析请显式指定外群重新定根`,
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

export interface NewickParseOptions {
  /**
   * The support-value convention of THIS file: 'percent' (0–100 bootstrap),
   * 'fraction' (0–1 posterior), or 'auto' (infer: any value > 1 ⇒ percent).
   * The import dialog asks; the answer is stamped on every imported support so
   * a real 1% bootstrap can never be re-read as 100%.
   */
  supportConvention?: 'auto' | SupportScale;
}

/**
 * Net-evolution syntax detector. Extended Newick (`(A,B)#H1:::0.9`, PhyloNet /
 * PhyloNetworks) and Huber–van-Iersel annotations (`(A,B)>H1`) are NOT trees:
 * this parser treats `#`/`>`/`<`/`@` as ordinary label characters, which would
 * turn a network into a tree with names like ">H1" while silently DROPPING the
 * reticulation edges (`0.1#H1` parses as branch length 0.1 and discards the
 * hybrid tag). Detection happens on the raw text (outside quotes and bracket
 * comments) so the user is told, in no uncertain terms, that the file is a
 * network and what their options are — silent degradation is data corruption.
 */
const NET_SYNTAX = /[#@<>]/;

function scanForNetSyntax(input: string): string | null {
  let inQuote: string | null = null;
  let inComment = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (inComment) {
      if (c === ']') inComment = false;
      continue;
    }
    if (c === "'" || c === '"') {
      inQuote = c;
      continue;
    }
    if (c === '[') {
      inComment = true;
      continue;
    }
    if (NET_SYNTAX.test(c)) return c;
  }
  return null;
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
  options: NewickParseOptions = {},
): NewickParseResult {
  assertTreeInput(input);
  const trimmed = input.trim();
  const issues: string[] = [];

  // Net syntax first: refuse-to-lie about what the file contains before any
  // topology is built from it.
  const netChar = scanForNetSyntax(trimmed);
  if (netChar) {
    issues.push(
      tr(
        `该文件包含网状进化 Newick 语法（字符「${netChar}」，如 PhyloNet 扩展 Newick 的 #H1 或 >H1/<H1 标记）。本软件按普通树解析：网状关系已被丢弃，这不是无损导入。请用网络专用工具转换后再导入，或在画布上用「自定义连线」手工补画网状关系`,
        `This file contains network-evolution Newick syntax (character "${netChar}", e.g. PhyloNet extended-Newick #H1 or >H1/<H1 markers). It was parsed as an ORDINARY tree: the reticulation was dropped, which is NOT a lossless import. Convert the file with a network-aware tool first, or redraw the reticulation with custom edges on the canvas`,
      ),
    );
  }

  const segments: Token[][] = [];
  const segSources: string[] = [];
  let cur: Token[] = [];
  let curStart = 0;
  // Walk the input WITH the token stream so each segment keeps its raw text:
  // parse errors can then quote the actual line the user needs to look at.
  const tokens = tokenize(trimmed);
  for (const tok of tokens) {
    if (cur.length === 0) curStart = tok.at;
    if (tok.t === ';') {
      if (cur.length > 0) {
        segments.push(cur);
        segSources.push(trimmed.slice(curStart, tok.at));
      }
      cur = [];
    } else {
      cur.push(tok);
    }
  }
  if (cur.length > 0) {
    segments.push(cur);
    segSources.push(trimmed.slice(curStart));
  }
  if (segments.length === 0) {
    throw parseErrorAt(
      input,
      trimmed.length,
      '没有找到任何树（缺少表示树结束的分号「;」？）',
      'no tree found (missing the terminating ";"?)',
    );
  }

  // File-wide support convention: an explicit user choice, else inference —
  // any value above 1 can only be a percent; all-≤1 values are PROBABLY
  // fractions (posterior probabilities) but the inference is reported so the
  // user knows what was chosen.
  let convention: SupportScale;
  if (options.supportConvention && options.supportConvention !== 'auto') {
    convention = options.supportConvention;
  } else {
    const numericSupports: number[] = [];
    for (const seg of segments) {
      let prev: Token | undefined;
      for (const tok of seg) {
        // Only a bare number DIRECTLY after ')' is a support candidate.
        // Numbers after ':' are branch lengths and numbers after '(' / ','
        // are tip names (or NEXUS TRANSLATE keys) — letting either into the
        // inference let one branch length of 12 misclassify a whole file of
        // posteriors as percent, a 100× error.
        if (tok.t === 'label' && !tok.quoted && prev?.t === ')') {
          const v = Number(tok.v);
          if (Number.isFinite(v)) numericSupports.push(v);
        }
        prev = tok;
      }
    }
    convention = inferSupportScaleFromValues(numericSupports);
    if (numericSupports.length > 0 && convention === 'fraction') {
      issues.push(
        tr(
          `支持度全部 ≤ 1，已按 0–1 后验概率（fraction）解释；若实际是 0–100 百分比（如 bootstrap=1 表示 1%），这一解释会相差 100 倍，请在使用支持度做阈值过滤/折叠/导出前先行校正`,
          `All support values are ≤ 1 and were interpreted as 0–1 posteriors (fraction). If they are actually 0–100 percentages (e.g. bootstrap=1 meaning 1%), this reading is off by 100×; correct the scale before using support for thresholds, collapsing or export`,
        ),
      );
    }
  }

  assertTreeCount(segments.length);
  const projects = segments.map((seg, idx) => {
    budget.tree = 0; // per-tree ceiling resets; the document ceiling does not
    return parseSegment(seg, segments.length > 1 ? `${name} (${idx + 1})` : name, issues, budget, convention, segSources[idx]);
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
  /**
   * Whether the ROOT node's own branch length is written. Default 'write' (the
   * historical behaviour, kept for round-trip stability); 'omit' produces
   * `((A,B),C)root;` — some readers reject a root length, and the root edge is
   * not a real branch. The manual documents the choice.
   */
  rootBranchLength?: 'write' | 'omit';
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
    if (n.branchLength !== undefined && !(n.parentId === null && options.rootBranchLength === 'omit')) {
      out += `:${n.branchLength}`;
    }
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
  // The mirror case needs the marker too: an EXPLICITLY rooted trifurcation is
  // re-read as unrooted (a 3-way root is the unrooted signature), so a document
  // that said "rooted" must leave `[&R]` behind or the round trip flips it.
  const rootedMeta = nodes[rootId]?.meta?.rooted;
  const needsU =
    options.rootedMarker && rootedMeta === false && !/\[&\s*[Uu]\s*\]$/.test(rootPart);
  const needsR = options.rootedMarker && rootedMeta === true && (nodes[rootId]?.childrenIds.length ?? 0) >= 3;
  const marker = needsU ? '[&U]' : needsR ? '[&R]' : '';
  return `${rootPart}${marker};`;
}
