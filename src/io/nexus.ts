// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// NEXUS support. Reads EVERY `TREE` statement from the TREES block (honouring an
// optional TRANSLATE table) and writes a TAXA + TREES block, plus optional
// CHARACTERS / ASSUMPTIONS / MrBayes / BEAST blocks.
//
// Parsing is defensive but NOT lossy where it matters: comments are masked
// rather than deleted, so a `[&NHX:…]` / `[&date=…]` node annotation inside the
// TREES block survives into the ordered array `node.meta.comments` — every
// comment on the node, oldest first, never just the last one (the single-string
// `node.meta.comment` is read only for legacy documents) — exactly as it does on the plain
// Newick path. The masking keeps the string length identical, so
// statement boundaries (`;`, `BEGIN … END;`) are located on the masked copy —
// immune to a `;` or `,` inside a comment or a quoted label — while the text
// handed to the Newick parser is sliced from the raw input.

import { newParseBudget, parseNewickTrees, serializeNewick } from './newick';
import { costOf } from '../model/parsimony';
import { MISSING_STATE_CODES, newCharacterState, stateColorFor } from '../model/characters';
import { newId } from '../model/treeOps';
import { tr } from '../ui/strings';
import { assertTreeCount, assertTreeInput } from './limits';
import type { Character, NodeId, Project, TreeNode } from '../model/types';

/** Options controlling NEXUS export output. */
export interface NexusExportOptions {
  includeCharacters?: boolean;
  includeHypothesis?: boolean;
  includeMrBayes?: boolean;
  includeBeast?: boolean;
}

export const DEFAULT_NEXUS_OPTIONS: NexusExportOptions = {
  includeCharacters: false,
  includeHypothesis: false,
  includeMrBayes: false,
  includeBeast: false,
};

/**
 * Return a same-length copy of `s` whose `[...]` comment bodies and `'...'`
 * quoted-span bodies are replaced by spaces (the brackets / quotes stay). The
 * masked text is used only to locate structure — block headers and statement
 * terminators — so a `;` or `,` hidden inside a comment or a quoted label can
 * never split a statement in the wrong place, while every piece of *content* is
 * sliced from the raw string (which is what keeps NHX / FigTree annotations).
 */
function maskNexus(s: string): string {
  const out = s.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '[') {
      const end = s.indexOf(']', i);
      if (end === -1) break; // unterminated comment: blank to the end
      blank(i + 1, end === -1 ? s.length : end);
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      // Both quote styles. `escapeName` in newick.ts writes DOUBLE quotes, so
      // without this a `;` inside a taxon name ended the statement mid-tree and
      // CladeForge could not read back its own NEXUS export;
      // an odd number of apostrophes likewise blanked the rest of the file.
      let k = i + 1;
      while (k < s.length) {
        if (s[k] === c) {
          if (s[k + 1] === c) {
            k += 2; // doubled quote = an escaped literal quote
            continue;
          }
          break;
        }
        k += 1;
      }
      blank(i + 1, Math.min(k, s.length));
      i = k + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** Split on `sep` only when outside single-quoted spans ('' is an escaped quote). */
function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === "'") {
      quoted = !quoted;
      cur += c;
    } else if (c === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function unquote(label: string): string {
  const t = label.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/**
 * A `TRANSLATE` table maps the short tokens used inside the TREE string to real
 * taxon names. `raw` / `masked` are the same TREES-block region; the table body
 * is delimited on the masked copy so a `;` inside a quoted name cannot cut it
 * short, and read from the raw copy so the names themselves survive.
 */
function parseTranslateTable(raw: string, masked: string): Map<string, string> {
  const map = new Map<string, string>();
  const m = /\btranslate\b/i.exec(masked);
  if (!m) return map;
  const from = m.index + m[0].length;
  const semi = masked.indexOf(';', from);
  const body = raw.slice(from, semi === -1 ? raw.length : semi);
  for (const entry of splitOutsideQuotes(body, ',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // "key label" — key is the first whitespace-delimited token, label the rest.
    const km = /^(\S+)\s+([\s\S]+)$/.exec(trimmed);
    if (km) map.set(km[1], unquote(km[2]));
  }
  return map;
}

/** One `TREE name = …;` statement, with the rootedness flag it declared. */
interface NexusTreeStatement {
  newick: string;
  /** true = `[&R]`, false = `[&U]`, undefined = the file said nothing. */
  rooted?: boolean;
}

/**
 * Consume the statement-level `[&R]` / `[&U]` marker. It must be taken off the
 * Newick text: it describes the whole tree, and leaving it in place would make
 * the Newick parser store it as a *node* annotation and re-emit it on export.
 * Tolerates the MrBayes shape `TREE 1 = 1234.5 [&R] (…)`.
 */
function takeRootedMarker(body: string): NexusTreeStatement {
  const m = /^\s*(?:[-+.\d]+\s+)?\[\s*&?\s*([RUru])\s*\]/.exec(body);
  if (!m) return { newick: body.trim() };
  return {
    newick: body.slice(m[0].length).trim(),
    rooted: m[1].toUpperCase() === 'R',
  };
}

/** Every `TREE` statement of one `BEGIN TREES; … END;` region. */
function findTreeStatements(raw: string, masked: string): NexusTreeStatement[] {
  const out: NexusTreeStatement[] = [];
  const re = /\btree\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const eq = masked.indexOf('=', m.index);
    const semi = masked.indexOf(';', m.index);
    if (eq === -1 || (semi !== -1 && eq > semi)) continue; // not a TREE statement
    const end = semi === -1 ? masked.length : semi;
    const body = raw.slice(eq + 1, end);
    if (body.trim()) out.push(takeRootedMarker(body));
    re.lastIndex = end;
  }
  return out;
}

/** Raw + masked text of every `BEGIN TREES; … END;` block in the file. */
function treesBlocks(input: string): { raw: string; masked: string }[] {
  const maskedAll = maskNexus(input);
  const blocks: { raw: string; masked: string }[] = [];
  const re = /begin\s+trees\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(maskedAll))) {
    const from = m.index + m[0].length;
    const endM = /end\s*;/gi.exec(maskedAll.slice(from));
    const to = endM ? from + endM.index : maskedAll.length;
    blocks.push({ raw: input.slice(from, to), masked: maskedAll.slice(from, to) });
    if (endM) re.lastIndex = to + endM[0].length;
  }
  return blocks;
}

