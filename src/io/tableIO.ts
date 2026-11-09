// Table I/O — CSV/TSV in and out.
//
// Real trait data lives in spreadsheets (MorphoBank exports, IUCN tables,
// resistance phenotypes, mapping files), not in per-cell pickers. Before this
// module a 500-tip × 12-character matrix meant 6 000 clicks; a metadata table
// could not be joined at all. Everything here is pure string → data mapping;
// the callers own the dialogs, matching reports and undo.

import { tr } from '../ui/strings';
import { newId } from '../model/treeOps';
import { stateColorFor, newCharacterState, MISSING_STATE_CODES } from '../model/characters';
import type { Character, NodeId, Project } from '../model/types';

/** Sniff the delimiter of a single-line table header: tab wins over comma/semicolon. */
export function detectDelimiter(text: string): ',' | '\t' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: Array<[string, number]> = [
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    [',', (firstLine.match(/,/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return (counts[0]?.[1] ?? 0) > 0 ? (counts[0][0] as ',' | '\t' | ';') : ',';
}

/** Split one CSV line honouring double-quoted fields (`"a,b"` stays one cell). */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuote = false;
      } else cur += c;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export interface ParsedTable {
  header: string[];
  rows: string[][];
  delimiter: string;
  /**
   * Structural problems of the table itself, reported to the user and never
   * silently repaired: rows whose cell count differs from the header (missing
   * cells read as empty, extra cells are dropped) and data rows skipped for an
   * empty key cell. Every consumer appends these to its own issue list — a
   * repair nobody hears about is indistinguishable from data loss.
   */
  issues: string[];
  /** Data rows whose first cell was empty (skipped by every importer). */
  skippedEmptyKeyRows: number;
}

/** Parse a CSV/TSV table (header row required). */
export function parseTable(text: string): ParsedTable {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) throw new Error(tr('表格内容为空', 'Table text is empty'));
  const sep = detectDelimiter(clean);
  // Split into RECORDS honouring quoted fields: a newline inside "…" belongs to
  // the field (RFC 4180), not a row break. The old `split(/\r?\n/)` tore such
  // fields apart and shifted every following cell of the row.
  const lines: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (inQuote) {
      cur += c;
      if (c === '"') {
        if (clean[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuote = false;
      }
    } else if (c === '"') {
      inQuote = true;
      cur += c;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i += 1;
      lines.push(cur);
      cur = '';
    } else cur += c;
  }
  lines.push(cur);
  const nonEmpty = lines.filter((l, i) => l.trim().length > 0 || i === 0);
  const header = splitCsvLine(nonEmpty[0] ?? '', sep).map((h) => h.trim());
  const body = nonEmpty.slice(1).map((l) => splitCsvLine(l, sep));

  // Shape problems are REPORTED, never silently repaired: a ragged row means
  // cells the user typed are about to be read as empty or dropped, and the
  // downstream "N rows unmatched" toast says nothing about why.
  const issues: string[] = [];
  const raggedRows: number[] = [];
  let skippedEmptyKeyRows = 0;
  for (let i = 0; i < body.length; i += 1) {
    const row = body[i];
    if (row.length !== header.length) raggedRows.push(i + 1);
    if (!(row[0] ?? '').trim()) skippedEmptyKeyRows += 1;
  }
  if (raggedRows.length > 0) {
    const shown = raggedRows.slice(0, 3).join('、');
    const suffix = raggedRows.length > 3 ? tr('等', '…') : '';
    issues.push(
      tr(
        `${raggedRows.length} 个数据行的列数与表头不符（第 ${shown}${suffix} 行）：缺的单元格按空值读取，多余的丢弃。请检查这些行是否漏了分隔符或引号。`,
        `${raggedRows.length} data row${raggedRows.length === 1 ? ' does' : 's do'} not match the header width (row${raggedRows.length === 1 ? '' : 's'} ${shown}${suffix}): missing cells read as empty and extra cells are dropped. Check for a missing separator or quote.`,
      ),
    );
  }
  if (skippedEmptyKeyRows > 0) {
    issues.push(
      tr(
        `${skippedEmptyKeyRows} 个数据行的第一列为空，已整行跳过（第一列是用于匹配的名称列）。`,
        `${skippedEmptyKeyRows} data row${skippedEmptyKeyRows === 1 ? ' has' : 's have'} an empty first column and ${skippedEmptyKeyRows === 1 ? 'was' : 'were'} skipped (column 1 is the label column used for matching).`,
      ),
    );
  }

  return { header, rows: body, delimiter: sep, issues, skippedEmptyKeyRows };
}

/** The label-normalisation used everywhere a tip label is matched. */
export function normalizeLabelKey(s: string): string {
  return s.trim().toLowerCase().replace(/_/g, ' ');
}

export type MatchKind = 'exact' | 'normalized' | 'unmatched' | 'duplicate';

export interface LabelJoinReport {
  matched: number;
  exact: number;
  normalized: number;
  unmatched: string[];
  /** Tree-side labels hit by more than one matrix row — ambiguous by definition. */
  duplicates: string[];
}

/**
 * Match matrix row labels against a project's tip labels. The four-state report
 * (exact / normalized / unmatched / duplicate) is what makes a partial join
 * visible BEFORE the user commits, instead of a silent 87% mapping that
 * poisons everything downstream.
 */
export function joinLabels(
  project: Project,
  labels: string[],
): { map: Map<string, NodeId>; report: LabelJoinReport } {
  const exact = new Map<string, NodeId>();
  const norm = new Map<string, NodeId>();
  const report: LabelJoinReport = {
    matched: 0,
    exact: 0,
    normalized: 0,
    unmatched: [],
    duplicates: [],
  };
  for (const n of Object.values(project.nodes)) {
    if (n.childrenIds.length > 0) continue;
    if (!exact.has(n.label)) exact.set(n.label, n.id);
    const key = normalizeLabelKey(n.label);
    if (!norm.has(key)) norm.set(key, n.id);
  }
  const map = new Map<string, NodeId>();
  for (const label of labels) {
    const byExact = exact.get(label);
    if (byExact) {
      map.set(label, byExact);
      report.exact += 1;
      report.matched += 1;
      continue;
    }
    const byNorm = norm.get(normalizeLabelKey(label));
    if (byNorm) {
      map.set(label, byNorm);
      report.normalized += 1;
      report.matched += 1;
      continue;
    }
    report.unmatched.push(label);
  }
  // Duplicates: two matrix rows normalising to the same tip.
  const seenNorm = new Map<string, string>();
  for (const label of labels) {
    if (!map.has(label)) continue;
    const key = normalizeLabelKey(label);
    const first = seenNorm.get(key);
    if (first !== undefined && first !== label && !report.duplicates.includes(key)) {
      report.duplicates.push(key);
    }
    if (first === undefined) seenNorm.set(key, label);
  }
  return { map, report };
}

/**
 * The members of one discrete table cell. `A/B` lists its states; the compact
 * `(AB)` form is the documented polymorphism syntax — splitting it per
 * CHARACTER (NEXUS-style) is what the promise says and what makes `(AB)` a set
 * of A and B rather than one monomorphic state labelled "AB".
 */
function polymorphicMembers(raw: string): string[] {
  const t = raw.trim();
  const paren = /^\((.*)\)$/.exec(t);
  if (!paren) return t === '' ? [] : t.split('/').map((x) => x.trim());
  const inner = paren[1];
  if (inner.includes('/')) return inner.split('/').map((x) => x.trim());
  return [...inner];
}

export interface MatrixImportResult {
  characters: Character[];
  /** rows joined to nodes: applied per character. */
  matchedTips: number;
  report: LabelJoinReport;
  issues: string[];
}

/**
 * Import a CSV/TSV character matrix: first column = tip label, every further
 * column = one character. A column is continuous when every non-empty value is
 * numeric, discrete otherwise; discrete cells may be multi-state (`A/B` or
 * `(AB)` → polymorphic set), `?`/`-`/empty → missing. Returns the built
 * characters with transient per-label assignments for the caller to apply.
 */
export function importMatrixTable(text: string, projectName: string): MatrixImportResult {
  const table = parseTable(text);
  if (table.header.length < 2) {
    throw new Error(
      tr(
        '性状表至少需要两列：第 1 列为分类单元名，其后每列一个性状',
        'A character table needs at least two columns: column 1 = taxon label, then one column per character',
      ),
    );
  }
  const labels: string[] = [];
  const columns: { name: string; values: Map<string, string> }[] = table.header
    .slice(1)
    .map((h) => ({ name: h.trim() || tr('未命名性状', 'Unnamed character'), values: new Map<string, string>() }));
  for (const row of table.rows) {
    const label = (row[0] ?? '').trim();
    if (!label) continue;
    labels.push(label);
    for (let c = 1; c <= columns.length; c += 1) {
      const v = (row[c] ?? '').trim();
      if (v) columns[c - 1].values.set(label, v);
    }
  }
  if (labels.length === 0) {
    throw new Error(tr('表格没有数据行', 'The table has no data rows'));
  }

  const characters: Character[] = [];
  // Shape problems of the table itself (ragged rows, skipped key-empty rows)
  // surface alongside the per-column notes below.
  const issues: string[] = [...table.issues];
  for (const col of columns) {
    const values = [...col.values.values()];
    const toNumber = (v: string): number => Number(v.replace(/,/g, '.'));
    const allNumeric = values.length > 0 && values.every((v) => Number.isFinite(toNumber(v)));
    if (allNumeric) {
      characters.push({
        id: newId(),
        name: col.name,
        type: 'continuous',
        states: [],
        lowColor: '#60a5fa',
        highColor: '#f97316',
      });
      (characters[characters.length - 1] as Character & { __values?: Map<string, number> }).__values =
        new Map([...col.values.entries()].map(([k, v]) => [k, toNumber(v)]));
      continue;
    }
    // NEAR-continuous column: most values parse as numbers but a few do not.
    // This is exactly how a single stray cell ("N/A", a stray footnote, a
    // decimal comma mis-locale) silently flipped a whole column from a
    // continuous trait to a discrete one — every downstream statistic then ran
    // on a different kind of data with no warning. Say which cells did it; the
    // column is still discrete (the values ARE non-numeric), but the user can
    // fix the sheet and re-import instead of trusting a quietly changed type.
    const numericCount = values.filter((v) => Number.isFinite(toNumber(v))).length;
    if (numericCount > 0 && numericCount >= values.length / 2) {
      const offenders = [...col.values.entries()]
        .filter(([, v]) => !Number.isFinite(toNumber(v)))
        .slice(0, 3)
        .map(([label, v]) => tr(`「${label}」的「${v}」`, `"${v}" (row ${JSON.stringify(label)})`));
      const suffix = values.length - numericCount > 3 ? tr('等', '…') : '';
      issues.push(
        tr(
          `列「${col.name}」以数值为主，但 ${values.length - numericCount} 个单元格不是数值（${offenders.join('、')}${suffix}），整列因此按离散性状处理。若这些值本应是缺失，请留空或写 ?，重新导入即按连续性状处理。`,
          `Column "${col.name}" is mostly numeric, but ${values.length - numericCount} cell${values.length - numericCount === 1 ? ' is' : 's are'} not numbers (${offenders.join('; ')}${suffix}), so the whole column is imported as DISCRETE. If those cells should be missing, leave them empty or write ? and re-import to get a continuous character.`,
        ),
      );
    }
    // Discrete: state universe = observed values (minus missing codes), capped
    // with the same honest warning the manual pipeline uses.
    const used = new Set<string>();
    for (const raw of values) {
      for (const t of polymorphicMembers(raw)) {
        if (t && !MISSING_STATE_CODES.includes(t)) used.add(t);
      }
    }
    const stateList = [...used].sort();
    if (stateList.length < 2) {
      issues.push(
        tr(
          `列「${col.name}」只观测到一个状态，已跳过（单一状态无信息）`,
          `Column "${col.name}" shows only one state and was skipped (a single state carries no signal)`,
        ),
      );
      continue;
    }
    if (stateList.length > 39) {
      issues.push(
        tr(
          `列「${col.name}」有 ${stateList.length} 个状态，超过颜色可区分上限 39，颜色将循环且不可靠`,
          `Column "${col.name}" has ${stateList.length} states, above the 39-state colour limit; colours will repeat and are not reliable`,
        ),
      );
    }
    const ch: Character = {
      id: newId(),
      name: col.name,
      type: 'discrete',
      states: stateList.map((s, i) => ({ ...newCharacterState(s, i), color: stateColorFor(i) })),
    };
    const assignments: Record<string, string | string[]> = {};
    for (const [label, raw] of col.values) {
      const ids: string[] = [];
      for (const t of polymorphicMembers(raw)) {
        if (!t || MISSING_STATE_CODES.includes(t)) continue;
        const st = ch.states.find((x) => x.label === t);
        if (st) ids.push(st.id);
      }
      if (ids.length === 0) continue;
      assignments[label] = ids.length === 1 ? ids[0] : ids;
    }
    (ch as Character & { __assignments?: Record<string, string | string[]> }).__assignments =
      assignments;
    characters.push(ch);
  }

  return {
    characters,
    matchedTips: 0,
    report: { matched: 0, exact: 0, normalized: 0, unmatched: [], duplicates: [] },
    issues,
  };
}

/** Apply a parsed matrix to the document (shared by file and clipboard paths). */
export function applyMatrixImport(project: Project, result: MatrixImportResult): {
  appliedCharacters: number;
  matchedTips: number;
  report: LabelJoinReport;
} {
  const labels = new Set<string>();
  for (const ch of result.characters) {
    const bag = ch as Character & { __assignments?: Record<string, string | string[]>; __values?: Map<string, number> };
    for (const label of bag.__assignments ? Object.keys(bag.__assignments) : []) labels.add(label);
    for (const label of bag.__values ? [...bag.__values.keys()] : []) labels.add(label);
  }
  const { map, report } = joinLabels(project, [...labels]);
  for (const ch of result.characters) {
    project.characters.push(ch);
    const bag = ch as Character & { __assignments?: Record<string, string | string[]>; __values?: Map<string, number> };
    const apply = (label: string, value: string | string[] | number): void => {
      const nodeId = map.get(label);
      if (!nodeId) return;
      const node = project.nodes[nodeId];
      if (!node.charStates) node.charStates = {};
      node.charStates[ch.id] = value;
    };
    if (bag.__assignments) {
      for (const [label, v] of Object.entries(bag.__assignments)) apply(label, v);
      delete bag.__assignments;
    }
    if (bag.__values) {
      for (const [label, v] of bag.__values) apply(label, v);
      delete bag.__values;
    }
  }
  return { appliedCharacters: result.characters.length, matchedTips: report.matched, report };
}

/**
 * Join an annotations table (metadata: accession / host / country / date /
 * lineage, …) onto the tips. First column = tip label; every other column is
 * stored verbatim on `node.annotations` — structured and queryable, unlike the
 * free-form `meta` bag.
 */
export function importAnnotationsTable(
  project: Project,
  text: string,
): { applied: number; report: LabelJoinReport; issues: string[] } {
  const table = parseTable(text);
  // Ragged rows / key-empty rows are structural: they change what a join can
  // match, so they travel back with the result for the caller to surface.
  const shapeIssues = [...table.issues];
  if (table.header.length < 2) {
    throw new Error(
      tr(
        '注释表至少需要两列：第 1 列为分类单元名，其后每列一个注释字段',
        'An annotation table needs at least two columns: column 1 = taxon label, then one column per field',
      ),
    );
  }
  const fields = table.header.slice(1).map((h) => h.trim() || tr('未命名字段', 'Unnamed field'));
  const labels: string[] = [];
  const rows: { label: string; values: (string | number)[] }[] = [];
  for (const row of table.rows) {
    const label = (row[0] ?? '').trim();
    if (!label) continue;
    labels.push(label);
    rows.push({
      label,
      values: fields.map((_, i) => {
        const v = (row[i + 1] ?? '').trim();
        if (v === '') return '';
        // Coerce to a number only for a PLAIN decimal: an identifier-shaped
        // string with a leading zero ("007", "0042-B") must survive as text —
        // Number() used to silently rewrite it as 7.
        const norm = v.replace(/,/g, '.');
        return /^-?\d+(\.\d+)?$/.test(norm) && !/^-?0\d/.test(norm) ? Number(norm) : v;
      }),
    });
  }
  const { map, report } = joinLabels(project, labels);
  let applied = 0;
  for (const row of rows) {
    const nodeId = map.get(row.label);
    if (!nodeId) continue;
    const node = project.nodes[nodeId];
    if (!node.annotations) node.annotations = {};
    fields.forEach((f, i) => {
      const v = row.values[i];
      if (v !== '' && v !== undefined) node.annotations![f] = v;
    });
    applied += 1;
  }
  return { applied, report, issues: shapeIssues };
}

/** Calibration table: node label, min age, max age, optional label/source. */
export function importCalibrationTable(
  project: Project,
  text: string,
): { applied: number; report: LabelJoinReport; issues: string[] } {
  const table = parseTable(text);
  const issues: string[] = [...table.issues];
  const labels: string[] = [];
  const rows: { label: string; min: number; max: number; name?: string; source?: string }[] = [];
  for (const row of table.rows) {
    const label = (row[0] ?? '').trim();
    const min = Number((row[1] ?? '').replace(/,/g, '.'));
    const max = Number((row[2] ?? '').replace(/,/g, '.'));
    if (!label) continue;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
      issues.push(
        tr(
          `校准行「${label}」的年龄区间无效（min=${row[1]}, max=${row[2]}），已跳过`,
          `Calibration row "${label}" has an invalid age range (min=${row[1]}, max=${row[2]}); skipped`,
        ),
      );
      continue;
    }
    labels.push(label);
    rows.push({ label, min, max, name: (row[3] ?? '').trim() || undefined, source: (row[4] ?? '').trim() || undefined });
  }
  const { map, report } = joinLabels(project, labels);
  let applied = 0;
  for (const row of rows) {
    const nodeId = map.get(row.label);
    if (!nodeId) continue;
    project.calibrationPoints = project.calibrationPoints ?? [];
    project.calibrationPoints.push({
      id: newId(),
      nodeId,
      minAge: row.min,
      maxAge: row.max,
      label: row.name,
      source: row.source,
    });
    applied += 1;
  }
  return { applied, report, issues };
}

/** Serialise the tip-state matrix as CSV (first column = taxon label). */
export function exportMatrixCsv(project: Project): string {
  const tips = Object.values(project.nodes)
    .filter((n) => n.childrenIds.length === 0)
    .sort((a, b) => a.label.localeCompare(b.label));
  const chars = project.characters;
  const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [];
  lines.push(['taxon', ...chars.map((c) => escape(c.name))].join(','));
  for (const tip of tips) {
    const cells = chars.map((c) => {
      const v = tip.charStates?.[c.id];
      if (v === undefined) return '';
      if (Array.isArray(v)) return v
        .map((id) => c.states.find((s) => s.id === id)?.label ?? id)
        .join('/');
      if (typeof v === 'number') return String(v);
      return c.states.find((s) => s.id === v)?.label ?? v;
    });
    // State labels are user text too: a comma inside one used to break the
    // column alignment of the whole exported matrix.
    lines.push([escape(tip.label), ...cells.map(escape)].join(','));
  }
  return lines.join('\n');
}

/** Serialise the tip annotations as CSV. */
export function exportAnnotationsCsv(project: Project): string {
  const tips = Object.values(project.nodes)
    .filter((n) => n.childrenIds.length === 0)
    .sort((a, b) => a.label.localeCompare(b.label));
  const fields = [...new Set(tips.flatMap((t) => Object.keys(t.annotations ?? {})))];
  const escape = (v: unknown): string => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  lines.push(['taxon', ...fields.map(escape)].join(','));
  for (const tip of tips) {
    lines.push([escape(tip.label), ...fields.map((f) => escape(tip.annotations?.[f]))].join(','));
  }
  return lines.join('\n');
}

/** An empty template the user fills in a spreadsheet and drags back. */
export function exportMatrixTemplate(project: Project, characters?: Character[]): string {
  const tips = Object.values(project.nodes)
    .filter((n) => n.childrenIds.length === 0)
    .sort((a, b) => a.label.localeCompare(b.label));
  const cols = (characters ?? project.characters).map((c) => c.name);
  const header = ['taxon', ...(cols.length > 0 ? cols : ['character 1'])];
  return [header.join(','), ...tips.map((t) => t.label)].join('\n');
}
