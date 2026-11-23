// AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md.
import { describe, expect, it } from 'vitest';
import { createSampleProject, SAMPLE_PROJECTS } from './sampleTree';

describe('time-tree sample presentation', () => {
  it('uses a spacious, readable layout without changing global defaults', () => {
    const project = createSampleProject();

    expect(project.layout.vGap).toBe(72);
    expect(project.layout.timeAxisLength).toBe(560);
    expect(project.defaults.branch.width).toBe(2);
    expect(project.defaults.branch.shape).toBe('rounded');
    expect(project.defaults.node.size).toBe(5);
    expect(project.defaults.node.fontWeight).toBe(500);
    expect(project.canvas.background).toBe('#f8fafc');
    const internalNodes = Object.values(project.nodes).filter((node) => node.childrenIds.length > 0);
    expect(internalNodes.every((node) => node.style?.labelPosition === 'top-right')).toBe(true);
  });

  it('labels the dated markers as distinct geological events', () => {
    const project = createSampleProject();
    const events = project.environmentalEvents;

    expect(events.map((event) => event.label)).toEqual([
      '地质事件 A',
      '地质事件 B',
      '地质事件 C',
    ]);
    expect(new Set(events.map((event) => event.color)).size).toBe(3);
    expect(events.every((event) => !event.label.includes('环境标记'))).toBe(true);
    expect(events[0].note).toContain('地质事件');
    expect(SAMPLE_PROJECTS.find((sample) => sample.id === 'feature-tour')?.desc).toContain('地质事件');
  });
});
