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
}

/** Parse a CSV/TSV table (header row required). */
export function parseTable(text: string): ParsedTable {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) throw new Error(tr('表格内容为空', 'Table text is empty'));
  const sep = detectDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter((l, i) => l.trim().length > 0 || i === 0);
  const header = splitCsvLine(lines[0] ?? '', sep).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => splitCsvLine(l, sep));
  return { header, rows, delimiter: sep };
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
  const issues: string[] = [];
  for (const col of columns) {
    const values = [...col.values.values()];
    const allNumeric = values.length > 0 && values.every((v) => Number.isFinite(Number(v.replace(/,/g, '.'))));
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
        new Map([...col.values.entries()].map(([k, v]) => [k, Number(v.replace(/,/g, '.'))]));
      continue;
    }
    // Discrete: state universe = observed values (minus missing codes), capped
    // with the same honest warning the manual pipeline uses.
    const used = new Set<string>();
    for (const raw of values) {
      const cell = raw.replace(/^\((.*)\)$/, '$1');
      for (const s of cell.split('/')) {
        const t = s.trim();
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
      const cell = raw.replace(/^\((.*)\)$/, '$1');
      const ids: string[] = [];
      for (const s of cell.split('/')) {
        const t = s.trim();
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
): { applied: number; report: LabelJoinReport } {
  const table = parseTable(text);
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
        return v === '' ? '' : Number.isFinite(Number(v.replace(/,/g, '.'))) && v !== '' ? Number(v.replace(/,/g, '.')) : v;
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
  return { applied, report };
}

/** Calibration table: node label, min age, max age, optional label/source. */
export function importCalibrationTable(
  project: Project,
  text: string,
): { applied: number; report: LabelJoinReport; issues: string[] } {
  const table = parseTable(text);
  const issues: string[] = [];
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
    lines.push([escape(tip.label), ...cells].join(','));
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