/** Result of reading a NEXUS file: all trees it declares + what was lossy. */
export interface NexusParseResult {
  projects: Project[];
  issues: string[];
}

/**
 * Read every tree of a NEXUS file. Multi-tree files — posteriors, bootstrap
 * replicates, MCCTREE sets — yield the whole list plus the lossiness notes, never
 * just the first tree; callers are expected to route them through the same tree
 * chooser the Newick path uses.
 */
export function parseNexusTrees(input: string, name = 'Imported tree'): NexusParseResult {
  assertTreeInput(input);
  const blocks = treesBlocks(input);
  if (blocks.length === 0) throw new Error('No TREES block found in NEXUS file');

  // Each statement carries the TRANSLATE table of the block it came from: a single
  // hoisted table would let a later BEGIN TREES block rename the trees declared by
  // an earlier one and silently mis-label the first tree.
  const statements: Array<{ stmt: NexusTreeStatement; translate: Map<string, string> }> = [];
  for (const b of blocks) {
    const translate = parseTranslateTable(b.raw, b.masked);
    for (const stmt of findTreeStatements(b.raw, b.masked)) statements.push({ stmt, translate });
  }
  if (statements.length === 0) throw new Error('No TREE statement found in NEXUS TREES block');
  // A NEXUS file may hold thousands of TREE statements; if each got its own node
  // budget the document-level ceilings would not bind, so one budget is shared.
  assertTreeCount(statements.length);
  const budget = newParseBudget();

  const issues: string[] = [];
  const projects: Project[] = [];
  statements.forEach(({ stmt, translate }, idx) => {
    const label = statements.length > 1 ? `${name} (${idx + 1})` : name;
    const { projects: parsed, issues: nwkIssues } = parseNewickTrees(
      stmt.newick.endsWith(';') ? stmt.newick : `${stmt.newick};`,
      label,
      budget,
    );
    issues.push(...nwkIssues);
    const project = parsed[0];
    if (!project) return;

    // Record rootedness on the root node's meta. `parseNexusTrees` detects the
    // marker per TREE statement, and `serializeNexus` writes it back out, so an
    // `[&U]` import can never be re-exported as a rooted tree.
    const root = project.nodes[project.rootId];
    if (stmt.rooted !== undefined) {
      root.meta = { ...root.meta, rooted: stmt.rooted };
      if (!stmt.rooted) {
        issues.push(
          tr(
            '文件声明该树为无根树（[&U]）：CladeForge 内部按有根邻接表存储，重根/极性请显式指定外群；导出 NEXUS 时将原样保留 [&U] 标记',
            'The file declares this tree unrooted ([&U]): CladeForge stores an adjacency rooted at its root node, so set an outgroup explicitly before trusting polarity; the [&U] marker is kept on export',
          ),
        );
      }
    }

    if (translate.size > 0) {
      for (const id of Object.keys(project.nodes) as NodeId[]) {
        const node = project.nodes[id];
        if (node.childrenIds.length === 0 && translate.has(node.label)) {
          node.label = translate.get(node.label) as string;
        }
      }
    }
    projects.push(project);
  });
  if (projects.length === 0) throw new Error('No TREE statement found in NEXUS TREES block');

  // A file that carries BOTH trees and a character matrix gets the matrix
  // attached to the first tree, joined by label — the "trees + traits travel
  // together" shape of the MrBayes / Mesquite world. A partial join is
  // reported, never hidden.
  try {
    const matrix = parseNexusMatrix(input);
    issues.push(...matrix.issues, ...matrix.unsupported);
    if (matrix.characters.length > 0) {
      const target = projects[0];
      const join = applyMatrixToProject(target, matrix);
      if (join.matched > 0) {
        target.characters = [...target.characters, ...matrix.characters];
        issues.push(
          tr(
            `已从 DATA/CHARACTERS 块导入 ${matrix.characters.length} 个性状，${join.matched} 个尖端匹配成功${join.unmatchedLabels.length > 0 ? `；${join.unmatchedLabels.length} 个矩阵行未匹配到树上的末端（${join.unmatchedLabels.slice(0, 3).join('、')}）` : ''}`,
            `Imported ${matrix.characters.length} character(s) from the DATA/CHARACTERS block; ${join.matched} tip(s) matched${join.unmatchedLabels.length > 0 ? `; ${join.unmatchedLabels.length} matrix row(s) matched no tip (${join.unmatchedLabels.slice(0, 3).join(', ')})` : ''}`,
          ),
        );
      }
    }
  } catch {
    // matrix reading is best-effort; the trees remain valid on its failure
  }
  return { projects, issues };
}

