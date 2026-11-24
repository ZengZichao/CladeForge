// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
// NeXML export — the one exchange format designed for "tree + characters +
// metadata" together, readable by RNeXML / pynexml / DendroPy.
//
// The semantic layer (events, hypothesis layers, custom edges, calibrations)
// exists only inside .cladeforge.json; without an open carrier a Data
// Availability statement cannot point at anything a third party can parse.
// NeXML <meta> annotations are that carrier:
//   * events / custom edges → <meta> on the carrying element as ResourceMeta
//   * hypothesis layers → <meta> inside <otus>
//   * character state assignments → standard <characters>/<matrix> cells
//
// Writing only (reading NeXML is a separate work item and is not claimed).

import { tr } from '../ui/strings';
import type { Character, NodeId, Project, TreeNode } from '../model/types';
import { DEFAULT_CANVAS, DEFAULT_LAYOUT, PROJECT_VERSION, defaultStyleDefaults } from '../model/types';
import { defaultLayers } from '../model/layers';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A NeXML <meta> element carrying a JSON literal (ResourceMeta). */
function metaJson(indent: string, rel: string, value: unknown): string {
  const json = xmlEscape(JSON.stringify(value));
  return `${indent}<meta xsi:type="nex:ResourceMeta" rel="${rel}" content="${json}"/>`;
}

/**
 * Serialise a project as NeXML: OTUs (tips), a tree (edge lengths; the root
 * edge is omitted per NeXML convention), the character matrices, and the
 * semantic layer as annotations.
 */
