// Native project (.cladeforge.json) serialisation. Full fidelity: topology,
// manual positions, styles and custom edges.
//
// On load we run a small pipeline: parse JSON -> version migration (scaffold for
// forward-compatible schema changes) -> defensive backfill of missing settings
// (so a partial, foreign or hand-edited file still opens) -> referential-
// integrity validation & repair. `readProjectFile` returns any repairs made so
// the UI can surface them; `parseProject` is the thin "just give me the project"
// wrapper.

import { tr } from '../ui/strings';
import { notify } from '../ui/toast';
import {
  DEFAULT_CANVAS,
  DEFAULT_LAYOUT,
  DEFAULT_RECON_COSTS,
  PROJECT_VERSION,
  defaultStyleDefaults,
  type GeneTreeEntry,
  type Project,
} from '../model/types';
import { newId } from '../model/treeOps';
import { defaultLayers, pruneLayerStore } from '../model/layers';
import { validateProject } from '../model/validate';
import { assertProjectInput, stripBom } from './limits';
import {
  classifyStorageError,
  failureMessage,
  recordAutosave,
  type WriteResult,
} from './autosave';

interface ProjectFile {
  app: 'CladeForge';
  version: string;
  project: Project;
}

/**
 * Top-level Project keys this build knows about. Anything else found in a file
 * is *preserved*, not silently discarded.
 */
const KNOWN_PROJECT_KEYS: readonly string[] = [
  'id',
  'name',
  'version',
  'nodes',
  'rootId',
  'customEdges',
  'layout',
  'canvas',
  'defaults',
  'characters',
  'events',
  'layers',
  'activeLayerId',
  'layerStore',
  'environmentalEvents',
  'calibrationPoints',
  'geneTrees',
  'reconCosts',
  'sampleId',
];

export function serializeProject(project: Project): string {
  // The envelope repeats the document's own version instead of stamping this
  // build's: a file that was opened "with best effort" from a newer schema must
  // not come back claiming a version it was never validated against.
  const payload: ProjectFile = {
    app: 'CladeForge',
    version: project.version || PROJECT_VERSION,
    project,
  };
  return JSON.stringify(payload, null, 2);
}

// --- version migration -------------------------------------------------------
// Each migration upgrades a raw project object from one schema version to the
// next. `0.1.0` is the initial schema, so the registry is empty today, but the
// machinery is in place so future schema changes have an explicit, ordered
// upgrade path instead of silently overwriting the version field.
type RawProject = Record<string, unknown>;
interface Migration {
  to: string;
  run: (raw: RawProject) => RawProject;
}
const MIGRATIONS: Record<string, Migration> = {};

function migrate(raw: RawProject, fromVersion: string): { raw: RawProject; notes: string[] } {
  const notes: string[] = [];
  let version = fromVersion;
  const guard = new Set<string>();
  while (version !== PROJECT_VERSION && MIGRATIONS[version] && !guard.has(version)) {
    guard.add(version);
    const step = MIGRATIONS[version];
    raw = step.run(raw);
    notes.push(tr(`已从 ${version} 迁移到 ${step.to}`, `Migrated from ${version} to ${step.to}`));
    version = step.to;
  }
  if (version !== PROJECT_VERSION) {
    notes.push(tr(`文件版本为 ${fromVersion}，将按当前版本 ${PROJECT_VERSION} 尽力打开`, `File version ${fromVersion}; opening with best effort under current version ${PROJECT_VERSION}`));
  }
  return { raw, notes };
}

/**
 * A DTL cost must be a real, finite, non-negative NUMBER. A bare `Number(value)`
 * coercion would accept `null`, `''` and `[]` — all of which coerce to 0 — so a
 * hand-edited `"dup": null` would make gene duplication free and let the DP
 * duplicate without limit, with nothing in `issues` to hint at it.
 * Non-numeric input is rejected *and* reported.
 */
function costOr(value: unknown, fallback: number, field: string, notes: string[]): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  const shown = value === undefined ? tr('缺失', 'absent') : JSON.stringify(value) ?? String(value);
  notes.push(
    tr(
      `重建代价 ${field} 的值「${shown}」不是有效的非负数，已改用默认值 ${fallback}`,
      `Reconciliation cost ${field} = "${shown}" is not a valid non-negative number; fell back to the default ${fallback}`,
    ),
  );
  return fallback;
}

