import { describe, it, expect } from 'vitest';
import { validateProject } from './validate';
import { findEventCycle } from './events';
import { createSampleProject, createEmptyProject } from './sampleTree';
import { addChildren } from './treeOps';
import type { EvolutionaryEvent, Project } from './types';

/**
 * `validateProject` is the last line of defence for a hand-edited or externally
 * produced file: it has to repair what the interactive editor can never create.
 * The event causal chain is a DAG, so the cycle cutter in it must actually cut —
 * these tests hold it to that, along with the rest of the referential repair.
 */

function eventProject(links: Record<string, string[]>): Project {
  const p = createSampleProject();
  const ids = Object.keys(links);
  const byId = new Map<string, EvolutionaryEvent>(
    ids.map((id) => [id, { id, typeId: 'key-innovation', target: 'node', nodeId: p.rootId, triggers: [] }]),
  );
  for (const [id, outs] of Object.entries(links)) byId.get(id)!.triggers = [...outs];
  p.events = ids.map((id) => byId.get(id)!);
  return p;
}

const triggersOf = (p: Project, id: string): string[] => p.events.find((e) => e.id === id)?.triggers ?? [];
const mentions = (issues: string[], ...needles: string[]): string[] =>
  issues.filter((i) => needles.some((n) => i.includes(n)));

describe('validateProject — event causal DAG', () => {
  it('cuts a direct self-loop and announces it', () => {
    const p = eventProject({ A: ['A'], B: [] });
    const { project, issues } = validateProject(p);
    expect(triggersOf(project, 'A')).toEqual([]);
    expect(mentions(issues, 'A→A', 'itself')).toHaveLength(1);
    expect(findEventCycle(project.events)).toBeNull();
  });

  it('cuts a 2-cycle whose closing edge is the first trigger link', () => {
    const p = eventProject({ A: ['B'], B: ['A'] });
    const { project, issues } = validateProject(p);
    expect(findEventCycle(project.events)).toBeNull();
    const remaining = [...triggersOf(project, 'A'), ...triggersOf(project, 'B')];
    expect(remaining).toHaveLength(1); // exactly the closing link went away
    expect(project.events).toHaveLength(2); // both events survive
    expect(mentions(issues, '回路', 'cycle')).toHaveLength(1);
    expect(issues.join('\n')).toMatch(/1 处回路|1 cycle/);
  });

  it('cuts a longer transitive cycle (A → B → C → D → A)', () => {
    const p = eventProject({ A: ['B'], B: ['C'], C: ['D'], D: ['A'] });
    const { project, issues } = validateProject(p);
    expect(findEventCycle(project.events)).toBeNull();
    expect(mentions(issues, '回路', 'cycle')).toHaveLength(1);
  });

  it('cuts every loop in a graph with two independent cycles', () => {
    const p = eventProject({ A: ['B'], B: ['A', 'C'], C: ['D'], D: ['C'] });
    const { project, issues } = validateProject(p);
    expect(findEventCycle(project.events)).toBeNull();
    expect(mentions(issues, '回路', 'cycle')).toHaveLength(1);
    expect(issues.join('\n')).toMatch(/2 处回路|2 cycle/);
  });

  it('leaves a legitimate DAG completely untouched', () => {
    const p = eventProject({
      innovation: ['radiation', 'bottleneck'],
      radiation: ['allopatric'],
      bottleneck: ['allopatric'],
      allopatric: [],
    });
    const before = p.events.map((e) => ({ id: e.id, triggers: [...e.triggers] }));
    const { project, issues } = validateProject(p);
    expect(project.events.map((e) => ({ id: e.id, triggers: [...e.triggers] }))).toEqual(before);
    expect(findEventCycle(project.events)).toBeNull();
    expect(mentions(issues, '因果', '触发', '回路', 'causal', 'trigger', 'cycle')).toEqual([]);
  });

  it('reports (not silently drops) dangling and duplicated trigger links', () => {
    const dangling = eventProject({ A: ['ghost', 'B'], B: [] });
    const r1 = validateProject(dangling);
    expect(triggersOf(r1.project, 'A')).toEqual(['B']);
    expect(mentions(r1.issues, '已不存在的事件', 'no longer exist')).toHaveLength(1);

    const dup = eventProject({ A: ['B', 'B'], B: [] });
    const r2 = validateProject(dup);
    expect(triggersOf(r2.project, 'A')).toEqual(['B']);
    expect(mentions(r2.issues, '重复的因果链接', 'duplicate causal')).toHaveLength(1);
  });

  it('drops events whose node is gone and duplicate event ids', () => {
    const p = eventProject({ A: ['B'], B: [] });
    p.events.push({ ...p.events[0] }); // same id twice
    const { project, issues } = validateProject(p);
    expect(project.events.map((e) => e.id)).toEqual(['A', 'B']);
    expect(mentions(issues, 'id 重复', 'Duplicate event ids')).toHaveLength(1);

    const orphanNode = eventProject({ A: ['B'], B: [] });
    orphanNode.events.forEach((e) => (e.nodeId = 'no-such-node'));
    const r2 = validateProject(orphanNode);
    expect(r2.project.events).toHaveLength(0);
    expect(mentions(r2.issues, '节点已不存在', 'missing nodes')).toHaveLength(1);
  });
});