export function serializeNexml(project: Project, notes?: string[]): string {
  const tips = Object.values(project.nodes).filter((n) => n.childrenIds.length === 0);
  const otuId = new Map<NodeId, string>();
  tips.forEach((t, i) => otuId.set(t.id, `otu${i + 1}`));
  const nodeIdOf = new Map<NodeId, string>();
  nodeIdOf.set(project.rootId, 'node_root');
  let seq = 0;
  for (const id of Object.keys(project.nodes) as NodeId[]) {
    if (id === project.rootId) continue;
    nodeIdOf.set(id, `node${++seq}`);
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<nex:nexml xmlns="http://www.nexml.org/2009" xmlns:nex="http://www.nexml.org/2009" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="0.9" generator="CladeForge">',
  );
  lines.push(`  <otus id="otus1" label="${xmlEscape(project.name || 'tree')}">`);
  for (const t of tips) {
    lines.push(`    <otu id="${otuId.get(t.id)}" label="${xmlEscape(t.label)}"/>`);
  }
  // Document-level semantic annotations: hypothesis layers + provenance.
  lines.push(metaJson('    ', 'cladeforge:hypothesis-layers', project.layers));
  if (project.provenance) lines.push(metaJson('    ', 'cladeforge:provenance', project.provenance));
  lines.push('  </otus>');

  // Characters: discrete (standard cells) and continuous.
  const discrete = project.characters.filter((c) => c.type === 'discrete' && c.states.length > 0);
  const continuous = project.characters.filter((c) => c.type === 'continuous');
  if (discrete.length > 0) {
    lines.push('  <characters id="chars1" xsi:type="nex:StandardCells" otus="otus1">');
    lines.push('    <format>');
    discrete.forEach((c, ci) => {
      lines.push(`      <char id="char${ci + 1}" label="${xmlEscape(c.name)}" states="states${ci + 1}"/>`);
    });
    lines.push('    </format>');
    discrete.forEach((c, ci) => {
      lines.push(`    <states id="states${ci + 1}">`);
      c.states.forEach((s, si) => {
        const symbol = xmlEscape(s.label.slice(0, 1) || String(si + 1));
        lines.push(`      <state id="states${ci + 1}_s${si + 1}" symbol="${symbol}" label="${xmlEscape(s.label)}"/>`);
      });
      lines.push('    </states>');
    });
    lines.push('    <matrix>');
    let droppedPolymorphic = 0;
    for (const t of tips) {
      const cells: string[] = [];
      discrete.forEach((c, ci) => {
        const v = t.charStates?.[c.id];
        if (v === undefined) return;
        if (Array.isArray(v)) {
          // NeXML's one-state cell format cannot carry a polymorphic set. The
          // old comment claimed "(noted below)" while nothing below noted
          // anything; the drop is now REPORTED through `notes` so the caller
          // can surface it (the project's own partial-data rule).
          droppedPolymorphic += 1;
          return;
        }
        const si = c.states.findIndex((s) => s.id === v);
        if (si >= 0) cells.push(`<cell char="char${ci + 1}" state="states${ci + 1}_s${si + 1}"/>`);
      });
      if (cells.length > 0) {
        lines.push(`      <row id="row_${otuId.get(t.id)}" otu="${otuId.get(t.id)}">${cells.join('')}</row>`);
      }
    }
    lines.push('    </matrix>');
    if (droppedPolymorphic > 0 && notes) {
      notes.push(
        tr(
          `NeXML 导出丢弃了 ${droppedPolymorphic} 个多态（多状态）单元格：NeXML 的单状态 cell 格式无法表达多态记载。如需完整数据请导出 CSV 或 NEXUS。`,
          `The NeXML export dropped ${droppedPolymorphic} polymorphic (multi-state) cell${droppedPolymorphic === 1 ? '' : 's'}: NeXML's one-state cell format cannot carry a polymorphic record. Export CSV or NEXUS for the full data.`,
        ),
      );
    }
    lines.push('  </characters>');
  }
  if (continuous.length > 0) {
    lines.push('  <characters id="chars2" xsi:type="nex:ContinuousCells" otus="otus1">');
    lines.push('    <format>');
    continuous.forEach((c, ci) => {
      lines.push(`      <char id="cont${ci + 1}" label="${xmlEscape(c.name)}"/>`);
    });
    lines.push('    </format>');
    lines.push('    <matrix>');
    for (const t of tips) {
      const cells: string[] = [];
      continuous.forEach((c, ci) => {
        const v = t.charStates?.[c.id];
        if (typeof v === 'number') cells.push(`<cell char="cont${ci + 1}" state="${v}"/>`);
      });
      if (cells.length > 0) {
        lines.push(`      <row id="crow_${otuId.get(t.id)}" otu="${otuId.get(t.id)}">${cells.join('')}</row>`);
      }
    }
    lines.push('    </matrix>');
    lines.push('  </characters>');
  }

  // Tree.
  lines.push('  <trees id="trees1" otus="otus1">');
  lines.push('    <tree id="tree1" label="tree1">');
  for (const id of Object.keys(project.nodes) as NodeId[]) {
    const n = project.nodes[id];
    if (!n) continue;
    const nid = nodeIdOf.get(id) as string;
    const labelAttr = n.label ? ` label="${xmlEscape(n.label)}"` : '';
    const supportAttr = typeof n.support === 'number' && !n.label ? ` support="${n.support}"` : '';
    const otuAttr = otuId.has(id) ? ` otu="${otuId.get(id)}"` : '';
    lines.push(`      <node id="${nid}"${labelAttr}${supportAttr}${otuAttr}/>`);
  }
  for (const id of Object.keys(project.nodes) as NodeId[]) {
    const n = project.nodes[id];
    if (!n) continue;
    for (const cid of n.childrenIds) {
      const c = project.nodes[cid];
      if (!c) continue;
      const clen = typeof c.branchLength === 'number' ? ` length="${c.branchLength}"` : '';
      const nodeEvents = project.events.filter((e) => e.nodeId === cid);
      if (nodeEvents.length > 0) {
        lines.push(`      <edge source="${nodeIdOf.get(id)}" target="${nodeIdOf.get(cid)}"${clen}>`);
        lines.push(metaJson('        ', 'cladeforge:events', nodeEvents));
        lines.push('      </edge>');
      } else {
        lines.push(`      <edge source="${nodeIdOf.get(id)}" target="${nodeIdOf.get(cid)}"${clen}/>`);
      }
    }
  }
  // Custom (net-like) edges as root-level rootedge-style records with metadata.
  for (const e of project.customEdges) {
    lines.push(`      <rootedge id="re_${xmlEscape(e.id)}" source="${nodeIdOf.get(e.sourceId) ?? ''}" target="${nodeIdOf.get(e.targetId) ?? ''}">`);
    lines.push(
      metaJson('        ', 'cladeforge:custom-edge', {
        kind: e.kind ?? 'association',
        label: e.label,
        note: e.note,
      }),
    );
    lines.push('      </rootedge>');
  }
  lines.push('    </tree>');
  lines.push('  </trees>');
  lines.push('</nex:nexml>');
  return lines.join('\n');
}

