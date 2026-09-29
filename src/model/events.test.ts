import { describe, it, expect } from 'vitest';
import { createEmptyProject } from './sampleTree';
import { addChildren, addEvent, deleteNode, removeEvent, toggleEventTrigger } from './treeOps';
import {
  EVENT_TYPES,
  causalPairs,
  eventCode,
  eventsForNode,
  findEventCycle,
  hasEventCycle,
  newEvent,
} from './events';
import type { EvolutionaryEvent, NodeId } from './types';

describe('events', () => {
  it('adds events and lists them per node', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    addEvent(p, newEvent('key-innovation', 'branch', a));
    expect(eventsForNode(p, a)).toHaveLength(1);
    expect(eventsForNode(p, p.rootId)).toHaveLength(0);
  });

  it('resolves causal pairs and drops links when an event is removed', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const cause = newEvent('key-innovation', 'branch', a);
    const effect = newEvent('adaptive-radiation', 'node', a);
    addEvent(p, cause);
    addEvent(p, effect);
    toggleEventTrigger(p, cause.id, effect.id);
    expect(causalPairs(p)).toHaveLength(1);

    removeEvent(p, effect.id);
    expect(causalPairs(p)).toHaveLength(0);
    expect(p.events.find((e) => e.id === cause.id)?.triggers).toHaveLength(0);
  });

  it('deleting a node removes its events and purges references to them', () => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    const [b] = addChildren(p, p.rootId, 1);
    const onA = newEvent('bottleneck', 'branch', a);
    const onB = newEvent('adaptive-radiation', 'node', b);
    addEvent(p, onA);
    addEvent(p, onB);
    toggleEventTrigger(p, onB.id, onA.id); // B triggers A

    deleteNode(p, a, true); // removes A and the event on it
    expect(p.events.find((e) => e.id === onA.id)).toBeUndefined();
    expect(p.events.find((e) => e.id === onB.id)?.triggers).toHaveLength(0);
  });
});

/**
 * The event causal chain is a DAG, so the property has to be *verified*, not
 * assumed. These graphs are written out literally because the interactive editor
 * cannot produce a loop — the whole point is that a hand-edited or merged file
 * can. The traversal therefore has to visit EVERY trigger link of an event:
 * starting at index 1 instead of 0 leaves all the cases below undetected.
 */
describe('findEventCycle', () => {
  const node = (() => {
    const p = createEmptyProject();
    const [a] = addChildren(p, p.rootId, 1);
    return a as NodeId;
  })();
  const ev = (id: string, triggers: string[] = []): EvolutionaryEvent => ({
    id,
    typeId: 'key-innovation',
    target: 'node',
    nodeId: node,
    triggers,
  });

  it('detects a self-loop (A → A)', () => {
    const cycle = findEventCycle([ev('A', ['A'])]);
    expect(cycle).toEqual(['A', 'A']);
    const p = createEmptyProject();
    p.events = [ev('A', ['A'])];
    expect(hasEventCycle(p)).toBe(true);
    const dag = createEmptyProject();
    dag.events = [ev('A', ['B']), ev('B')];
    expect(hasEventCycle(dag)).toBe(false);
  });

  it('detects a 2-cycle whose closing edge is the FIRST link of an event', () => {
    // `A → B` at index 0 is exactly the link an index-from-1 traversal skips.
    const cycle = findEventCycle([ev('A', ['B']), ev('B', ['A'])]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBe(3);
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['A', 'B']));
  });

  it('detects a 2-cycle declared the other way round too', () => {
    const cycle = findEventCycle([ev('A', ['B']), ev('B', ['A', 'B'])]);
    expect(cycle).not.toBeNull();
  });

  it('detects a longer transitive cycle (A → B → C → D → A)', () => {
    const events = [ev('A', ['B']), ev('B', ['C']), ev('C', ['D']), ev('D', ['A'])];
    const cycle = findEventCycle(events);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('finds a cycle buried behind several unrelated links', () => {
    const events = [
      ev('A', ['X', 'Y', 'B']), // the loop-closing neighbour sits at index 2
      ev('B', ['C']),
      ev('C', ['A']),
      ev('X'),
      ev('Y'),
    ];
    const cycle = findEventCycle(events);
    expect(cycle).not.toBeNull();
    expect(new Set(cycle)).toEqual(new Set(['A', 'B', 'C']));
  });

  it('leaves legitimate DAGs alone: diamond, chain, dangling and repeated links', () => {
    // Diamond: 关键创新 → 辐射, 关键创新 → 瓶颈, both → 异域成种.
    const diamond = [
      ev('root', ['mid1', 'mid2']),
      ev('mid1', ['sink']),
      ev('mid2', ['sink']),
      ev('sink'),
    ];
    expect(findEventCycle(diamond)).toBeNull();
    expect(findEventCycle([ev('A', ['B']), ev('B', ['C'])])).toBeNull();
    // A trigger pointing at a deleted event is stale data, not a cycle.
    expect(findEventCycle([ev('A', ['ghost'])])).toBeNull();
    // The same effect listed twice is a duplicate link, still acyclic.
    expect(findEventCycle([ev('A', ['B', 'B']), ev('B')])).toBeNull();
    // Two disjoint cycles-free components, deep fan-out.
    expect(
      findEventCycle([ev('a', ['b', 'c', 'd']), ev('b', ['d']), ev('c', ['d']), ev('d')]),
    ).toBeNull();
  });

  it('terminates instead of running forever on a densely cyclic graph', () => {
    // Every event triggers every other: the traversal must be visited-guarded.
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const events = ids.map((id) => ev(id, ids.filter((x) => x !== id)));
    const cycle = findEventCycle(events);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeLessThanOrEqual(ids.length + 1);
  });
});

describe('event-type badge marks', () => {
  it('are two ASCII letters, never a pictograph', () => {
    // Two ASCII letters rather than an emoji: emoji come out wrong in export (the
    // SVG/PDF writer has no emoji font embedded), differ per platform, and cannot
    // be grepped or read aloud — so a mark that is not plain ASCII text is a
    // correctness problem, not a style preference.
    for (const t of EVENT_TYPES) {
      expect(t.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('are unique, so a badge identifies exactly one type', () => {
    const codes = EVENT_TYPES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('mark an unknown type with ?, not a stale glyph', () => {
    expect(eventCode(newEvent('not-in-the-catalogue', 'node', 'root'))).toBe('?');
    expect(eventCode(newEvent('key-innovation', 'branch', 'root'))).toBe('KI');
  });
});
