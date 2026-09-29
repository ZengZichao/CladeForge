// Referential-integrity validation & repair for a Project loaded from disk.
//
// A hand-edited or corrupted file can contain dangling child references,
// parent/child disagreements, duplicate children, cycles or orphaned nodes.
// `validateProject` walks the tree from the root and rebuilds a consistent
// structure in place, collecting a human-readable list of the repairs it made.
// It throws only when the document is unrecoverable (no valid root).
//
// Integrity is not limited to the topology: the causal event graph must really
// be a DAG, calibration points and per-node character assignments must not
// outlive the things they refer to. Every one of those is checked and repaired
// here, because the analyses (parsimony, Mk, CI/RI, hypothesis export) read
// those fields directly and silently treat a stale key as data.

import { tr } from '../ui/strings';
import { findEventCycle } from './events';
import type { EventId, NodeId, Project } from './types';

export interface ValidationResult {
  project: Project;
  issues: string[];
}

export function validateProject(project: Project): ValidationResult {
  const issues: string[] = [];

  const root = project.nodes[project.rootId];
  if (!root) throw new Error(tr('项目根节点缺失或无效', 'Project root node is missing or invalid'));

  if (root.parentId !== null) {
    root.parentId = null;
    issues.push(tr('根节点的父节点已重置为空', 'Root node parent reset to null'));
  }

  // Breadth-first walk from the root. childrenIds is the source of truth for
  // structure; each reached child has its parentId corrected to match, and any
  // dangling / duplicate / cyclic reference is dropped.
  const visited = new Set<NodeId>([project.rootId]);
  const queue: NodeId[] = [project.rootId];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    const node = project.nodes[id];
    const seen = new Set<NodeId>();
    const clean: NodeId[] = [];
    for (const cid of node.childrenIds) {
      if (!project.nodes[cid]) {
        issues.push(tr(`节点 ${id} 的子引用 ${cid} 指向不存在的节点，已移除`, `Node ${id}: child reference ${cid} points to a missing node; removed`));
        continue;
      }
      if (cid === id || seen.has(cid) || visited.has(cid)) {
        issues.push(tr(`节点 ${id} 存在重复或成环的子引用 ${cid}，已移除`, `Node ${id}: duplicate/cyclic child reference ${cid}; removed`));
        continue;
      }
      seen.add(cid);
      visited.add(cid);
      clean.push(cid);
      const child = project.nodes[cid];
      if (child.parentId !== id) child.parentId = id;
      queue.push(cid);
    }
    if (clean.length !== node.childrenIds.length) node.childrenIds = clean;
  }

  // Drop nodes not reachable from the root (orphans / former cycle members).
  for (const id of Object.keys(project.nodes)) {
    if (!visited.has(id)) {
      delete project.nodes[id];
      issues.push(tr(`孤立节点 ${id} 无法从根到达，已移除`, `Orphan node ${id} unreachable from the root; removed`));
    }
  }

  // Custom edges must connect two existing, distinct nodes.
  const validEdges = project.customEdges.filter(
    (e) => project.nodes[e.sourceId] && project.nodes[e.targetId] && e.sourceId !== e.targetId,
  );
  if (validEdges.length !== project.customEdges.length) {
    issues.push(tr('部分自定义连线的端点已不存在，已移除', 'Some custom links referenced missing endpoints; removed'));
    project.customEdges = validEdges;
  }

  // Events must reference an existing node; triggers must reference existing
  // events; the causal chain must really be acyclic, because every "what caused
  // what" traversal treats it as a DAG — the property is enforced here, not
  // assumed.
  if (Array.isArray(project.events)) {
    const validEvents = project.events.filter((e) => e && project.nodes[e.nodeId]);
    if (validEvents.length !== project.events.length) {
      issues.push(tr('部分演化事件所属的节点已不存在，已移除', 'Some events referenced missing nodes; removed'));
      project.events = validEvents;
    }
    // Repeated event ids make "which event?" undecidable for every traversal.
    const seenIds = new Set<string>();
    const unique = project.events.filter((e) => {
      if (seenIds.has(e.id)) return false;
      seenIds.add(e.id);
      return true;
    });
    if (unique.length !== project.events.length) {
      issues.push(tr('存在 id 重复的演化事件，已只保留第一个', 'Duplicate event ids found; only the first of each was kept'));
      project.events = unique;
    }
    const eventIds = new Set(project.events.map((e) => e.id));
    let selfTriggers = 0;
    let danglingTriggers = 0;
    let duplicateTriggers = 0;
    for (const e of project.events) {
      const triggers = Array.isArray(e.triggers) ? e.triggers : [];
      const seenLinks = new Set<EventId>();
      const deduped: EventId[] = [];
      for (const t of triggers) {
        // A → A is a cycle of length one and the "what caused what" traversal
        // would stop immediately: drop it, but SAY so — a repair nobody hears
        // about is indistinguishable from data loss.
        if (t === e.id) selfTriggers += 1;
        else if (!eventIds.has(t)) danglingTriggers += 1;
        else if (seenLinks.has(t)) duplicateTriggers += 1; // same cause twice
        else {
          seenLinks.add(t);
          deduped.push(t);
        }
      }
      if (!Array.isArray(e.triggers) || deduped.length !== triggers.length) e.triggers = deduped;
    }
    if (selfTriggers > 0) {
      issues.push(
        tr(
          `${selfTriggers} 条事件触发链接指向事件自身（A→A），已移除`,
          `${selfTriggers} trigger link(s) pointed at the event itself (A→A); removed`,
        ),
      );
    }
    if (danglingTriggers > 0) {
      issues.push(
        tr(
          `${danglingTriggers} 条事件触发链接指向已不存在的事件，已移除`,
          `${danglingTriggers} trigger link(s) referenced events that no longer exist; removed`,
        ),
      );
    }
    if (duplicateTriggers > 0) {
      issues.push(
        tr(
          `${duplicateTriggers} 条重复的因果链接已合并（同一因果关系只计一次）`,
          `${duplicateTriggers} duplicate causal link(s) merged (one causal relation counts once)`,
        ),
      );
    }
    // Cut transitive loops (A → B → A, A → A via a longer chain), one back link
    // at a time. The removed link is the LAST one of the cycle, i.e. the effect
    // that points back at its own cause, so the surviving chain stays readable.
    let cycle: EventId[] | null = findEventCycle(project.events);
    let cut = 0;
    while (cycle) {
      const found = cycle;
      const cause = project.events.find((e) => e.id === found[found.length - 2]);
      const effect = found[found.length - 1];
      if (!cause) break;
      cause.triggers = cause.triggers.filter((t) => t !== effect);
      cut += 1;
      cycle = findEventCycle(project.events);
    }
    if (cut > 0) {
      issues.push(
        tr(
          `演化事件的因果链中存在 ${cut} 处回路（A→B→A），已删除闭合回路的那条触发链接以保持其为有向无环图`,
          `The event causal graph contained ${cut} cycle(s) (A→B→A); the closing trigger link(s) were removed so it stays a directed acyclic graph`,
        ),
      );
    }
  }

  // Node-level character assignments must not outlive their character (or a
  // deleted state): a stale key is read as data by parsimony, Mk, the layers and
  // the hypothesis exporter alike.
  const characterIds = new Set(project.characters.map((c) => c.id));
  const dropStaleAssignments = (
    holderId: NodeId,
    states: Record<string, string | number> | undefined,
    meta: Record<string, unknown> | undefined,
  ): void => {
    for (const key of Object.keys(states ?? {})) {
      if (!characterIds.has(key)) delete (states as Record<string, string | number>)[key];
    }
    for (const key of Object.keys(meta ?? {})) {
      if (!characterIds.has(key)) delete (meta as Record<string, unknown>)[key];
    }
    if (states && Object.keys(states).length === 0) delete project.nodes[holderId].charStates;
    if (meta && Object.keys(meta).length === 0) delete project.nodes[holderId].charMeta;
  };
  let staleKeys = 0;
  for (const node of Object.values(project.nodes)) {
    const before = Object.keys(node.charStates ?? {}).length + Object.keys(node.charMeta ?? {}).length;
    dropStaleAssignments(node.id, node.charStates, node.charMeta);
    staleKeys += before - (Object.keys(node.charStates ?? {}).length + Object.keys(node.charMeta ?? {}).length);
  }
  // Same for the stored (non-active) hypothesis layers, which are loaded lazily
  // and would otherwise resurrect an orphaned assignment on a layer switch.
  for (const stored of Object.values(project.layerStore ?? {})) {
    for (const [nid, states] of Object.entries(stored.states)) {
      if (!project.nodes[nid]) {
        delete stored.states[nid];
        staleKeys += 1;
        continue;
      }
      for (const key of Object.keys(states)) {
        if (!characterIds.has(key)) {
          delete states[key];
          staleKeys += 1;
        }
      }
    }
    for (const [nid, meta] of Object.entries(stored.meta)) {
      if (!project.nodes[nid]) {
        delete stored.meta[nid];
        staleKeys += 1;
        continue;
      }
      for (const key of Object.keys(meta)) {
        if (!characterIds.has(key)) {
          delete meta[key];
          staleKeys += 1;
        }
      }
    }
  }
  if (staleKeys > 0) {
    issues.push(
      tr(
        `${staleKeys} 处节点赋值指向已删除的性状，已清除（否则会被当作数据参与推断与导出）`,
        `${staleKeys} node assignment(s) referenced characters that no longer exist; cleared (they would otherwise be read as data)`,
      ),
    );
  }
  // Calibration points must sit on a node that still exists.
  if (Array.isArray(project.calibrationPoints)) {
    const validCalibrations = project.calibrationPoints.filter(
      (c) => c && project.nodes[c.nodeId],
    );
    if (validCalibrations.length !== project.calibrationPoints.length) {
      issues.push(
        tr(
          `${project.calibrationPoints.length - validCalibrations.length} 个化石校准点指向已不存在的节点，已移除`,
          `${project.calibrationPoints.length - validCalibrations.length} calibration point(s) referenced missing nodes; removed`,
        ),
      );
      project.calibrationPoints = validCalibrations;
    }
  } else {
    project.calibrationPoints = [];
  }

  // The active layer must be one of the declared layers, otherwise every
  // hypothesis the user reads on screen belongs to no layer at all.
  if (Array.isArray(project.layers)) {
    if (!project.layers.some((l) => l.id === project.activeLayerId)) {
      const fallback = project.layers[0];
      issues.push(
        tr(
          `活动假说层 ${project.activeLayerId || '(空)'} 不存在，已切换到 ${fallback ? fallback.id : '(无)'}`,
          `Active hypothesis layer ${project.activeLayerId || '(empty)'} does not exist; switched to ${fallback ? fallback.id : '(none)'}`,
        ),
      );
      project.activeLayerId = fallback ? fallback.id : project.activeLayerId;
    }
    for (const storedId of Object.keys(project.layerStore ?? {})) {
      if (!project.layers.some((l) => l.id === storedId)) {
        delete project.layerStore[storedId];
        issues.push(
          tr(`假说层 ${storedId} 的快照没有对应的层定义，已移除`, `Stored layer ${storedId} has no layer definition; removed`),
        );
      }
    }
  }

  // A pinned position that is not a finite number renders as `translate(NaN,
  // NaN)` — an invisible, unselectable node. Drop the override so the automatic
  // layout places it again; `autoLayout` guards the same thing at
  // draw time so a live edit cannot reintroduce it.
  for (const node of Object.values(project.nodes)) {
    const pin = node.position;
    if (!pin) continue;
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) {
      delete node.position;
      issues.push(
        tr(
          `节点 ${node.label || node.id} 的手工坐标不是有限数值，已清除并回落到自动布局`,
          `Node ${node.label || node.id} had a non-finite manual position; cleared, falling back to the automatic layout`,
        ),
      );
    }
  }

  return { project, issues };
}