/**
 * Read a NEXUS file that may contain trees, a character matrix, or both.
 * This is the single entry the import dialog should use: a matrix-only file
 * (the usual MrBayes / PAUP morphology input) is no longer an error — it
 * returns the characters so the caller can offer "import as character matrix".
 */
export function parseNexusFile(
  input: string,
  name = 'Imported tree',
): { projects: Project[]; matrix: NexusMatrixResult | null; issues: string[] } {
  const issues: string[] = [];
  let projects: Project[] = [];
  try {
    const parsed = parseNexusTrees(input, name);
    projects = parsed.projects;
    issues.push(...parsed.issues);
  } catch (e) {
    issues.push(
      tr(
        `未找到可解析的 TREES 块（${e instanceof Error ? e.message : String(e)}）；尝试按性状矩阵导入`,
        `No parsable TREES block (${e instanceof Error ? e.message : String(e)}); trying to read a character matrix`,
      ),
    );
  }
  let matrix: NexusMatrixResult | null = null;
  try {
    const m = parseNexusMatrix(input);
    if (m.characters.length > 0 || m.unsupported.length > 0) matrix = m;
  } catch {
    matrix = null;
  }
  if (projects.length === 0 && !matrix) {
    throw new Error('No TREES block found in NEXUS file');
  }
  return { projects, matrix, issues };
}

/** Read the FIRST tree of a NEXUS file (see `parseNexusTrees` for all of them). */
export function parseNexus(input: string, name = 'Imported tree'): Project {
  return parseNexusTrees(input, name).projects[0];
}

// --- export ------------------------------------------------------------------

// Cell symbols for a STANDARD matrix: 1-based digits, then letters. 1-based
// because NEXUS state numbering starts at 1 (a 0-based matrix is read with an
// off-by-one by every downstream tool) — and because each character gets its own
// symbol set, a character may declare up to
// STATE_SYMBOLS.length states without another character stealing a symbol.
const STATE_SYMBOLS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function leafNodes(project: Project): TreeNode[] {
  return Object.values(project.nodes).filter((n) => n.childrenIds.length === 0);
}

/** Discrete characters written to a STANDARD matrix (≥1 declared state). */
function discreteCharacters(project: Project): Character[] {
  return project.characters.filter((c) => c.type === 'discrete' && c.states.length > 0);
}

/** Continuous characters: they can never share a block with a STANDARD matrix. */
function continuousCharacters(project: Project): Character[] {
  return project.characters.filter((c) => c.type === 'continuous');
}

/** A NEXUS name: bare when it is already a safe identifier, else quoted. */
function nexusName(label: string): string {
  const l = (label || '').trim() || 'unnamed';
  return /^[A-Za-z0-9_.\-+]+$/.test(l) ? l : `'${l.replace(/'/g, "''")}'`;
}

/** Comment text: brackets would close the comment early, so they are removed. */
function nexusComment(text: string): string {
  return `[${text.replace(/[[\]\n]/g, ' ')}]`;
}

/**
 * Tip names used consistently by TAXLABELS, every CHARACTERS matrix and the
 * TREE string. A blank label falls back to the node id and duplicates get a
 * numeric suffix: a TAXA block with repeated or empty labels is rejected outright
 * by PAUP, and TAXLABELS disagreeing with the tree is worse.
 *
 * Exported because the R-script exporter needs the SAME mapping: its `tips`
 * vector is keyed on the tip label, so two tips called `Taxon_A` collapse
 * into one entry there too, and the second one's states are silently lost.
 *
 * The renaming is reported rather than hidden: `tipNameNotices` lists every tip
 * whose exported name differs from what the user typed, and the export actions
 * surface it, so a file is never written under names the user did not choose
 * without saying so.
 */
export function tipNamesWithNotices(project: Project): { names: Map<NodeId, string>; notices: string[] } {
  const used = new Set<string>();
  const names = new Map<NodeId, string>();
  const notices: string[] = [];
  for (const n of leafNodes(project)) {
    const base = (n.label || '').trim() || n.id;
    let name = base;
    for (let k = 2; used.has(name); k += 1) name = `${base}_${k}`;
    used.add(name);
    names.set(n.id, name);
    if (name !== (n.label || '')) notices.push(name);
  }
  return { names, notices };
}

export function tipNameNotices(project: Project): string[] {
  return tipNamesWithNotices(project).notices;
}

export function tipNames(project: Project): Map<NodeId, string> {
  return tipNamesWithNotices(project).names;
}

/** Shallow copy of `project` whose tips carry the names from `names`. */
function projectWithTipNames(project: Project, names: Map<NodeId, string>): Project {
  const nodes = { ...project.nodes };
  for (const [id, name] of names) {
    const n = nodes[id];
    if (n) nodes[id] = { ...n, label: name };
  }
  return { ...project, nodes };
}