describe('validateProject — referential repair of the tree and the data', () => {
  it('removes orphan nodes, dangling children and cycles in the topology', () => {
    const p = createEmptyProject();
    const [a, b] = addChildren(p, p.rootId, 2);
    addChildren(p, a, 1);
    const ghost = addChildren(p, b, 1)[0];
    // dangling reference + self reference + a child listed twice
    p.nodes[b].childrenIds = [...p.nodes[b].childrenIds, 'no-such-node', b, ghost];
    // an unreachable node
    p.nodes['orphan-node'] = {
      id: 'orphan-node',
      label: 'orphan',
      parentId: null,
      childrenIds: [],
      style: p.nodes[a].style,
    };
    const { project, issues } = validateProject(p);
    expect(project.nodes['orphan-node']).toBeUndefined();
    expect(project.nodes[b].childrenIds).toEqual([ghost]);
    expect(project.nodes[ghost].parentId).toBe(b);
    expect(mentions(issues, '指向不存在的节点', 'missing node')).toHaveLength(1);
    // one message for the self reference, one for the duplicated child
    expect(mentions(issues, '重复或成环', 'duplicate/cyclic')).toHaveLength(2);
    expect(mentions(issues, '孤立节点', 'Orphan node')).toHaveLength(1);
  });

  it('purges stale charStates / charMeta keys and reports how many', () => {
    const p = createSampleProject();
    const tip = Object.values(p.nodes).find((n) => n.childrenIds.length === 0)!;
    const liveChar = p.characters[0];
    tip.charStates = { [liveChar.id]: liveChar.states[0].id, 'deleted-char': 'x' };
    tip.charMeta = {
      'deleted-char': { confidence: 'high' },
      [liveChar.id]: { confidence: 'low', support: 'kept' },
    };
    const { project, issues } = validateProject(p);
    expect(Object.keys(project.nodes[tip.id].charStates ?? {})).toEqual([liveChar.id]);
    expect(Object.keys(project.nodes[tip.id].charMeta ?? {})).toEqual([liveChar.id]);
    expect(project.nodes[tip.id].charMeta?.[liveChar.id]?.support).toBe('kept');
    expect(mentions(issues, '已删除的性状', 'no longer exist')).toHaveLength(1);
    expect(issues.join('\n')).toMatch(/2 处节点赋值|2 node assignment/);
  });

  it('purges the same stale keys inside the stored hypothesis layers', () => {
    const p = createSampleProject();
    const layer = p.layers[0];
    const tip = Object.values(p.nodes).find((n) => n.childrenIds.length === 0)!;
    p.layerStore[layer.id] = {
      states: { [tip.id]: { 'deleted-char': 'x' }, 'deleted-node': { 'deleted-char': 'y' } },
      meta: { [tip.id]: { 'deleted-char': { confidence: 'high' } } },
      events: [],
    };
    const { project, issues } = validateProject(p);
    const stored = project.layerStore[layer.id];
    expect(stored.states[tip.id]).toEqual({});
    expect(stored.states['deleted-node']).toBeUndefined();
    expect(stored.meta[tip.id]).toEqual({});
    expect(mentions(issues, '已删除的性状', 'no longer exist')).toHaveLength(1);
  });

  it('keeps a sound project silent', () => {
    const { issues } = validateProject(createSampleProject());
    expect(issues).toEqual([]);
  });
});
