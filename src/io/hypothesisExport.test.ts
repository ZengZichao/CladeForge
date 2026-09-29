import { describe, it, expect } from 'vitest';
import { createSampleProject } from '../model/sampleTree';
import { buildHypothesisJSON, buildNarrative } from './hypothesisExport';
import { missingCodeCount } from '../model/characters';
import type { Character, Project } from '../model/types';

/**
 * A project whose extra character mixes real state ids with the missing-data
 * symbols the matrix editor writes ('?' / '-') and with unassigned nodes. The
 * assignments are written straight onto `charStates` — the same shape the store
 * produces — so this test does not depend on the editor's validation rules.
 */
function projectWithMissingSymbols(): Project {
  const p = createSampleProject();
  const c: Character = {
    id: 'cov',
    name: '覆盖度',
    type: 'discrete',
    states: [
      { id: 'yes', label: '有', color: '#111111' },
      { id: 'no', label: '无', color: '#222222' },
    ],
  };
  p.characters.push(c);
  const tips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0);
  const t0 = tips[0];
  const parent = p.nodes[t0.parentId as string];
  const sibling = parent ? p.nodes[parent.childrenIds.find((id) => id !== t0.id) as string] : undefined;
  if (parent) parent.charStates = { [c.id]: 'yes' };
  if (t0) t0.charStates = { [c.id]: 'yes' }; // equal → no change
  if (sibling) sibling.charStates = { [c.id]: 'no' }; // the one real transition
  if (tips[2]) tips[2].charStates = { [c.id]: '?' };
  if (tips[3]) tips[3].charStates = { [c.id]: '-' };
  return p;
}

describe('hypothesisExport', () => {
  it('narrative includes the title, characters and events sections', () => {
    const md = buildNarrative(createSampleProject());
    expect(md.startsWith('# ')).toBe(true);
    expect(md).toContain('栖息地'); // demo character
    expect(md).toContain('演化事件'); // demo events section
    // Event types are named by their badge code, as text a reader can copy.
    expect(md).toContain('`KI`');
    expect(md.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}]/gu)).toBeNull();
  });

  it('hypothesis JSON is valid and carries the taxon matrix', () => {
    const p = createSampleProject();
    const json = JSON.parse(buildHypothesisJSON(p)) as {
      kind: string;
      version: string;
      tipCount: number;
      characters: { id: string; name: string; states: { id: string; label: string }[] }[];
      taxonMatrix: { taxon: string; nodeId: string; states: Record<string, string | number> }[];
    };
    expect(json.kind).toBe('hypothesis-export');
    expect(Array.isArray(json.characters)).toBe(true);
    expect(json.taxonMatrix.length).toBeGreaterThan(0);

    // States are keyed by CHARACTER ID and every tip is listed, so the rows
    // match the NEXUS export's NTAX and evidence can be lined up with a column.
    expect(json.version).toBe('0.1.0');
    const habitat = json.characters.find((c) => c.name === '栖息地');
    expect(habitat?.id).toBeTruthy();
    const tips = Object.values(p.nodes).filter((n) => n.childrenIds.length === 0);
    expect(json.taxonMatrix).toHaveLength(tips.length);
    expect(json.tipCount).toBe(tips.length);
    const pakicetus = json.taxonMatrix.find((r) => r.taxon === 'Pakicetus');
    const raw = pakicetus?.states[habitat!.id];
    const state = habitat!.states.find((s) => s.id === raw);
    expect(state?.label).toBe('陆生');
  });

  it('counts a missing-symbol branch as data, never as a transition', () => {
    const p = projectWithMissingSymbols();
    const section = buildNarrative(p).split('### 覆盖度')[1] ?? '';
    expect(section).toBeTruthy();
    const counted = /状态转变（(\d+) 处）/.exec(section);
    expect(counted).toBeTruthy();
    const lines = section.split('\n');
    const branchLines = lines.filter((l) => l.trimStart().startsWith('- 分支「'));
    const uncounted = branchLines.filter((l) => l.includes('（未计入）'));
    // Exactly the one real 有 → 无 change is counted…
    expect(Number(counted![1])).toBe(1);
    expect(branchLines.length - uncounted.length).toBe(1);
    expect(branchLines[0]).toContain('有');
    expect(branchLines[0]).toContain('无');
    // …the '?' / '-' branches are still reported, separately, as not counted —
    // and reported with the LITERAL code the matrix editor wrote, so a reader can
    // tell "explicitly missing" from "never scored"; `detectTransitions` flattens
    // both to 未知, which is the gap this list exists to announce.
    expect(uncounted.length).toBeGreaterThanOrEqual(2);
    const uncountedText = uncounted.join('\n');
    expect(uncountedText).toMatch(/\?/);
    expect(uncountedText).toMatch(/→\s*-/);
    expect(uncountedText).toMatch(/未赋值/);
    // The narrative agrees with the model's own missing-code tally.
    const cov = p.characters.find((c) => c.name === '覆盖度')!;
    expect(missingCodeCount(p, cov)).toBe(2);
    expect(section).toMatch(/不计入转变总数/);
  });

  it('lists every consistency category it found, not just homoplasy', () => {
    const p = createSampleProject();
    const md = buildNarrative(p);
    // The demo project asserts ancestral states, so at least one of the four
    // tags must appear; previously only 同塑性 could ever be printed.
    const tags = ['局部不一致', '过多变化', '同塑性', '模糊'];
    expect(tags.some((t) => md.includes(t))).toBe(true);
    expect(md).toContain('提示（');
  });

  it('never lets a label arrive as live markup', () => {
    const p = createSampleProject();
    p.name = '<img src=x onerror=alert(1)>';
    const tipId = Object.keys(p.nodes).find((id) => p.nodes[id].childrenIds.length === 0)!;
    p.nodes[tipId].label = '<a href="javascript:x">tip</a>';
    const md = buildNarrative(p);
    expect(md).not.toContain('<img');
    expect(md).not.toContain('<a href');
    expect(md).toContain('&lt;img');
    expect(md).toContain('&lt;a href');
  });
});