/**
 * CHARACTERS blocks. One block per discrete character, so each block can
 * declare its own SYMBOLS / CHARLABELS / STATELABELS and the symbol→state
 * mapping is unambiguous (a single shared block cannot express per-character
 * state names once characters disagree). Continuous characters go to their own
 * `DATATYPE=CONTINUOUS` block instead of being written as `?` while still being
 * counted in NCHAR, which would make the export read as all-missing data.
 */
function buildCharactersBlock(project: Project): string {
  const leaves = leafNodes(project);
  const names = tipNames(project);
  if (leaves.length === 0) return '';
  const blocks: string[] = [];

  for (const c of discreteCharacters(project)) {
    const symbolCount = Math.min(c.states.length, STATE_SYMBOLS.length);
    const symbols = STATE_SYMBOLS.slice(0, symbolCount);
    const lines = [
      'BEGIN CHARACTERS;',
      nexusComment(
        `CladeForge character "${c.name}" — one character per block so STATELABELS ` +
          `bind to SYMBOLS; state ${symbolCount < c.states.length ? `indices beyond ${symbolCount} ` : ''}` +
          `and uncoded / undeclared cells are written as MISSING (?)`,
      ),
      `  DIMENSIONS NTAX=${leaves.length} NCHAR=1;`,
      `  FORMAT DATATYPE=STANDARD MISSING=? GAP=- SYMBOLS="${symbols}";`,
      `  CHARLABELS ${nexusName(c.name)};`,
      `  STATELABELS ${c.states.slice(0, symbolCount).map((s) => nexusName(s.label)).join(' ')};`,
      '  MATRIX',
    ];
    for (const n of leaves) {
      const v = n.charStates?.[c.id];
      const idx = typeof v === 'string' ? c.states.findIndex((s) => s.id === v) : -1;
      const cell = idx >= 0 && idx < symbolCount ? STATE_SYMBOLS[idx] : '?';
      lines.push(`    ${nexusName(names.get(n.id) ?? n.id)}  ${cell}`);
    }
    lines.push('  ;', 'END;', '');
    blocks.push(lines.join('\n'));
  }

  const cont = continuousCharacters(project);
  if (cont.length) {
    const lines = [
      'BEGIN CHARACTERS;',
      nexusComment(
        'CladeForge continuous characters — DATATYPE=CONTINUOUS, one column per character; ' +
          'nodes without a numeric value are MISSING (?)',
      ),
      `  DIMENSIONS NTAX=${leaves.length} NCHAR=${cont.length} NEXTRA=${cont.length};`,
      '  FORMAT DATATYPE=CONTINUOUS MISSING=?;',
      `  CHARLABELS ${cont.map((c, i) => `${i + 1} ${nexusName(c.name)}`).join(' ')};`,
      '  MATRIX',
    ];
    for (const n of leaves) {
      const cells = cont.map((c) => {
        const v = n.charStates?.[c.id];
        return typeof v === 'number' && Number.isFinite(v) ? String(v) : '?';
      });
      lines.push(`    ${nexusName(names.get(n.id) ?? n.id)}  ${cells.join(' ')}`);
    }
    lines.push('  ;', 'END;', '');
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n');
}

/**
 * The step matrix the parsimony pass actually applies. `costOf` is imported
 * straight from model/parsimony.ts so this block is the *same* function the
 * analysis uses — a matrix that merely looks like the project's would contradict
 * it (`costOf` falls back cell-wise to 0 on the diagonal / 1 off it when a cell
 * is absent or unusable).
 */
function appliedCostMatrix(c: Character): number[][] {
  const k = c.states.length;
  return Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => costOf(c.costMatrix, i, j)),
  );
}

/** DEFTYPE that matches a cost matrix, so the block cannot contradict it.
 *  `CUSTOM` covers everything a single keyword cannot express — weighted,
 *  non-metric or asymmetric (irreversible) matrices — where COSTMATRIX below is
 *  the authoritative statement of the model. */
function defTypeOf(matrix: number[][]): 'ADDITIVE' | 'NONADDITIVE' | 'CUSTOM' {
  // Uniform first: for a 2-state character |i−j| and the Fitch matrix coincide,
  // and the model actually applied is unordered change (Fitch), not a ladder.
  if (matrix.every((row, i) => row.every((v, j) => v === (i === j ? 0 : 1)))) return 'NONADDITIVE';
  if (matrix.every((row, i) => row.every((v, j) => v === Math.abs(i - j)))) return 'ADDITIVE';
  return 'CUSTOM';
}

/**
 * ASSUMPTIONS block: the real cost matrices. The old block claimed
 * `DEFTYPE = UNORD` for every character while `scriptExport` embedded a weighted
 * Sankoff matrix, i.e. the two exports of one project stated mutually exclusive
 * models, and its `CHARSET <name> = <state labels…>` lines listed state NAMES in
 * a character-number set, which no NEXUS reader parses.
 *
 * Written per character, in the order the CHARACTERS blocks appear (that order
 * is what `APPLYTO=(n)` / `CHARSET = n` number), with
 * `OPTIONS DEFTYPE=… / OPTIONS COSTMATRIX=(…) APPLYTO=(n)` — the row-major
 * matrix the parsimony pass actually applies.
 */