/** Read one cost bag, reporting every field that had to be replaced. */
function backfillCosts(value: unknown, notes: string[]): typeof DEFAULT_RECON_COSTS {
  const out = { ...DEFAULT_RECON_COSTS };
  if (!value || typeof value !== 'object') return out;
  const raw = value as Record<string, unknown>;
  const fields: (keyof typeof out)[] = ['dup', 'transfer', 'loss'];
  for (const f of fields) {
    // An absent key is an ordinary backfill to the default; a present-but-junk
    // key is a repair the user has to hear about.
    if (!Object.prototype.hasOwnProperty.call(raw, f)) continue;
    out[f] = costOr(raw[f], DEFAULT_RECON_COSTS[f], f, notes);
  }
  return out;
}

/** Parse + migrate + backfill + validate, returning the project and any repairs. */
export function readProjectFile(text: string): { project: Project; issues: string[] } {
  // A BOM would make JSON.parse fail on a file merely resaved by Notepad.
  const source = stripBom(text);
  assertProjectInput(source);
  const data = JSON.parse(source) as Partial<ProjectFile> & Partial<Project>;
  const fileVersion = (data as ProjectFile).version ?? (data as Project).version ?? '0';

  // Accept either the wrapped file or a bare Project object.
  const rawSource = ((data as ProjectFile).project ?? (data as unknown as Project)) as
    | (Project & RawProject)
    | undefined;
  if (!rawSource || typeof rawSource !== 'object' || !rawSource.nodes || !rawSource.rootId) {
    throw new Error('Not a valid CladeForge project file');
  }
  if (!rawSource.nodes[rawSource.rootId]) {
    throw new Error('Project root node is missing');
  }

  return finalizeProject(rawSource as Project & RawProject, String(fileVersion));
}