/** The user-facing capability statement shown next to the export action. */
export function nexmlExportNote(): string {
  return tr(
    '导出 NeXML（树 + 性状 + 语义注记；RNeXML / pynexml / DendroPy 可读）。事件与假说层以 cladeforge: 注记携带',
    'Export NeXML (tree + characters + semantic annotations; readable by RNeXML / pynexml / DendroPy). Events and hypothesis layers travel as cladeforge: annotations',
  );
}

// --- import -----------------------------------------------------------------
// Reading back what `serializeNexml` writes, plus the parts a third-party
// NeXML file is likely to carry: OTUs, one-or-more trees with branch lengths,
// StandardCells / ContinuousCells character matrices, and the cladeforge:
// semantic annotations. Multi-polymorphic cells are reported and skipped for
// the same reason the exporter refuses them.

interface ParsedCharacter {
  id: string;
  name: string;
  type: 'discrete' | 'continuous';
  states: { id: string; label: string }[];
  /** otu id -> state id (discrete) or numeric value (continuous). */
  assignments: Map<string, string | number>;
}

interface ParsedTree {
  nodes: TreeNode[];
  rootIndex: number;
  /** Tree-level event annotations keyed by child node index. */
  eventsByNode: Map<number, unknown[]>;
}

/** XML prefixes are aliases: compare the local name, not `tagName`. */
function localName(el: Element): string {
  return el.localName || el.tagName.split(':').pop() || '';
}

/** Only a NeXML root establishes the namespace used by scientific elements. */
function resolveNexmlNamespace(xml: Document): string | null {
  const namespaceURI = xml.documentElement?.namespaceURI;
  return namespaceURI === NEXML_NAMESPACE ? namespaceURI : null;
}

/** Scientific elements must belong to NeXML, regardless of their prefix. */
function descendants(el: Document | Element, name: string, namespaceURI: string | null): Element[] {
  if (!namespaceURI) return [];
  return Array.from(el.getElementsByTagNameNS(namespaceURI, name));
}

/** Ordinary NeXML attributes are unqualified; namespaced lookalikes do not match. */
function attr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';
const NEXML_NAMESPACE = 'http://www.nexml.org/2009';

/** Resolve a qualified attribute by namespace URI and local name, not by prefix. */
function namespacedAttr(el: Element, namespaceURI: string, name: string): string | null {
  return el.getAttributeNS(namespaceURI, name);
}