function buildAssumptionsBlock(project: Project): string {
  const chars = discreteCharacters(project);
  if (chars.length === 0) return '';
  const lines = [
    'BEGIN ASSUMPTIONS;',
    nexusComment(
      'CladeForge hypothesis/step-matrix block. DEFTYPE and COSTMATRIX are read back from the ' +
        'matrices the Sankoff pass actually applies (uniform when a character declares none), so ' +
        'this block can never disagree with the analysis. Rows are row-major; state order is the ' +
        'STATELABELS order of the matching CHARACTERS block; APPLYTO / CHARSET numbers follow the ' +
        'order the CHARACTERS blocks are written in.',
    ),
  ];
  chars.forEach((c, i) => {
    const n = i + 1;
    const matrix = appliedCostMatrix(c);
    const flat = matrix.map((row) => row.join(' ')).join(' ');
    lines.push(`  ${nexusComment(`character ${n}: ${c.name}`)}`);
    lines.push(`  CHARSET ${nexusName(c.name)} = ${n};`);
    lines.push(`  OPTIONS DEFTYPE=${defTypeOf(matrix)} APPLYTO=(${n});`);
    lines.push(`  OPTIONS COSTMATRIX=(${flat}) APPLYTO=(${n}) STATES=(${c.states.map((_, k) => k + 1).join(' ')});`);
  });
  lines.push('END;', '');
  return lines.join('\n');
}

/**
 * MrBayes instruction block. It is a *template*: the command spellings are not
 * validated against a real `mb` run, so the block says so in-file instead of
 * pretending to be executable. Character numbering matches the discrete
 * CHARACTERS blocks written by `buildCharactersBlock`.
 */
function buildMrBayesBlock(project: Project): string {
  const chars = discreteCharacters(project);
  const lines = [
    'BEGIN MRBAYES;',
    '  [ CladeForge template — check every command against your MrBayes version before running. ]',
    '  lset nst=1;',
  ];
  if (chars.length > 0) {
    lines.push(`  charset chars = 1-${chars.length};`);
    lines.push('  lset applyto=(all) coding=all;');
  }
  lines.push('  prset statefreqpr=equal;');
  // Fossil calibrations use the MrBayes `calibrate` command with a uniform
  // prior spanning the documented min/max age.
  for (const cal of project.calibrationPoints) {
    const node = project.nodes[cal.nodeId];
    const label = node?.label || cal.nodeId.slice(0, 6);
    const safe = /^[A-Za-z0-9_.\-+]+$/.test(label) ? label : `'${label.replace(/'/g, "''")}'`;
    lines.push(`  calibrate ${safe} = uniform(${cal.minAge}, ${cal.maxAge});`);
  }
  lines.push('  mcmc ngen=10000 samplefreq=100 printfreq=100;');
  // burnin is a *number of samples*, so it must be derived from samplefreq —
  // 10000/100 = 100 samples, of which the first quarter is discarded.
  lines.push('  sumt burnin=25;');
  lines.push('  sump burnin=25;');
  lines.push('END;', '');
  return lines.join('\n');
}

/**
 * Informational BEAST block. BEAST itself is driven by XML rather than NEXUS,
 * so calibrations are emitted as NEXUS comments (`[ ... ]`) documenting the
 * priors to translate — emitting pseudo-syntax as executable statements would
 * break real NEXUS parsers.
 */
function buildBeastBlock(project: Project): string {
  // A NEXUS comment ends at the first `]`, so a calibration label is run through
  // the same `nexusComment()` the rest of the writer uses rather than being
  // interpolated raw.
  const lines = ['BEGIN BEAST;'];
  lines.push('  [ BEAST is configured via XML; translate the priors below by hand. ]');
  if (project.calibrationPoints.length === 0) {
    lines.push('  [ No calibration points defined; add fossil calibrations for a dated analysis. ]');
  } else {
    for (const cal of project.calibrationPoints) {
      const node = project.nodes[cal.nodeId];
      const label = node?.label || cal.nodeId.slice(0, 6);
      const lo = Number.isFinite(cal.minAge) ? cal.minAge : 'NA';
      const hi = Number.isFinite(cal.maxAge) ? cal.maxAge : 'NA';
      lines.push(`  ${nexusComment(`calibrate ${label}: lognormal prior, min ${lo}, max ${hi}`)}`);
    }
  }
  lines.push('  [ clock: strict, uniform branch-length prior suggested for first runs ]');
  lines.push('END;', '');
  return lines.join('\n');
}

