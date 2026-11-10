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
import type { NodeId, Project } from '../model/types';

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
    '<nex:nexml xmlns:nex="http://www.nexml.org/2009" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="0.9" generator="CladeForge">',
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
    '导出 NeXML（树 + 性状 + 语义注记；RNeXML / pynexml / DendroPy 可读）。事件与假说层以 cladeforge: 注记携带；NeXML 读回尚未支持',
    'Export NeXML (tree + characters + semantic annotations; readable by RNeXML / pynexml / DendroPy). Events and hypothesis layers travel as cladeforge: annotations; reading NeXML back is not yet supported',
  );
}