function parseJsonMeta(el: Element | null): unknown {
  if (!el) return undefined;
  const content = attr(el, 'content');
  if (!content) return undefined;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function metaChildren(el: Element, rel: string, namespaceURI: string | null): Element[] {
  return Array.from(el.children).filter(
    (c) => c.namespaceURI === namespaceURI && localName(c) === 'meta' && attr(c, 'rel') === rel,
  );
}

/** Parse OTU labels and the cladeforge: hypothesis/provenance annotations. */
function parseOtus(xml: Document, namespaceURI: string | null): {
  otuLabel: Map<string, string>;
  layers: Project['layers'];
  provenance: Project['provenance'];
} {
  const otusEl = descendants(xml, 'otus', namespaceURI)[0];
  const otuLabel = new Map<string, string>();
  if (otusEl) {
    for (const o of descendants(otusEl, 'otu', namespaceURI)) {
      const id = attr(o, 'id');
      // `label` may legitimately be the empty string (an unnamed tip); storing
      // it keeps the round-trip honest instead of substituting the otu id.
      const label = attr(o, 'label');
      if (id && label !== null) otuLabel.set(id, label);
    }
  }
  let layers: Project['layers'] = [];
  let provenance: Project['provenance'];
  if (otusEl) {
    for (const m of metaChildren(otusEl, 'cladeforge:hypothesis-layers', namespaceURI)) {
      const v = parseJsonMeta(m);
      if (Array.isArray(v)) layers = v as Project['layers'];
    }
    for (const m of metaChildren(otusEl, 'cladeforge:provenance', namespaceURI)) {
      const v = parseJsonMeta(m);
      if (v && typeof v === 'object') provenance = v as Project['provenance'];
    }
  }
  return { otuLabel, layers, provenance };
}

/** Parse `<characters>` blocks (StandardCells and ContinuousCells). */
function parseCharacters(xml: Document, namespaceURI: string | null): ParsedCharacter[] {
  const out: ParsedCharacter[] = [];
  for (const charsEl of descendants(xml, 'characters', namespaceURI)) {
    const typeAttr = namespacedAttr(charsEl, XSI_NAMESPACE, 'type') ?? '';
    const continuous = /continuous/i.test(typeAttr);

    // char definitions (ContinuousCells has no <states>).
    const defs: { id: string; name: string; statesRef: string | null }[] = [];
    for (const charEl of descendants(charsEl, 'char', namespaceURI)) {
      defs.push({
        id: attr(charEl, 'id') ?? `c${defs.length + 1}`,
        name: attr(charEl, 'label') || attr(charEl, 'id') || `Character ${defs.length + 1}`,
        statesRef: attr(charEl, 'states'),
      });
    }

    // state catalogue per <states> element.
    const statesById = new Map<string, { id: string; label: string }[]>();
    for (const stEl of descendants(charsEl, 'states', namespaceURI)) {
      const sid = attr(stEl, 'id') ?? '';
      const list: { id: string; label: string }[] = [];
      for (const s of descendants(stEl, 'state', namespaceURI)) {
        list.push({
          id: attr(s, 'id') ?? `s${list.length + 1}`,
          label: attr(s, 'label') || attr(s, 'symbol') || `State ${list.length + 1}`,
        });
      }
      statesById.set(sid, list);
    }

    // matrix rows: otu -> cell map.
    const byOtu = new Map<string, Map<string, string>>();
    for (const row of descendants(charsEl, 'row', namespaceURI)) {
      const otu = attr(row, 'otu') ?? '';
      const cells = new Map<string, string>();
      for (const cell of Array.from(row.children)) {
        if (cell.namespaceURI !== namespaceURI || localName(cell) !== 'cell') continue;
        const cid = attr(cell, 'char');
        const state = attr(cell, 'state');
        if (cid && state) cells.set(cid, state);
      }
      byOtu.set(otu, cells);
    }

    for (const def of defs) {
      const states = def.statesRef ? (statesById.get(def.statesRef) ?? []) : [];
      const charId = `cf_char_${out.length + 1}`;
      const assignments = new Map<string, string | number>();
      for (const [otu, cells] of byOtu) {
        const ref = cells.get(def.id);
        if (ref === undefined) continue;
        if (continuous) {
          const num = Number(ref);
          if (Number.isFinite(num)) assignments.set(otu, num);
        } else {
          assignments.set(otu, ref);
        }
      }
      out.push({
        id: charId,
        name: def.name,
        type: continuous ? 'continuous' : 'discrete',
        states: states.map((s) => ({ ...s })),
        assignments,
      });
    }
  }
  return out;
}

/** Parse every `<tree>` into raw nodes (NeXML ids kept on the side). */
function parseTrees(xml: Document, namespaceURI: string | null): { trees: ParsedTree[]; nodeErrors: string[] } {
  const trees: ParsedTree[] = [];
  const nodeErrors: string[] = [];
  for (const treeEl of descendants(xml, 'tree', namespaceURI)) {
    interface Raw {
      el: Element;
      children: string[];
      parent: string | null;
      events: unknown[];
    }
    const raws = new Map<string, Raw>();
    // Branch lengths live on <edge> in NeXML, so collect them per target while
    // walking the edges (the node attributes carry only label/support/otu).
    const edgeLengths = new Map<string, number>();
    const order: string[] = [];
    for (const n of descendants(treeEl, 'node', namespaceURI)) {
      const id = attr(n, 'id');
      if (!id) continue;
      raws.set(id, { el: n, children: [], parent: null, events: [] });
      order.push(id);
    }
    const targets = new Set<string>();
    for (const e of descendants(treeEl, 'edge', namespaceURI)) {
      const src = attr(e, 'source');
      const tgt = attr(e, 'target');
      if (!src || !tgt) continue;
      const s = raws.get(src);
      const t = raws.get(tgt);
      if (!s || !t) {
        nodeErrors.push(tr(`边 ${src} → ${tgt} 引用了不存在的节点，已跳过`, `Edge ${src} → ${tgt} references a missing node; skipped`));
        continue;
      }
      s.children.push(tgt);
      t.parent = src;
      targets.add(tgt);
      const lenRaw = attr(e, 'length');
      if (lenRaw !== null) {
        const len = Number(lenRaw);
        if (Number.isFinite(len)) edgeLengths.set(tgt, len);
      }
      const ev = metaChildren(e, 'cladeforge:events', namespaceURI);
      for (const m of ev) {
        const v = parseJsonMeta(m);
        if (Array.isArray(v)) raws.get(tgt)!.events.push(...(v as unknown[]));
      }
    }
    const roots = order.filter((id) => !targets.has(id));
    const rootId = roots[0] ?? order[0];
    if (!rootId) {
      nodeErrors.push(tr('NeXML 中有一棵空树，已跳过', 'An empty tree was found in the NeXML and skipped'));
      continue;
    }
    const indexById = new Map<string, number>();
    const nodes: TreeNode[] = order.map((id, i) => {
      indexById.set(id, i);
      const raw = raws.get(id)!;
      const n = raw.el;
      const otu = attr(n, 'otu');
      const label = otu ? undefined : attr(n, 'label') ?? undefined;
      const supportRaw = attr(n, 'support');
      const support = supportRaw !== null ? Number(supportRaw) : undefined;
      return {
        id,
        label: label ?? '',
        parentId: raw.parent,
        childrenIds: [...raw.children],
        ...(otu ? { meta: { __otu: otu } } : {}),
        ...(Number.isFinite(support) ? { support } : {}),
        ...(edgeLengths.has(id) ? { branchLength: edgeLengths.get(id) as number } : {}),
      } as TreeNode;
    });
    trees.push({
      nodes,
      rootIndex: indexById.get(rootId) ?? 0,
      eventsByNode: new Map(
        order
          .map((id, i) => [i, raws.get(id)!.events] as const)
          .filter(([, ev]) => ev.length > 0),
      ),
    });
  }
  return { trees, nodeErrors };
}

export interface NexmlParseResult {
  projects: Project[];
  /** Characters parsed even when no tree could be built (matrix-only files). */
  characters: Character[];
  issues: string[];
}

/**
 * Parse a NeXML document. Returns one project per `<tree>`; when the file
 * carries characters but no usable tree, `projects` is empty and the
 * characters are returned for an apply-to-active-document import.
 */
export function parseNexml(text: string, name: string): NexmlParseResult {
  const issues: string[] = [];
  let xml: Document;
  try {
    xml = new DOMParser().parseFromString(text, 'application/xml');
  } catch (e) {
    throw new Error(
      tr(
        `NeXML 解析失败：${e instanceof Error ? e.message : String(e)}`,
        `Failed to parse NeXML: ${e instanceof Error ? e.message : String(e)}`,
      ),
      { cause: e },
    );
  }
  // DOMParser reports malformed XML in its own parsererror namespace. Keep this
  // diagnostic separate from the NeXML-only scientific element lookups below.
  if (xml.getElementsByTagNameNS('*', 'parsererror').length > 0) {
    throw new Error(
      tr('NeXML 解析失败：文件不是格式良好的 XML', 'Failed to parse NeXML: the file is not well-formed XML'),
    );
  }

  const namespaceURI = resolveNexmlNamespace(xml);
  const { otuLabel, layers, provenance } = parseOtus(xml, namespaceURI);
  const parsedChars = parseCharacters(xml, namespaceURI);
  const { trees, nodeErrors } = parseTrees(xml, namespaceURI);
  issues.push(...nodeErrors);

  const projects: Project[] = trees.map((tree, ti) => {
    const nodes: Record<NodeId, TreeNode> = {};
    const idMap = new Map<string, NodeId>();
    tree.nodes.forEach((n, i) => {
      const newId = `nx_${ti}_${i}`;
      idMap.set(n.id, newId);
      nodes[newId] = { ...n, id: newId };
    });
    // otu → node id, captured while the raw otu attributes are still present
    // (they are consumed below, and the character join needs them afterwards).
    const otuToNodeId = new Map<string, NodeId>();
    for (const n of Object.values(nodes)) {
      n.parentId = n.parentId !== null ? idMap.get(n.parentId) ?? null : null;
      n.childrenIds = n.childrenIds.map((c) => idMap.get(c)).filter((x): x is NodeId => Boolean(x));
      const otu = (n.meta as { __otu?: string } | undefined)?.__otu;
      if (otu) {
        n.label = otuLabel.get(otu) ?? otu;
        otuToNodeId.set(otu, n.id);
        delete (n.meta as { __otu?: string }).__otu;
      }
    }
    const project: Project = {
      id: `nexml_${Date.now().toString(36)}_${ti}`,
      name,
      version: PROJECT_VERSION,
      nodes,
      rootId: idMap.get(tree.nodes[tree.rootIndex].id) as NodeId,
      customEdges: [],
      layout: { ...DEFAULT_LAYOUT },
      canvas: { ...DEFAULT_CANVAS },
      defaults: defaultStyleDefaults(),
      characters: [],
      events: [],
      ...defaultLayers(),
      environmentalEvents: [],
      calibrationPoints: [],
      reconCosts: undefined,
    };
    if (layers.length > 0) project.layers = layers;
    if (provenance) project.provenance = provenance;

    // Characters: turn otu refs into node state assignments.
    for (const pc of parsedChars) {
      const char: Character = {
        id: pc.id,
        name: pc.name,
        type: pc.type,
        states: pc.states.map((s) => ({ id: s.id, label: s.label, color: '' })),
        ...(pc.type === 'continuous' ? {} : {}),
      };
      // Assign colours from the shared state palette so imported matrices are
      // readable without manual styling.
      char.states = char.states.map((s, i) => ({
        ...s,
        color: STATE_PALETTE[i % STATE_PALETTE.length],
      }));
      project.characters.push(char);
      for (const [otu, ref] of pc.assignments) {
        const nodeId = otuToNodeId.get(otu);
        if (!nodeId) continue;
        if (!nodes[nodeId].charStates) nodes[nodeId].charStates = {};
        nodes[nodeId].charStates![pc.id] = ref;
      }
    }

    // cladeforge:events annotations → EvolutionaryEvent records.
    for (const [idx, evList] of tree.eventsByNode) {
      const node = tree.nodes[idx];
      if (!node) continue;
      const targetId = idMap.get(node.id);
      if (!targetId) continue;
      for (const raw of evList) {
        if (!raw || typeof raw !== 'object') continue;
        const rec = raw as Record<string, unknown>;
        project.events.push({
          id: `ev_${idx}_${project.events.length}`,
          typeId: typeof rec.typeId === 'string' ? rec.typeId : 'other',
          target: rec.target === 'branch' ? 'branch' : 'node',
          nodeId: targetId,
          ...(typeof rec.label === 'string' ? { label: rec.label } : {}),
          ...(typeof rec.note === 'string' ? { note: rec.note } : {}),
          triggers: [],
        });
      }
    }
    return project;
  });

  if (projects.length === 0 && parsedChars.length === 0) {
    issues.push(
      tr(
        'NeXML 文件中没有可解析的树或性状矩阵',
        'No parsable trees or character matrix in the NeXML file',
      ),
    );
  }
  return {
    projects,
    characters: parsedChars.map((pc) => ({
      id: pc.id,
      name: pc.name,
      type: pc.type,
      states: pc.states.map((s, i) => ({ id: s.id, label: s.label, color: STATE_PALETTE[i % STATE_PALETTE.length] })),
    })),
    issues,
  };
}

/** Small stable palette for imported discrete states (mirrors the UI's own). */
const STATE_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];