export function serializeNexus(project: Project, options: NexusExportOptions = DEFAULT_NEXUS_OPTIONS): string {
  const names = tipNames(project);
  const leaves = leafNodes(project);
  const taxLabels = leaves.map((n) => nexusName(names.get(n.id) ?? n.id)).join(' ');
  // A TRANSLATE table (index → name) rides along, and the TREE statements
  // reference the indices. Two reasons this is no longer optional:
  //  1. the module itself recommends "read the exported node table or a NEXUS
  //     TRANSLATE block" for names ape 5.8.1 mangles (quoted labels) — a
  //     recommendation the file has to make true;
  //  2. MrBayes / PAUP consumers key the translate table, not the literal names.
  const translateRows = leaves
    .map((n, i) => `    ${i + 1} ${nexusName(names.get(n.id) ?? n.id)}`)
    .join(',\n');
  const numbered = new Map(leaves.map((n, i) => [n.id, String(i + 1)] as const));
  const newick = serializeNewick(projectWithTipNames(project, numbered));
  // Honour what the document says about its root instead of always claiming
  // [&R]: an [&U] import re-exported as rooted would let PAUP / MrBayes / RASP
  // polarise the characters on a wrong root. A document that never
  // said anything keeps the CladeForge convention (rooted).
  const rooted = project.nodes[project.rootId]?.meta?.rooted;
  const rootFlag = rooted === false ? '[&U]' : '[&R]';
  const blocks = [
    '#NEXUS',
    '',
    'BEGIN TAXA;',
    `  DIMENSIONS NTAX=${leaves.length};`,
    `  TAXLABELS ${taxLabels};`,
    'END;',
    '',
    'BEGIN TREES;',
    '  TRANSLATE',
    `${translateRows};`,
    `  TREE tree1 = ${rootFlag} ${newick}`,
    'END;',
    '',
  ];
  if (options.includeCharacters) {
    const block = buildCharactersBlock(project);
    if (block) blocks.push(block);
  }
  if (options.includeHypothesis) {
    const block = buildAssumptionsBlock(project);
    if (block) blocks.push(block);
  }
  if (options.includeMrBayes) {
    blocks.push(buildMrBayesBlock(project));
  }
  if (options.includeBeast) {
    blocks.push(buildBeastBlock(project));
  }
  return blocks.join('\n');
}

// --- DATA / CHARACTERS block reading -------------------------------------------
// NEXUS used to be a one-way door: the writer emitted DATA/CHARACTERS/
// ASSUMPTIONS blocks the reader never touched, so a matrix exported from this
// app (or from Mesquite / PAUP / MrBayes) could not come back in — the "import"
// silently kept only the topology. The parser below closes the loop.

export interface NexusMatrixResult {
  characters: Character[];
  issues: string[];
  /** TAXA the matrix carries (in declaration order). */
  tipLabels: string[];
  /** DATATYPEs found but not imported (e.g. DNA), with the reason. */
  unsupported: string[];
}

interface MatrixBlock {
  datatype: string;
  symbols: string;
  /** Declared taxon labels (from TAXLABELS), when the block declares them. */
  declaredTaxa: string[];
  /** taxon → the column tokens in file order (interleaved rows concatenated). */
  rows: Map<string, string[]>;
  stateLabels: Map<number, string[]>;
  costMatrices: { applyTo: number[]; matrix: number[][] }[];
  columns: number;
}

function blocksOf(input: string, kinds: string[]): { raw: string; masked: string }[] {
  const maskedAll = maskNexus(input);
  const out: { raw: string; masked: string }[] = [];
  const re = new RegExp(`begin\\s+(${kinds.join('|')})\\s*;`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(maskedAll))) {
    const from = m.index + m[0].length;
    const endM = /end\s*;/gi.exec(maskedAll.slice(from));
    const to = endM ? from + endM.index : maskedAll.length;
    out.push({ raw: input.slice(from, to), masked: maskedAll.slice(from, to) });
    if (endM) re.lastIndex = to + endM[0].length;
  }
  return out;
}