/** Migrate + backfill + validate a raw project object into a ready-to-use Project. */
function finalizeProject(
  rawSource: Project & RawProject,
  fileVersion: string,
): { project: Project; issues: string[] } {
  const { raw: migrated, notes } = migrate(rawSource as RawProject, fileVersion);
  const raw = migrated as unknown as Project;

  const defaults = raw.defaults ?? defaultStyleDefaults();
  const backfilled: Project = {
    id: raw.id ?? newId(),
    name: raw.name ?? 'Untitled',
    // Keep the version the file declared; re-stamping it would make a lossy open
    // look like a valid current document.
    version: typeof raw.version === 'string' && raw.version ? raw.version : PROJECT_VERSION,
    nodes: raw.nodes,
    rootId: raw.rootId,
    customEdges: Array.isArray(raw.customEdges) ? raw.customEdges : [],
    layout: { ...DEFAULT_LAYOUT, ...raw.layout },
    canvas: { ...DEFAULT_CANVAS, ...raw.canvas },
    defaults: {
      node: { ...defaultStyleDefaults().node, ...defaults.node },
      branch: { ...defaultStyleDefaults().branch, ...defaults.branch },
      edge: { ...defaultStyleDefaults().edge, ...defaults.edge },
      branchGradient: { ...defaultStyleDefaults().branchGradient, ...defaults.branchGradient },
    },
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    layers: Array.isArray(raw.layers) ? raw.layers : [],
    activeLayerId: typeof raw.activeLayerId === 'string' ? raw.activeLayerId : '',
    layerStore: raw.layerStore && typeof raw.layerStore === 'object' ? raw.layerStore : {},
    environmentalEvents: Array.isArray(raw.environmentalEvents) ? raw.environmentalEvents : [],
    calibrationPoints: Array.isArray(raw.calibrationPoints) ? raw.calibrationPoints : [],
    // DTL reconciliation: backfill the keys a partial file omits. A nested gene
    // doc never carries its own geneTrees — strip the key defensively so the
    // embedded-project shape stays one level deep.
    geneTrees: Array.isArray(raw.geneTrees)
      ? raw.geneTrees.map((g) => {
          const { geneTrees: _nested, ...doc } = (g?.doc ?? {}) as Partial<Project>;
          return { ...g, doc } as GeneTreeEntry;
        })
      : [],
    reconCosts: backfillCosts(raw.reconCosts, notes),
  };

  // Carry unknown top-level fields through verbatim — a key written by a newer
  // build, another tool or a hand-edit would otherwise vanish while the document
  // is re-stamped as current. They live on the project object itself, so
  // `serializeProject` writes them back exactly where they came from, and each
  // preserved / discarded key is named in `issues`.
  const extras = rawSource as RawProject;
  const preserved: string[] = [];
  for (const key of Object.keys(extras)) {
    if (KNOWN_PROJECT_KEYS.includes(key)) continue;
    (backfilled as unknown as RawProject)[key] = extras[key];
    preserved.push(key);
  }
  if (preserved.length) {
    notes.push(
      tr(
        `已原样保留 ${preserved.length} 个本版本不识别的工程字段（${preserved.slice(0, 8).join(', ')}${preserved.length > 8 ? ' …' : ''}），保存时会写回`,
        `Preserved ${preserved.length} field(s) this build does not understand (${preserved.slice(0, 8).join(', ')}${preserved.length > 8 ? ' …' : ''}); they are written back on save`,
      ),
    );
  }
  const strippedDocs = Array.isArray(raw.geneTrees)
    ? raw.geneTrees.filter(
        (g) => Array.isArray((g?.doc as unknown as RawProject | undefined)?.geneTrees) &&
          ((g.doc as unknown as RawProject).geneTrees as unknown[]).length > 0,
      ).length
    : 0;
  if (strippedDocs) {
    notes.push(
      tr(
        `${strippedDocs} 个嵌入基因树文档自带非空的 geneTrees，已丢弃（本格式只嵌套一层）`,
        `Dropped the non-empty nested geneTrees of ${strippedDocs} embedded gene-tree document(s); this format nests only one level`,
      ),
    );
  }

  // Every project needs at least one hypothesis layer; repair a file that lacks
  // one.
  if (backfilled.layers.length === 0) {
    Object.assign(backfilled, defaultLayers());
  } else if (!backfilled.layers.some((l) => l.id === backfilled.activeLayerId)) {
    backfilled.activeLayerId = backfilled.layers[0].id;
  }

  const { project, issues } = validateProject(backfilled);
  pruneLayerStore(project);

  // An embedded gene-tree document is a whole Project that the DTL solver, the
  // layout and the exporters all walk recursively. Validating only the outer
  // document would let a hand-edited or half-written file keep self-referential
  // and dangling `childrenIds` inside `geneTrees[i].doc` with nothing reported,
  // while the identical damage at the top level is repaired.
  const embedded: string[] = [];
  for (const entry of project.geneTrees ?? []) {
    const name = entry.name || entry.id;
    const doc = entry.doc as Project | undefined;
    if (!doc || typeof doc !== 'object' || !doc.nodes || !doc.rootId || !doc.nodes[doc.rootId]) {
      embedded.push(
        tr(
          `基因树「${name}」的内嵌文档无效，已跳过`,
          `Gene tree "${name}" carries an invalid embedded document; it was skipped`,
        ),
      );
      continue;
    }
    try {
      const repaired = validateProject(doc);
      entry.doc = repaired.project;
      for (const msg of repaired.issues) {
        embedded.push(tr(`基因树「${name}」：${msg}`, `Gene tree "${name}": ${msg}`));
      }
    } catch (e) {
      embedded.push(
        tr(
          `基因树「${name}」无法完成结构校验（${(e as Error).message}）`,
          `Gene tree "${name}" could not be structurally validated (${(e as Error).message})`,
        ),
      );
    }
  }

  return { project, issues: [...notes, ...issues, ...embedded] };
}

/** Convenience wrapper that discards repair notes. */
export function parseProject(text: string): Project {
  return readProjectFile(text).project;
}

// --- autosave (localStorage) ---------------------------------------------------
// Single-document autosave. The app persists the whole workspace (see
// writeWorkspace below), so this key is READ-ONLY here: it is kept so a last
// document stored under it still gets restored on launch instead of being
// ignored.

const AUTOSAVE_KEY = 'cladeforge:autosave';

/** Load the most recent autosave snapshot, or null when absent / corrupt. */
export function readAutoSave(): Project | null {
  let text: string | null = null;
  try {
    text = localStorage.getItem(AUTOSAVE_KEY);
  } catch (e) {
    notify.error(failureMessage(classifyStorageError(e)));
    return null;
  }
  if (!text) return null;
  try {
    return readProjectFile(text).project;
  } catch (e) {
    // A snapshot that exists but cannot be opened is data loss, not "no
    // autosave yet"; returning null here would hide it.
    notify.error(
      tr(
        `上次的单文档自动存档无法打开：${e instanceof Error ? e.message : String(e)}`,
        `The last single-document autosave could not be opened: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    return null;
  }
}

// --- workspace (all open tabs) -----------------------------------------------
// The multi-tab workspace is autosaved as one blob so a restart restores every
// open document and the active tab. Falls back to the single-project autosave
// above when no workspace snapshot exists.

const WORKSPACE_KEY = 'cladeforge:workspace';
/** A corrupt snapshot is copied here instead of being overwritten blind. */
const WORKSPACE_QUARANTINE_KEY = 'cladeforge:workspace.corrupt';

interface WorkspaceFile {
  app: 'CladeForge';
  kind: 'workspace';
  version: string;
  activeIndex: number;
  projects: Project[];
}

/**
 * Persist all open tabs + the active index.
 *
 * Returns the outcome: the status bar must not print "已保存" from a debounce
 * timer alone, because a quota-full or blocked localStorage — the one failure
 * that costs the user work — would otherwise look identical to a successful
 * save. The result is also published on the autosave channel, which raises the
 * warning toast, so no caller has to remember to check.
 */
export function writeWorkspace(projects: Project[], activeIndex: number): WriteResult {
  const payload: WorkspaceFile = {
    app: 'CladeForge',
    kind: 'workspace',
    version: PROJECT_VERSION,
    activeIndex,
    projects,
  };
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return recordAutosave({ ok: false, failure: 'serialize', message: failureMessage('serialize') });
  }
  try {
    localStorage.setItem(WORKSPACE_KEY, text);
    return recordAutosave({ ok: true, bytes: text.length });
  } catch (e) {
    const failure = classifyStorageError(e);
    return recordAutosave({
      ok: false,
      failure,
      bytes: text.length,
      message: failureMessage(failure, text.length),
    });
  }
}

export interface WorkspaceRestore {
  projects: Project[];
  activeIndex: number;
  /** Tabs that were present but unusable and had to be skipped. */
  skipped: number;
  /** Every repair / note collected while restoring the tabs. */
  issues: string[];
}

/**
 * Restore all open tabs, or null when absent / unreadable. Bad tabs are skipped
 * but *counted*, and a snapshot that cannot be parsed at all is copied aside
 * (`cladeforge:workspace.corrupt`) and announced: the app autosaves over this
 * key within a second, so a silent `catch → null` would destroy the only
 * evidence that a previous session existed.
 */
export function readWorkspace(): WorkspaceRestore | null {
  let text: string | null = null;
  try {
    text = localStorage.getItem(WORKSPACE_KEY);
  } catch (e) {
    const failure = classifyStorageError(e);
    notify.error(failureMessage(failure));
    return null;
  }
  if (!text) return null;
  let data: Partial<WorkspaceFile>;
  try {
    data = JSON.parse(text) as Partial<WorkspaceFile>;
  } catch {
    quarantine(text);
    notify.error(
      tr(
        '上次会话的工作区快照已损坏，无法读取（已另存为 workspace.corrupt 以便手工恢复）。窗口现在从新会话开始。',
        'The workspace snapshot from the last session is corrupt and could not be read (kept aside as workspace.corrupt for manual recovery). Starting a fresh session.',
      ),
    );
    return null;
  }
  if (!Array.isArray(data.projects) || data.projects.length === 0) return null;
  const projects: Project[] = [];
  const issues: string[] = [];
  let skipped = 0;
  for (const p of data.projects) {
    const src = p as Project & RawProject;
    if (!src || typeof src !== 'object' || !src.nodes || !src.rootId || !src.nodes[src.rootId]) {
      skipped += 1;
      continue;
    }
    try {
      const restored = finalizeProject(src, String(src.version ?? PROJECT_VERSION));
      projects.push(restored.project);
      issues.push(...restored.issues);
    } catch {
      skipped += 1;
    }
  }
  if (!projects.length) return null;
  return {
    projects,
    activeIndex: typeof data.activeIndex === 'number' ? data.activeIndex : 0,
    skipped,
    issues,
  };
}

function quarantine(text: string): void {
  try {
    localStorage.setItem(WORKSPACE_QUARANTINE_KEY, text);
  } catch {
    /* storage is already broken — nothing more we can do here */
  }
}