function parseMatrixBlock(raw: string, masked: string): MatrixBlock | null {
  const datatypeM = /datatype\s*=\s*([A-Za-z]+)/i.exec(masked);
  const datatype = (datatypeM?.[1] ?? 'STANDARD').toUpperCase();
  const symbolsM = /symbols\s*=\s*"([^"]*)"/i.exec(masked);
  const symbols = symbolsM?.[1] ?? '01';
  const ncharM = /nchar\s*=\s*(\d+)/i.exec(masked);
  const columns = ncharM ? Number(ncharM[1]) : 0;

  const declaredTaxa: string[] = [];
  {
    const taxM = /taxlabels\s+([^;]*);/i.exec(masked);
    if (taxM) {
      for (const tok of splitOutsideQuotes(taxM[1], ' ')) {
        const t = tok.trim();
        if (t) declaredTaxa.push(unquote(t));
      }
    }
  }

  const stateLabels = new Map<number, string[]>();
  {
    const re = /statelabels\s+([^;]*);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const parts = splitOutsideQuotes(m[1], ' ').map((t) => t.trim()).filter(Boolean);
      const charIdx = Number(parts[0]);
      if (Number.isFinite(charIdx)) stateLabels.set(charIdx, parts.slice(1).map(unquote));
    }
  }

  // MATRIX (or CHARACTERS) body. Row starts are decided by the DECLARED taxa
  // when the block has TAXLABELS (the reliable rule for interleaved files);
  // otherwise a line whose first token is not a declared label is treated as a
  // continuation of the previous row.
  const rows = new Map<string, string[]>();
  {
    const m = /(?:matrix|characters)\s+([\s\S]*?)(?:;|$)/i.exec(masked);
    if (m) {
      const bodyMaskedLines = m[1].split(/\r?\n/);
      const startRaw = masked.indexOf(m[1]);
      const rawBody = raw.slice(startRaw, startRaw + m[1].length);
      const rawLines = rawBody.split(/\r?\n/);
      const declared = new Set(declaredTaxa.map((t) => t.toLowerCase()));
      let current: string | null = null;
      for (let li = 0; li < bodyMaskedLines.length; li += 1) {
        const lineMasked = bodyMaskedLines[li].trim();
        if (!lineMasked || lineMasked.startsWith('[')) continue;
        const lineRaw = (rawLines[li] ?? '').trim() || lineMasked;
        const toksM = splitOutsideQuotes(lineMasked, ' ').filter(Boolean);
        const toksR = splitOutsideQuotes(lineRaw, ' ').filter(Boolean);
        if (toksM.length === 0) continue;
        const firstRaw = unquote(toksR[0] ?? toksM[0]);
        const isTaxonStart =
          declared.has(firstRaw.toLowerCase()) ||
          (declaredTaxa.length === 0 && current === null);
        if (isTaxonStart) {
          current = firstRaw;
          rows.set(current, [...toksM.slice(1)]);
        } else if (current) {
          rows.set(current, [...(rows.get(current) as string[]), ...toksM]);
        }
      }
    }
  }

  // ASSUMPTIONS-style cost matrices can also ride inside a DATA block header
  // (OPTIONS line) — parse the masked text for COSTMATRIX=(...) here; the
  // separate ASSUMPTIONS block is handled by the caller.
  const costMatrices: MatrixBlock['costMatrices'] = [];
  {
    const re = /costmatrix\s*=\s*\(([^;]*?)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const matrix = m[1]
        .split('/')
        .map((r) => splitOutsideQuotes(r.trim(), ' ').map((v) => Number(v.trim())))
        .filter((row) => row.length > 0 && row.every((v) => Number.isFinite(v)));
      if (matrix.length > 0) costMatrices.push({ applyTo: [], matrix });
    }
    const applyM = /applyto\s*=\s*([0-9(\s,]+)/i.exec(masked);
    if (applyM && costMatrices.length > 0) {
      const ids = applyM[1]
        .split(/[\s,()]+/)
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0);
      if (ids.length > 0) costMatrices[0].applyTo = ids;
    }
  }

  if (rows.size === 0) return null;
  return { datatype, symbols, declaredTaxa, rows, stateLabels, costMatrices, columns };
}

/** ASSUMPTIONS blocks: OPTIONS DEFTYPE=… COSTMATRIX=(…) APPLYTO=…. */
function parseAssumptions(input: string): { applyTo: number[]; matrix: number[][] }[] {
  const out: { applyTo: number[]; matrix: number[][] }[] = [];
  for (const b of blocksOf(input, ['assumptions'])) {
    const re = /costmatrix\s*=\s*\(([^;]*?)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b.masked))) {
      const matrix = m[1]
        .split('/')
        .map((r) => splitOutsideQuotes(r.trim(), ' ').map((v) => Number(v.trim())))
        .filter((row) => row.length > 0 && row.every((v) => Number.isFinite(v)));
      if (matrix.length === 0) continue;
      const applyM = /applyto\s*=\s*([0-9(\s,]+)/i.exec(b.masked.slice(m.index));
      const applyTo = applyM
        ? applyM[1]
            .split(/[\s,()]+/)
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v) && v > 0)
        : [];
      out.push({ applyTo, matrix });
    }
  }
  return out;
}

/**
 * Read the DATA / CHARACTERS / ASSUMPTIONS blocks of a NEXUS file into
 * CladeForge characters. STANDARD (morphology) matrices — the common
 * Mesquite / PAUP / MrBayes exchange — are fully supported, including
 * SYMBOLS, STATELABELS, polymorphic `(xy)` cells, `?`/`-` missing codes and
 * cost matrices; continuous matrices become continuous characters; sequence
 * datatypes (DNA/AA) are refused with a reason (there is no sequence layer).
 */
export function parseNexusMatrix(input: string): NexusMatrixResult {
  const issues: string[] = [];
  const unsupported: string[] = [];
  const characters: Character[] = [];
  const blocks = blocksOf(input, ['data', 'characters']);
  const assumptionMatrices = parseAssumptions(input);
  if (blocks.length === 0) return { characters, issues, tipLabels: [], unsupported };

  const tipLabels: string[] = [];
  for (const b of blocks) {
    const block = parseMatrixBlock(b.raw, b.masked);
    if (!block) continue;
    if (['DNA', 'NUCLEOTIDE', 'AA', 'AMINOACID', 'PROTEIN', 'RNA'].includes(block.datatype)) {
      unsupported.push(
        tr(
          `数据类型 ${block.datatype}（序列矩阵）不可导入：本软件不做序列演化推断，请使用比对/建树工具处理序列`,
          `Datatype ${block.datatype} (a sequence matrix) cannot be imported: this software does not model sequence evolution; process the alignment with a dedicated tool`,
        ),
      );
      continue;
    }
    const taxa = [...block.rows.keys()];
    if (tipLabels.length === 0) tipLabels.push(...taxa);
    const columnCount = Math.max(block.columns, ...taxa.map((t) => (block.rows.get(t) as string[]).length));
    if (columnCount === 0) continue;

    if (block.datatype === 'CONTINUOUS') {
      // One continuous character per column; values attach by label below.
      for (let col = 0; col < columnCount; col += 1) {
        const ch: Character = {
          id: newId(),
          name: tr(`连续性状 ${col + 1}`, `Continuous ${col + 1}`),
          type: 'continuous',
          states: [],
          lowColor: '#60a5fa',
          highColor: '#f97316',
        };
        const values: Record<string, number> = {};
        for (const taxon of taxa) {
          const v = Number((block.rows.get(taxon) as string[])[col]);
          if (Number.isFinite(v)) values[taxon] = v;
        }
        if (Object.keys(values).length >= 3) {
          (ch as Character & { __values?: Record<string, number> }).__values = values;
          characters.push(ch);
        }
      }
      continue;
    }

    for (let col = 0; col < columnCount; col += 1) {
      const usedSymbols = new Set<string>();
      for (const taxon of taxa) {
        const tok = (block.rows.get(taxon) as string[])[col] ?? '?';
        const poly = /^\((.*)\)$/.exec(tok);
        for (const s of (poly ? poly[1] : tok).split('')) {
          if (MISSING_STATE_CODES.includes(s)) continue;
          usedSymbols.add(s);
        }
      }
      const ordered = [...usedSymbols].sort(
        (a, b) => block.symbols.indexOf(a) - block.symbols.indexOf(b),
      );
      if (ordered.length < 2) continue; // a column with one observed state has no signal
      const labels = block.stateLabels.get(col + 1) ?? [];
      const ch: Character = {
        id: newId(),
        name: tr(`性状 ${col + 1}`, `Character ${col + 1}`),
        type: 'discrete',
        states: ordered.map((s, i) => ({
          ...newCharacterState(labels[i] ?? s, i),
          color: stateColorFor(i),
        })),
      };
      const assignments: Record<string, string | string[]> = {};
      for (const taxon of taxa) {
        const tok = (block.rows.get(taxon) as string[])[col] ?? '?';
        const poly = /^\((.*)\)$/.exec(tok);
        const cellSymbols = (poly ? poly[1] : tok).split('');
        const ids: string[] = [];
        for (const s of cellSymbols) {
          if (MISSING_STATE_CODES.includes(s)) continue;
          const idx = ordered.indexOf(s);
          const st = ch.states[idx];
          if (st) ids.push(st.id);
        }
        if (ids.length === 0) continue;
        assignments[taxon] = ids.length === 1 ? ids[0] : ids;
      }
      const cm =
        assumptionMatrices.find((m) => m.applyTo.includes(col + 1)) ??
        block.costMatrices.find((m) => m.applyTo.length === 0 || m.applyTo.includes(col + 1));
      if (cm && cm.matrix.length === ch.states.length) {
        ch.costMatrix = cm.matrix;
        ch.model = 'custom';
      }
      (ch as Character & { __assignments?: Record<string, string | string[]> }).__assignments =
        assignments;
      characters.push(ch);
    }
  }
  if (characters.length === 0 && blocks.length > 0) {
    issues.push(
      tr(
        '文件含 DATA/CHARACTERS 块，但没有可导入的列（每列需至少两个可观测状态）',
        'The file has DATA/CHARACTERS block(s) but no importable column (each needs at least two observed states)',
      ),
    );
  }
  return { characters, issues, tipLabels, unsupported };
}

/**
 * Attach a parsed matrix onto a tree document, matching matrix rows to tips by
 * label (exact, then normalized case/underscore — the same tolerance the
 * Newick reader applies). Returns how many tips matched and which labels did
 * not, so the caller can report a partial join instead of hiding it.
 */
export function applyMatrixToProject(
  project: Project,
  matrix: NexusMatrixResult,
): { matched: number; unmatchedLabels: string[] } {
  const byLabel = new Map<string, NodeId>();
  const byNorm = new Map<string, NodeId>();
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    byLabel.set(n.label, n.id);
    byNorm.set(n.label.trim().toLowerCase().replace(/_/g, ' '), n.id);
  }
  let matched = 0;
  const unmatched: string[] = [];
  const norm = (s: string): string => s.trim().toLowerCase().replace(/_/g, ' ');
  for (const label of matrix.tipLabels) {
    const nodeId = byLabel.get(label) ?? byNorm.get(norm(label));
    if (!nodeId) {
      unmatched.push(label);
      continue;
    }
    const node = project.nodes[nodeId];
    matched += 1;
    for (const ch of matrix.characters) {
      const bag = ch as Character & {
        __assignments?: Record<string, string | string[]>;
        __values?: Record<string, number>;
      };
      const assignment = bag.__assignments?.[label];
      const value = bag.__values?.[label];
      const assigned = assignment ?? value;
      if (assigned === undefined) continue;
      if (!node.charStates) node.charStates = {};
      node.charStates[ch.id] = assigned;
    }
  }
  // The transient assignment buckets never belong in the document.
  for (const ch of matrix.characters) {
    delete (ch as Character & { __assignments?: unknown }).__assignments;
    delete (ch as Character & { __values?: unknown }).__values;
  }
  return { matched, unmatchedLabels: unmatched };
}
